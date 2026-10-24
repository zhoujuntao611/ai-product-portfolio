'use strict';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const pretty = value => JSON.stringify(value, null, 2);
const FIELD_LABELS = {order_id:'订单标识 *',order_date:'订单日期 *',gross_amount:'毛金额 *',refund_amount:'退款金额',refund_date:'退款日期',channel:'渠道',status:'订单状态',currency:'币种'};
const OPTION_IDS = ['dateFormat','amountUnit','currency','duplicatePolicy','missingRefund','missingChannel','invalidRows','assumeNoRefunds'];
const STORAGE_KEY = 'metricpilot.dataset.v2';
let csrfToken = '', draft = null, dataset = null, checkResult = null, checkedPayload = '', currentRun = null, importing = false, running = false, meta = {};

async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken}, body:JSON.stringify(body)});
  let data;
  try { data = await response.json(); } catch { throw new Error('服务未返回有效数据，请确认本机服务仍在运行。'); }
  if (!response.ok) throw new Error(data.error || data.message || `请求失败（${response.status}）`);
  return data;
}
function view(name) {
  if (!['import','analysis','sources','history'].includes(name)) return;
  for (const item of ['import','analysis','sources','history']) $('#'+item+'View').classList.toggle('hidden', item !== name);
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  $('#breadcrumb').textContent = {import:'导入订单',analysis:'业务分析',sources:'数据与口径',history:'分析记录'}[name];
  if (name === 'sources') loadSource();
  if (name === 'history') loadHistory();
}
function errorAt(selector, message) { const element=$(selector); element.textContent=message; element.classList.remove('hidden'); element.scrollIntoView({behavior:'smooth',block:'nearest'}); }
function renderTable(rows, columns) {
  if (!rows?.length) return '<p class="empty-list">没有可展示的数据行。</p>';
  const keys = columns?.length ? [...new Set([...columns.map(column => typeof column === 'string' ? column : column.name),...rows.flatMap(row=>Array.isArray(row)?[]:Object.keys(row))])] : Object.keys(rows[0]);
  return `<table><thead><tr>${keys.map(key=>`<th scope="col">${esc(key)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${keys.map((key,index)=>`<td>${esc(Array.isArray(row) ? row[index] : row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function importPayload() {
  return {draft_id:draft?.id, mapping:Object.fromEntries(Object.keys(FIELD_LABELS).map(key=>[key,$('#map-'+key)?.value || null])), options:{date_format:$('#dateFormat').value,amount_unit:$('#amountUnit').value,currency:$('#currency').value,duplicate_policy:$('#duplicatePolicy').value,missing_refund:$('#missingRefund').value,missing_channel:$('#missingChannel').value,invalid_rows:$('#invalidRows').value,assume_no_refunds:$('#assumeNoRefunds').checked}};
}
function invalidateCheck() {
  checkResult = null; checkedPayload = ''; $('#commitImport').disabled = true;
  $('#checkArea').classList.add('hidden');
  $('#checkHint').textContent = '已更新配置，请检查数据后再确认导入。';
}
function validateImport(payload) {
  const names = ['order_id','order_date','gross_amount'];
  if (names.some(name=>!payload.mapping[name])) return '请映射订单标识、订单日期和毛金额这三个必需字段。';
  const selected = Object.values(payload.mapping).filter(Boolean);
  if (new Set(selected).size !== selected.length) return '一个原始字段不能同时映射为多个含义，请检查字段映射。';
  if (!payload.options.date_format || !payload.options.amount_unit || !payload.options.currency) return '请明确选择日期格式、金额单位与本表币种。';
  return '';
}
async function readFile(file) {
  if (importing || !file) return;
  importing = true; draft=null; invalidateCheck(); $('#draftArea').classList.add('hidden'); $('#importError').classList.add('hidden'); $('#fileStatus').textContent = '正在读取并预览订单表…';
  try {
    if (!/\.csv$/i.test(file.name)) throw new Error('请上传单张订单 CSV。Excel 工作簿请先另存为 CSV UTF-8；可下载示例模板查看支持的结构。');
    if (file.size === 0) throw new Error('这个文件是空的，请选择包含表头和订单行的 CSV。');
    if (file.size > 2 * 1024 * 1024) throw new Error('文件超过 2 MB。请按期间拆分订单，或先减少无关列后重新导入。');
    let csv;
    try { csv = new TextDecoder('utf-8', {fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer()); }
    catch { throw new Error('无法按 UTF-8 读取。请在表格软件中选择“CSV UTF-8”重新保存，避免中文或金额被错误解析。'); }
    const result = await api('/api/import/preview', {filename:file.name,csv});
    draft = {...result,id:result.id || result.draft_id};
    invalidateCheck();
    $('#draftArea').classList.remove('hidden');
    $('#previewCaption').textContent = `${draft.filename || file.name} · 共 ${Number(draft.row_count).toLocaleString('zh-CN')} 行 · 以下显示前 ${(draft.preview || []).length} 行`;
    $('#previewTable').innerHTML = renderTable(draft.preview, draft.columns);
    const columns = (draft.columns || []).map(column=>typeof column === 'string' ? column : column.name);
    $('#mappingFields').innerHTML = Object.entries(FIELD_LABELS).map(([key,label])=>`<label for="map-${key}">${esc(label)}<select id="map-${key}" data-mapping><option value="">${key==='order_id'||key==='order_date'||key==='gross_amount'?'请选择原始字段':'不映射 / 本表无此字段'}</option>${columns.map(column=>`<option value="${esc(column)}"${draft.mapping?.[key]===column?' selected':''}>${esc(column)}</option>`).join('')}</select></label>`).join('');
    ['dateFormat','amountUnit','currency'].forEach(id=>$('#'+id).value='');
    ['duplicatePolicy','missingRefund','missingChannel','invalidRows'].forEach(id=>$('#'+id).value='reject');
    $('#assumeNoRefunds').checked = false;
    $$('[data-mapping]').forEach(control=>control.addEventListener('change', invalidateCheck));
    $('#stepCheck').classList.add('active'); $('#stepReady').classList.remove('active');
    $('#fileStatus').textContent = `${file.name} · 读取完成，请确认下方映射与解析方式。`;
    if (draft.issues?.length) { $('#importError').innerHTML = issueList(draft.issues); $('#importError').classList.remove('hidden'); }
  } catch (error) { errorAt('#importError', error.message); $('#fileStatus').textContent='文件尚未导入。可修正后重试，或下载示例模板。'; }
  finally { importing = false; $('#csvFile').value = ''; }
}
function issueList(issues) {
  return issues.map(issue=>{
    if (typeof issue === 'string') return `<div class="issue warning"><p>${esc(issue)}</p></div>`;
    const rows = issue.rows?.length ? `<small>原始行：${esc(issue.rows.join('、'))}</small>` : '';
    const options = issue.options ? `<p class="issue-options">处理提示：${esc(typeof issue.options === 'string' ? issue.options : JSON.stringify(issue.options))}</p>` : '';
    return `<article class="issue ${issue.severity==='error'?'error':issue.severity==='warning'?'warning':'info'}"><div><span>${esc({error:'需处理',warning:'请确认',info:'已记录'}[issue.severity] || '提示')}</span><code>${esc(issue.code || '')}</code></div><p>${esc(issue.message)}</p>${rows}${options}</article>`;
  }).join('');
}
function decisionText(payload) {
  const o = payload.options;
  return [`日期格式：${$('#dateFormat').selectedOptions[0].textContent}`,`原始金额：${o.amount_unit==='minor'?'最小单位':'主单位'}；币种：${o.currency}${o.currency==='JPY'?'（整日元）':''}`,`完全重复行：${o.duplicate_policy==='drop_exact'?'删除重复行并保留第一行':'不自动删除'}`,`退款空值：${o.missing_refund==='zero'?'按 0 处理':'不自动补值'}`,`渠道空值：${o.missing_channel==='unknown'?'归入未知渠道':'不自动补值'}`,`无效行：${o.invalid_rows==='exclude'?'排除并记录':'不自动排除'}`,...(o.assume_no_refunds?['已明确确认本表所有订单无退款']:[])];
}
async function checkImport() {
  const payload = importPayload(), invalid = validateImport(payload);
  $('#importError').classList.add('hidden');
  if (invalid) { errorAt('#importError', invalid); return; }
  $('#checkImport').disabled = true; $('#checkImport').textContent = '正在检查…';
  try {
    const result = await api('/api/import/check', payload);
    if (JSON.stringify(importPayload())!==JSON.stringify(payload)) { invalidateCheck(); errorAt('#importError','配置在检查期间发生变化，请重新检查。'); return; }
    checkResult = result; checkedPayload = JSON.stringify(payload);
    $('#checkArea').classList.remove('hidden'); $('#checkBadge').textContent = result.can_import ? '可以导入' : '需要处理';
    const stats = result.stats || {};
    $('#checkStats').innerHTML = Object.entries(stats).filter(([key])=>!['currency_scale','amount_unit'].includes(key)).map(([key,value])=>`<div><span>${esc(({input_rows:'原始行数',accepted_rows:'可导入行数',currency:'币种',currency_scale:'货币单位换算',amount_unit:'原始金额单位',date_start:'最早订单日期',date_end:'最晚订单日期',total_rows:'原始行数',valid_rows:'有效行数',imported_rows:'导入行数',excluded_rows:'排除行数',duplicate_rows:'重复行数',retained_rows:'保留行数',row_count:'可导入行数'})[key] || key)}</span><strong>${esc(Array.isArray(value)?value.length+' 行':typeof value==='object'?JSON.stringify(value):value)}</strong></div>`).join('');
    $('#checkIssues').innerHTML = result.issues?.length ? issueList(result.issues) : '<div class="issue info"><p>检查通过，未发现需要处理的数据问题。</p></div>';
    $('#decisionSummary').innerHTML = `<h3>本次明确选择的处理方式</h3><ul>${decisionText(payload).map(text=>`<li>${esc(text)}</li>`).join('')}</ul>`;
    $('#commitImport').disabled = !result.can_import;
    $('#checkHint').textContent = result.can_import ? '检查完成，请复核下方问题与处理决定。' : '请按检查结果修改文件或处理选项，然后重新检查。';
    $('#checkArea').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(error) { errorAt('#importError',error.message); }
  finally { $('#checkImport').disabled = false; $('#checkImport').innerHTML = '检查数据 <span>→</span>'; }
}
async function commitImport() {
  const payload = importPayload();
  if (!checkResult?.can_import || JSON.stringify(payload)!==checkedPayload) { invalidateCheck(); errorAt('#importError','配置已发生变化，请重新检查数据。'); return; }
  $('#commitImport').disabled = true;
  try {
    const result = await api('/api/import/commit', payload);
    setDataset(result.dataset || result);
    $('#stepReady').classList.add('active');
    $('#datasetBanner').innerHTML = `<span>✓ ${esc(dataset.name || '订单表')} 已导入 · ${esc(dataset.row_count)} 行</span><button class="text-button" data-open-analysis>查看分析工作区 ↗</button>`;
    $('#datasetBanner').classList.remove('hidden');
    $('[data-open-analysis]').addEventListener('click',()=>view('analysis'));
    $('#commitHint').textContent = '已导入。导入决定会跟随本次数据集和导出的报告。';
    $('#start').value=''; $('#end').value=''; $('#question').value=''; $('#refundBasis').value=''; $('#cancelled').value=''; $('#confirmContract').checked=false;
    $('#report').classList.add('hidden'); $('#emptyState').classList.remove('hidden'); currentRun=null;
    view('analysis'); window.scrollTo({top:0,behavior:'smooth'});
  } catch(error) { errorAt('#importError',error.message); $('#commitImport').disabled=false; }
}
function setDataset(value) {
  dataset=value;
  try { localStorage.setItem(STORAGE_KEY, dataset.id); } catch { /* A blocked storage area does not prevent analysis. */ }
  $('#workspaceName').textContent=dataset.name || '我的订单工作区';
  $('#analysisDataset').innerHTML=`<div><span class="status-dot"></span><strong>${esc(dataset.name)}</strong><span>${esc(dataset.row_count)} 笔订单 · ${esc(dataset.date_start)} — ${esc(dataset.date_end)} · ${esc(dataset.currency)}</span></div><button class="secondary" data-change-data>更换订单表 ↗</button>`;
  $('[data-change-data]').addEventListener('click',()=>view('import'));
  $('#channel').innerHTML='<option value="">全部渠道</option>'+(dataset.channels || []).map(channel=>`<option value="${esc(typeof channel==='string'?channel:channel.id)}">${esc(typeof channel==='string'?channel:channel.name)}</option>`).join('');
  const capabilities=dataset.capabilities || {};
  $$('#metric option').forEach(option=>option.disabled=!capabilities.refunds && ['net_cents','refund_cents','refund_amount_rate','refund_order_rate'].includes(option.value));
  if ($('#metric').selectedOptions[0]?.disabled) $('#metric').value='auto';
  $('#channel').disabled=!capabilities.channel;
  $('[data-task="channel"]').disabled=!capabilities.channel;
  $('[data-task="channel"]').title=capabilities.channel?'':'未映射渠道字段，无法比较渠道';
  $('[data-task="refund"]').disabled=!capabilities.refunds;
  $('[data-task="refund"]').title=capabilities.refunds?'':'未提供退款金额，也未确认无退款';
  $('#refundBasis option[value="refund_date"]').disabled=!capabilities.refund_dates;
  if (!capabilities.refund_dates && $('#refundBasis').value==='refund_date') $('#refundBasis').value='';
  $('#contractHelp').textContent=`${capabilities.refund_dates?'支持按原订单日期或退款日期归属。':'未映射退款日期，只支持按原订单日期归属。'} ${capabilities.status?'取消识别使用上方明确填写的状态值，可按本表实际状态修改。':'未映射状态字段，无法识别哪些订单已取消。'} 金额币种：${dataset.currency}${dataset.currency_scale===1?'（整日元）':''}。`;
  $('#submit').disabled=running;
}
function definitionItems(definitions) {
  if (!definitions) return [];
  if (Array.isArray(definitions)) return definitions.map(value=>typeof value==='string'?value:JSON.stringify(value));
  if (typeof definitions==='string') return [definitions];
  return Object.entries(definitions).map(([key,value])=>`${key}：${typeof value==='object'?JSON.stringify(value):value}`);
}
function money(value, currency, scale) {
  if (value==null) return '—';
  const unit=currency || currentRun?.dataset?.currency || dataset?.currency || 'CNY';
  const divisor=BigInt(scale || currentRun?.dataset?.currency_scale || (unit==='JPY'?1:100));
  const integer=BigInt(value), absolute=integer<0n?-integer:integer;
  const digits=divisor===1n?0:2;
  const remainder=String(absolute%divisor).padStart(digits,'0');
  const parts=new Intl.NumberFormat('zh-CN',{style:'currency',currency:unit,minimumFractionDigits:digits,maximumFractionDigits:digits}).formatToParts(absolute/divisor);
  return (integer<0n?'-':'')+parts.map(part=>part.type==='fraction'?remainder:part.value).join('');
}
function format(value, metric, currency) {
  if (value==null) return '—';
  return metric.endsWith('_cents')?money(value,currency):metric.endsWith('_rate')?`${(Number(value)*100).toFixed(2)}%`:Number(value).toLocaleString('zh-CN');
}
function citations(ids) {
  return (Array.isArray(ids)?ids:[ids]).filter(Boolean).map(id=>`<button type="button" class="citation" data-cite="${esc(id)}" aria-label="查看查询 ${esc(id)} 的筛选条件和原始结果">${esc(id)} ↗</button>`).join('');
}
function periodLabel(period) { return typeof period==='object'?JSON.stringify(period):String(period || ''); }
function renderRun(run) {
  currentRun=run;
  $('#queryEditor').open = run.status !== 'completed';
  for (const id of ['emptyState','loadingState','errorState','clarificationState','report']) $('#'+id).classList.add('hidden');
  if (run.status==='needs_clarification' || !run.report) {
    const clarification = typeof run.clarification==='object'?JSON.stringify(run.clarification):run.clarification;
    $('#clarificationState').innerHTML=`<span class="tag">需要确认</span><h2>查询已暂停</h2><p>${esc(clarification || '请补充明确的分析期间和指标分母。')}</p><p class="prompt-tip">修改问题或上方条件后，再次开始分析。本次未生成分析结论。</p>`;
    $('#clarificationState').classList.remove('hidden'); return;
  }
  const r=run.report, totals=r.totals || {}, rows=r.rows || [], queries=run.queries || [], metric=r.metric || 'net_cents';
  const currency=run.dataset?.currency || dataset?.currency;
  const cards=[['gross_cents','毛收入','映射的订单毛金额之和'],['net_cents','净收入','毛收入 − 退款金额'],['refund_amount_rate','退款金额占比',`退款金额 / 毛收入 ${money(totals.gross_cents,currency)}`],['refund_order_rate','退款订单占比',`退款订单 / 订单总数 ${format(totals.orders,'orders')}`]];
  const columns=[['label','对象'],[metric,r.metric_label || metric],['gross_cents','毛收入'],['refund_cents','退款金额'],['orders','订单数'],['refund_orders','退款订单数'],['evidence','证据']].filter((item,index,all)=>all.findIndex(other=>other[0]===item[0])===index);
  const maximum=Math.max(...rows.map(row=>Number(row[metric]) || 0),0);
  const chart=rows.length>1 && rows.every(row=>row[metric]!=null && Number(row[metric])>=0)?`<div class="chart">${rows.map(row=>`<div class="chart-row"><span title="${esc(row.label)}">${esc(row.label)}</span><div class="chart-bar-track"><div class="chart-bar" data-width="${maximum?Number(row[metric])/maximum*100:0}"></div></div><span class="chart-value">${esc(format(row[metric],metric,currency))}</span></div>`).join('')}</div><p class="chart-caption">零基线 · ${esc(r.metric_label || metric)} · ${esc(currency)}</p>`:rows.some(row=>Number(row[metric])<0)?'<p class="help">结果包含负值，使用下表展示完整数值。</p>':'';
  $('#report').innerHTML=`<div class="result-header"><div><h2>${esc(r.title)}</h2><p>${esc(periodLabel(r.period))} · ${esc(run.engine || '受约束的分析工具')} · ${Number(run.elapsed_ms || 0).toFixed(1)} ms</p></div><div class="export-actions"><button class="secondary" id="exportMd">导出报告 ↓</button><button class="secondary" id="exportJson">JSON ↓</button></div></div><div class="report-context">${esc(run.dataset?.name || '')} · ${esc(currency)} · ${run.contract?.refund_basis==='refund_date'?'退款按发生日期':'退款按原订单日期'} · ${run.contract?.cancelled==='include'?'包含取消订单':'排除取消订单'}<br><span>订单 ${esc(totals.orders ?? '—')} 笔 · 退款金额 ${esc(money(totals.refund_cents,currency))}</span></div><div class="kpi-grid">${cards.map(([key,label,explain],index)=>`<article class="kpi ${index===1?'highlight':''}"><span>${esc(label)}</span><strong>${esc(format(totals[key],key,currency))}</strong><small>${esc(explain)} ${citations(totals.evidence)}</small></article>`).join('')}</div><section class="result-panel"><div class="section-heading"><h3>分析结论</h3><span>点击引用，复核数字来源</span></div><div class="findings">${(r.findings || []).map(finding=>`<div class="finding"><span>↗</span><div>${esc(finding.text)} ${citations(finding.evidence)}</div></div>`).join('') || '<p class="help">当前结果没有可归纳的结论，请查看下方数据。</p>'}</div></section><section class="result-panel"><div class="section-heading"><h3>原始指标比较</h3><span>${rows.length} 个对象</span></div>${chart}<div class="table-wrap"><table><thead><tr>${columns.map(([key,label])=>`<th scope="col" class="${key!=='label'?'numeric':''}">${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(([key])=>`<td class="${key!=='label'?'numeric':''}">${key==='evidence'?citations(row.evidence):esc(key==='label'?row.label:format(row[key],key,currency))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section><section class="result-panel"><div class="section-heading"><h3>本次口径与边界</h3><span>与导出的报告一并保留</span></div><ul class="limitations">${[...definitionItems(r.definitions),...(r.limitations || [])].map(item=>`<li>${esc(item)}</li>`).join('')}</ul><details class="report-source"><summary>查看数据来源、字段映射与导入决定</summary><pre>${esc(pretty({dataset:run.dataset,contract:run.contract}))}</pre></details></section><section class="result-panel"><div class="tabs"><button class="active" data-result-tab="queries">查询证据 <span>(${queries.length})</span></button><button data-result-tab="trace">运行追踪</button></div><div id="queriesPane">${queries.map(query=>`<article class="query" id="evidence-${esc(query.id)}"><div class="query-heading"><strong>${esc(query.id)} · ${esc(query.label)}</strong><span>${esc(query.elapsed_ms ?? '—')} ms · ${(query.rows || []).length} 行</span></div><div class="query-meta"><strong>本次筛选条件</strong><pre>${esc(pretty(query.filters || run.plan?.filters || {}))}</pre><strong>工具参数</strong><pre>${esc(pretty({tool_params:query.params || {},sql_params:query.sql_params || []}))}</pre><span>来源：${esc((query.source_tables || []).join('、'))}<br>数据指纹：${esc(query.source_hash || run.dataset?.source_hash || '—')}</span></div><details class="query-raw"><summary>查看原始返回值</summary><pre>${esc(pretty({raw_rows:query.raw_rows || [],derived_rows:query.rows || [],source_rows:query.source_rows || []}))}</pre></details><details class="query-sql"><summary>查看本次只读查询</summary><pre>${esc(query.sql || pretty(query))}</pre></details></article>`).join('')}</div><div id="tracePane" class="hidden">${(run.trace || []).map(step=>`<div class="trace-item"><span class="trace-node"></span><div><strong>${esc(({intent:'理解问题',clarification:'澄清条件',plan:'确认计划',sql:'执行只读工具',tool:'执行只读工具',evidence:'绑定证据',complete:'完成分析'})[step.stage] || step.stage)}</strong><small>+${esc(step.at_ms ?? 0)} ms</small><p>${esc(typeof step.detail==='object'?JSON.stringify(step.detail):step.detail)}</p></div></div>`).join('')}</div></section>`;
  $('#report').classList.remove('hidden');
  $$('[data-width]').forEach(bar=>bar.style.width=`${Math.max(0,Math.min(100,Number(bar.dataset.width)))}%`);
  $$('[data-result-tab]').forEach(button=>button.addEventListener('click',()=>{ $$('[data-result-tab]').forEach(other=>other.classList.toggle('active',other===button)); $('#queriesPane').classList.toggle('hidden',button.dataset.resultTab!=='queries'); $('#tracePane').classList.toggle('hidden',button.dataset.resultTab!=='trace'); }));
  $$('[data-cite]').forEach(button=>button.addEventListener('click',()=>{
    $('[data-result-tab="queries"]').click();
    const query=document.getElementById('evidence-'+button.dataset.cite);
    if (query) { query.querySelector('.query-raw').open=true; query.classList.add('referenced'); query.scrollIntoView({behavior:'smooth',block:'center'}); setTimeout(()=>query.classList.remove('referenced'),2000); }
  }));
  $('#exportJson').addEventListener('click',()=>download(pretty(run),`${safeName(run.id)}.json`,'application/json;charset=utf-8'));
  $('#exportMd').addEventListener('click',()=>download(markdown(run),`${safeName(run.id)}.md`,'text/markdown;charset=utf-8'));
}
function safeName(value) { return String(value || 'metricpilot-report').replace(/[^a-zA-Z0-9_-]/g,'_'); }
function markdown(run) {
  const r=run.report;
  return `# MetricPilot · ${r.title}\n\n问题：${run.question || ''}\n\n期间：${periodLabel(r.period)}\n\n引擎：${run.engine}；耗时：${run.elapsed_ms} ms\n\n## 数据来源与导入决定\n\n\`\`\`json\n${pretty(run.dataset)}\n\`\`\`\n\n## 本次口径确认\n\n\`\`\`json\n${pretty(run.contract)}\n\`\`\`\n\n${definitionItems(r.definitions).map(item=>'- '+item).join('\n')}\n\n## 结论\n\n${(r.findings || []).map(item=>`- ${item.text} [${(Array.isArray(item.evidence)?item.evidence:[item.evidence]).filter(Boolean).join(', ')}]`).join('\n')}\n\n## 汇总与分组结果\n\n\`\`\`json\n${pretty({totals:r.totals,rows:r.rows})}\n\`\`\`\n\n## 查询证据\n\n${(run.queries || []).map(query=>`### ${query.id} · ${query.label}\n\n\`\`\`sql\n${query.sql || ''}\n\`\`\`\n\n筛选条件与工具参数：\n\n\`\`\`json\n${pretty({filters:query.filters,params:query.params,sql_params:query.sql_params,source_tables:query.source_tables,source_hash:query.source_hash || run.dataset?.source_hash})}\n\`\`\`\n\n原始结果：\n\n\`\`\`json\n${pretty({raw_rows:query.raw_rows,derived_rows:query.rows,source_rows:query.source_rows})}\n\`\`\``).join('\n\n')}\n\n## 分析边界\n\n${(r.limitations || []).map(item=>'- '+item).join('\n')}\n`;
}
function download(content,name,type) { const url=URL.createObjectURL(new Blob([content],{type})); const anchor=document.createElement('a'); anchor.href=url; anchor.download=name; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
async function analyze(event) {
  event.preventDefault(); if (running) return;
  for (const id of ['emptyState','errorState','clarificationState','report']) $('#'+id).classList.add('hidden');
  if (!dataset) { errorAt('#errorState','请先导入一份订单表。'); return; }
  if (!$('#refundBasis').value || !$('#cancelled').value || !$('#confirmContract').checked) { errorAt('#errorState','请明确选择退款日期口径、取消订单处理方式，并确认指标定义。'); return; }
  const question=$('#question').value.trim();
  if (!question) { errorAt('#errorState','请输入你要分析的问题。'); return; }
  if ($('#start').value && $('#end').value && $('#start').value>$('#end').value) { errorAt('#errorState','开始日期不能晚于结束日期，请调整分析期间。'); return; }
  running=true; $('#submit').disabled=true; $('#loadingState').classList.remove('hidden');
  try {
    const run=await api('/api/run',{dataset_id:dataset.id,question,filters:Object.fromEntries(['start','end','metric','channel'].map(key=>[key,key==='metric' && $('#metric').value==='auto'?'':$('#'+key).value])),contract:{confirmed:true,refund_basis:$('#refundBasis').value,cancelled:$('#cancelled').value,cancelled_values:$('#cancelledValues').value.split(/[,，]/).map(value=>value.trim()).filter(Boolean)},mode:'demo'});
    renderRun(run); loadHistory();
  } catch(error) { $('#loadingState').classList.add('hidden'); errorAt('#errorState',error.message); }
  finally { running=false; $('#submit').disabled=!dataset; }
}
function suggestTask(task) {
  if (!dataset) { errorAt('#errorState','先导入订单表，再选择分析任务。'); return; }
  const start=$('#start').value, end=$('#end').value;
  const period=start && end?`${start} 至 ${end}，`:'';
  $('#question').value=period+({overview:'这段时间的净收入是多少？',channel:'各渠道净收入比较。',refund:'退款金额占毛收入的比例是多少？'})[task];
  $('#metric').value='auto'; $('#question').focus();
}
async function loadSource() {
  if (!dataset) { $('#sourceTable').innerHTML='<p class="empty-list">请先导入一份 CSV。</p>'; return; }
  $('#sourceMeta').innerHTML=`<div class="panel-heading"><div><h2>${esc(dataset.name)} · ${esc(dataset.row_count)} 笔订单</h2><p>${esc(dataset.date_start)} — ${esc(dataset.date_end)} · ${esc(dataset.currency)} · 原始金额${dataset.amount_unit==='minor'?'最小单位':'主单位'}</p></div><span class="tag">用户导入</span></div><details><summary>查看数据指纹、字段映射与处理记录</summary><pre>${esc(pretty({source_hash:dataset.source_hash,mapping:dataset.mapping,decisions:dataset.decisions,capabilities:dataset.capabilities}))}</pre></details>`;
  try { const data=await api('/api/source?dataset_id='+encodeURIComponent(dataset.id)); $('#sourceTable').innerHTML=renderTable(data.rows || data.preview || [],data.columns); }
  catch(error) { $('#sourceTable').textContent=error.message; }
}
async function loadHistory() {
  try {
    const result=await api('/api/sessions'), sessions=Array.isArray(result)?result:result.sessions || [];
    $('#recent').innerHTML=sessions.slice(0,5).map(session=>`<button data-session="${esc(session.id)}" title="${esc(session.question)}">${session.status==='needs_clarification'?'?':'↗'} ${esc(session.question)}</button>`).join('') || '<p class="empty-list">暂无分析记录。</p>';
    $('#historyList').innerHTML=sessions.map(session=>`<button class="history-card" data-session="${esc(session.id)}"><div><strong>${esc(session.question)}</strong><p>${esc(session.created_at || '')} · ${esc(session.dataset?.name || session.dataset_name || '订单分析')} · ${esc(session.elapsed_ms)} ms</p></div><span>${session.status==='needs_clarification'?'待澄清':'已完成'} ↗</span></button>`).join('') || '<div class="empty-state"><h2>还没有分析记录</h2><p>导入订单表并完成一次分析后，可回看问题、口径和查询。</p></div>';
    $$('[data-session]').forEach(button=>button.addEventListener('click',async()=>{
      try { const run=await api('/api/session/'+encodeURIComponent(button.dataset.session)); if(run.dataset?.id) setDataset(run.dataset); view('analysis'); $('#question').value=run.question || ''; const period=run.plan?.periods?.[0] || []; $('#start').value=period[0] || ''; $('#end').value=period[1] || ''; $('#metric').value=run.plan?.metric || 'auto'; $('#channel').value=run.plan?.channel || ''; $('#refundBasis').value=run.contract?.refund_basis || ''; $('#cancelled').value=run.contract?.cancelled || ''; $('#cancelledValues').value=(run.contract?.cancelled_values || []).join(','); $('#confirmContract').checked=false; renderRun(run); }
      catch(error) { view('analysis'); errorAt('#errorState',error.message); }
    }));
  } catch { $('#recent').textContent='暂时无法读取分析记录'; }
}

$('#csvFile').addEventListener('change',event=>readFile(event.target.files[0]));
for (const type of ['dragenter','dragover']) $('#dropZone').addEventListener(type,event=>{event.preventDefault();$('#dropZone').classList.add('dragging');});
for (const type of ['dragleave','drop']) $('#dropZone').addEventListener(type,event=>{event.preventDefault();$('#dropZone').classList.remove('dragging');});
$('#dropZone').addEventListener('drop',event=>{if(event.dataTransfer.files.length!==1){errorAt('#importError','首版一次只接收一份订单 CSV，请选择单个文件。');return;}readFile(event.dataTransfer.files[0]);});
OPTION_IDS.forEach(id=>$('#'+id).addEventListener('change',invalidateCheck));
$('#checkImport').addEventListener('click',checkImport); $('#commitImport').addEventListener('click',commitImport);
$('#askForm').addEventListener('submit',analyze);
$$('[data-view]').forEach(button=>button.addEventListener('click',()=>view(button.dataset.view)));
$$('[data-task]').forEach(button=>button.addEventListener('click',()=>suggestTask(button.dataset.task)));
$('#useDatasetRange').addEventListener('click',()=>{if(!dataset){errorAt('#errorState','请先导入一份订单表。');return;}$('#start').value=dataset.date_start;$('#end').value=dataset.date_end;});
['refundBasis','cancelled','cancelledValues'].forEach(id=>$('#'+id).addEventListener('change',()=>$('#confirmContract').checked=false));
$('#refreshHistory').addEventListener('click',loadHistory); $('#refreshSource').addEventListener('click',loadSource);
async function init() {
  try {
    meta=await api('/api/meta'); csrfToken=meta.csrf_token;
    for (const [id,value] of Object.entries(meta.metrics || {})) { const option=document.createElement('option');option.value=id;option.textContent=typeof value==='string'?value:value.label || value.name || id;$('#metric').append(option); }
    let previous; try { previous=localStorage.getItem(STORAGE_KEY); } catch { /* Storage is optional. */ }
    if(previous) { try { const result=await api('/api/dataset/'+encodeURIComponent(previous));setDataset(result.dataset || result); } catch { try{localStorage.removeItem(STORAGE_KEY);}catch{/* Storage is optional. */} } }
    loadHistory();
  } catch(error) { errorAt('#importError','无法连接本机服务：'+error.message); }
}
init();
