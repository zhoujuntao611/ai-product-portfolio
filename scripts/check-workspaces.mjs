import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'verification/workspaces-current');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'portfolio-workspaces-'));
const processes=[], errors=[], report={scope:'Disposable local stores, synthetic tickets and nine-order CSV; no model calls.',checks:[]};
await fs.mkdir(output,{recursive:true});
let browser;
async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
async function start(script,env={}){
  const port=await freePort(), url=`http://127.0.0.1:${port}`;
  const child=spawn(process.env.PYTHON || 'python',['-u',script,'--port',String(port)],{cwd:root,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});
  processes.push(child);let log='',spawnError;
  child.on('error',e=>spawnError=e);child.stdout.on('data',s=>log=(log+s).slice(-2000));child.stderr.on('data',s=>log=(log+s).slice(-2000));
  for(let i=0;i<100;i++){
    if(spawnError)throw spawnError;
    if(child.exitCode!==null)throw new Error('Server stopped: '+log);
    try{if((await fetch(url)).ok)return url;}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('Server did not start: '+log);
}
async function check(name,fn){await fn();report.checks.push({name,passed:true});console.log('PASS '+name);}
async function pageFor(url){const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce',acceptDownloads:true});p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))errors.push(`${r.status()} ${r.url()}`);});await p.goto(url);return p;}
async function screenshot(p,name){if(await p.locator('#toast').count())await p.locator('#toast').waitFor({state:'hidden'});await p.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});await p.screenshot({path:path.join(output,name+'.png')});}
async function download(p,selector){const [d]=await Promise.all([p.waitForEvent('download'),p.click(selector)]);return fs.readFile(await d.path(),'utf8');}
async function fits(p,label){for(const width of [320,390,768,1440]){await p.setViewportSize({width,height:1000});await check(`${label} ${width}px`,async()=>{const layout=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,over:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,id:e.id,cls:e.className,right:e.getBoundingClientRect().right}))}));if(layout.scroll>width)await screenshot(p,label+'-overflow-'+width);assert.ok(layout.scroll<=width,JSON.stringify(layout));});}await screenshot(p,label);}
try{
  const support=await start('projects/supportflow/verification/isolated_server.py');
  const metric=await start('projects/metricpilot/app.py',{METRICPILOT_DATA_DIR:path.join(temporary,'metricpilot')});
  browser=await chromium.launch({headless:true,...(process.env.QA_BROWSER_PATH?{executablePath:process.env.QA_BROWSER_PATH}:{})});
  const s=await pageFor(support);
  await s.waitForFunction(()=>document.querySelector('#count-knowledge').textContent==='9');
  await check('SupportFlow loads workspace stylesheet',async()=>{assert.equal(await s.locator('.sidebar').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(245, 246, 248)');});
  async function ticket(example){await s.selectOption('#example',example);const response=s.waitForResponse(r=>r.url()===support+'/api/tickets'&&r.request().method()==='POST');await s.click('#generate');const data=await(await response).json();await s.waitForFunction(id=>document.querySelector('#ticket-id').textContent==='#'+id,data.id);return data;}
  await check('Unknown region blocks approval',async()=>{const data=await ticket('refund');assert.equal(data.result.can_approve,false);assert.equal(await s.locator('#approve').isDisabled(),true);});
  await check('Invoice draft and exact supporting clauses',async()=>{const data=await ticket('invoice');assert.equal(data.result.status,'ready');await s.click('[data-tab=evidence]');assert.ok(await s.locator('#claims .claim-card').count()>0);assert.match(await s.locator('#claims').innerText(),/v1.4/);if(process.argv.includes('--update-previews')){await screenshot(s,'supportflow-citations');await fs.copyFile(path.join(output,'supportflow-citations.png'),path.join(root,'docs/assets/supportflow-citations.png'));}await s.click('[data-tab=draft]');});
  await fits(s,'supportflow');
  if(process.argv.includes('--update-previews'))await fs.copyFile(path.join(output,'supportflow.png'),path.join(root,'docs/assets/supportflow.png'));
  await check('Draft references open the exact clause in place',async()=>{
    await s.locator('.citation-link').first().click();
    assert.equal(await s.locator('#citation-detail').isVisible(),true);
    assert.match(await s.locator('#citation-detail').innerText(),/v1.4/);
    assert.match(await s.locator('#citation-detail blockquote').innerText(),/发票/);
    await s.locator('#citation-detail button').click();
  });
  await check('Reopening the same ticket retains unsaved edits',async()=>{
    await s.fill('#draft',(await s.locator('#draft').inputValue())+'\n未保存的审核补充。');
    await s.locator('.history-item').first().click();
    assert.match(await s.locator('#draft').inputValue(),/未保存的审核补充/);
    assert.match(await s.locator('#save-status').innerText(),/未保存/);
  });
  await check('Cancelling a ticket switch protects edits and notes',async()=>{
    await s.fill('#review-note','需要保留的审核备注');
    const dialog=s.waitForEvent('dialog');
    const click=s.locator('.history-item').nth(1).click();
    await(await dialog).dismiss();await click;
    assert.match(await s.locator('#draft').inputValue(),/未保存的审核补充/);
    assert.equal(await s.locator('#review-note').inputValue(),'需要保留的审核备注');
    await s.click('#save-draft');
    await s.waitForFunction(()=>document.querySelector('#save-status').textContent==='已保存');
  });
  await check('Editing draft resets reviewer confirmation',async()=>{await s.check('#review-check');await s.fill('#draft',(await s.locator('#draft').inputValue())+'\n人工补充：请核对订单。');assert.equal(await s.locator('#review-check').isChecked(),false);assert.equal(await s.locator('#approve').isDisabled(),true);});
  await check('Save, approve and reopen preserved ticket',async()=>{await s.click('#save-draft');await s.waitForFunction(()=>document.querySelector('#toast').textContent.includes('编辑与问题标记已保存'));await s.check('#review-check');await s.click('#approve');await s.waitForFunction(()=>document.querySelector('#state-label').textContent==='已批准');await s.locator('.history-item').first().click();await s.waitForFunction(()=>document.querySelector('#state-label').textContent==='已批准');assert.match(await s.locator('#draft').inputValue(),/人工补充/);assert.equal(await s.locator('#draft').getAttribute('readonly'),'');});
  await check('Draft export keeps source versions',async()=>{assert.match(await download(s,'#export-draft'),/v1.4/);});
  await s.click('[data-page=knowledge]');
  await check('Policy search and version history still work',async()=>{await s.fill('#knowledge-search','KB-002');await s.locator('#knowledge-list .source-card').first().getByRole('button',{name:'版本历史'}).click();await s.locator('#version-list .source-card').first().waitFor();await s.click('#close-versions');});
  await fits(s,'supportflow-knowledge');
  if(process.argv.includes('--update-previews'))await fs.copyFile(path.join(output,'supportflow-knowledge.png'),path.join(root,'docs/assets/supportflow-policy.png'));
  await s.click('[data-page=about]');await fits(s,'supportflow-about');

  const m=await pageFor(metric);
  await m.waitForFunction(()=>typeof csrfToken==='string'&&csrfToken.length>10);
  await fits(m,'metricpilot-import');
  if(process.argv.includes('--update-previews'))await fs.copyFile(path.join(output,'metricpilot-import.png'),path.join(root,'docs/assets/metricpilot-import.png'));
  await check('CSV preview and explicit mapping decisions',async()=>{
    await m.locator('#csvFile').setInputFiles(path.join(root,'projects/metricpilot/tests/fixtures/hand-check-orders.csv'));
    await m.locator('#mappingFields select').first().waitFor();assert.match(await m.locator('#previewCaption').innerText(),/9/);
    for(const [id,value] of [['dateFormat','iso'],['amountUnit','major'],['currency','CNY']]){assert.equal(await m.locator('#'+id).inputValue(),'');await m.selectOption('#'+id,value);}
    await m.click('#checkImport');await m.waitForFunction(()=>!document.querySelector('#commitImport').disabled);
    await m.selectOption('#amountUnit','minor');assert.equal(await m.locator('#commitImport').isDisabled(),true);await m.selectOption('#amountUnit','major');await m.click('#checkImport');await m.waitForFunction(()=>!document.querySelector('#commitImport').disabled);
  });
  await fits(m,'metricpilot-mapping');
  if(process.argv.includes('--update-previews'))await fs.copyFile(path.join(output,'metricpilot-mapping.png'),path.join(root,'docs/assets/metricpilot-mapping.png'));
  await m.click('#commitImport');await m.locator('#analysisView').waitFor({state:'visible'});
  await fits(m,'metricpilot-query');
  await m.fill('#start','2026-01-01');await m.fill('#end','2026-01-31');await m.selectOption('#refundBasis','order_date');await m.selectOption('#cancelled','exclude');await m.fill('#cancelledValues','cancelled');
  async function ask(question){if(!await m.locator('#queryEditor').evaluate(e=>e.open))await m.locator('#queryEditor>summary').click();await m.fill('#question',question);await m.check('#confirmContract');const response=m.waitForResponse(r=>r.url()===metric+'/api/run'&&r.request().method()==='POST');await m.click('#submit');return(await response).json();}
  await check('Exact channel result; query folds to show report',async()=>{const r=await ask('比较各渠道净收入');assert.equal(r.status,'completed');assert.equal(r.report.totals.net_cents,23000);assert.deepEqual(Object.fromEntries(r.report.rows.map(x=>[x.label,x.net_cents])),{organic:8000,paid:15000});await m.waitForFunction(()=>!document.querySelector('#queryEditor').open);await m.locator('#report').waitFor({state:'visible'});});
  await fits(m,'metricpilot');
  if(process.argv.includes('--update-previews'))await fs.copyFile(path.join(output,'metricpilot.png'),path.join(root,'docs/assets/metricpilot.png'));
  await check('Citation reveals original query and source rows',async()=>{await m.locator('[data-cite=Q1]').first().click();assert.equal(await m.locator('#evidence-Q1 .query-raw').evaluate(e=>e.open),true);assert.match(await m.locator('#evidence-Q1').innerText(),/2026-01-01/);});
  await check('Report downloads retain provenance',async()=>{for(const id of ['#exportMd','#exportJson']){const value=await download(m,id);for(const term of ['source_hash','source_rows','refund_basis','23000'])assert.ok(value.includes(term));}});
  await m.locator('#queryEditor>summary').click();await m.fill('#start','');await m.fill('#end','');
  await check('Conflicting refund basis performs zero queries',async()=>{const r=await ask('2026年2月按退款发生日统计退款金额');assert.equal(r.status,'needs_clarification');assert.equal(r.queries.length,0);assert.equal(await m.locator('#queryEditor').evaluate(e=>e.open),true);});
  await check('Clarification action changes basis without running a query',async()=>{
    let requests=0;const handler=request=>{if(request.url()===metric+'/api/run')requests++;};m.on('request',handler);
    await m.getByRole('button',{name:'将条件改为退款发生日'}).click();
    assert.equal(await m.locator('#refundBasis').inputValue(),'refund_date');
    assert.equal(await m.locator('#confirmContract').isChecked(),false);
    assert.equal(requests,0);m.off('request',handler);
  });
  await check('Changing basis produces CNY 120',async()=>{const r=await ask('2026年2月按退款发生日统计退款金额');assert.equal(r.report.totals.refund_cents,12000);assert.match(await m.locator('#querySummary').innerText(),/退款按发生日/);});
  await check('Unsupported denominator is clarified',async()=>{const r=await ask('2026年1月退款金额占净收入比例');assert.equal(r.status,'needs_clarification');assert.equal(r.queries.length,0);});
  await m.locator('.nav-item[data-view=sources]').click();await m.locator('#sourceTable table').waitFor();await fits(m,'metricpilot-source');
  await m.locator('.nav-item[data-view=history]').click();await m.locator('.history-card').first().waitFor();await fits(m,'metricpilot-history');
  await check('No browser errors or missing assets',async()=>assert.deepEqual(errors,[]));
  report.passed=true;
}catch(e){report.passed=false;report.error=e.stack;console.error(e);process.exitCode=1;}
finally{
  if(browser)await browser.close();
  await Promise.all(processes.map(child=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill();})));
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep+'portfolio-workspaces-'));
  await fs.rm(temporary,{recursive:true,force:true});
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`${report.checks.length} workspace checks; passed=${report.passed}`);
}
