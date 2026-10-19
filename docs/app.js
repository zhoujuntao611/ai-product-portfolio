(function () {
  'use strict';
  const config = window.PORTFOLIO_CONFIG || {};
  const workflows = {
    supportflow: [
      { title: '先让资料可用、可维护。', text: '导入带来源、地区、版本和有效期的知识；用同义表达与逐问题 BM25 检索。政策更新后拦截旧稿，避免旧依据继续进入审核。', detail: '产品取舍：先用可解释的词法方案建立基线，再验证更复杂检索是否必要。' },
      { title: '有引用，还要回答所问事项。', text: '退款申请窗口不能证明到账时效，文件保留时间也不能证明导出耗时。对实际选中条款检查事项、周期和问题覆盖；缺少支持就澄清，可选模型只选择已有证据编号。', detail: '产品取舍：采用显式支持规则与正向对照；尚未验证开放域语义判断或真实模型效果。' },
      { title: '审核修改，成为下一轮改进依据。', text: '批准、驳回和转人工均保存编辑稿、原因及来源版本。可导出问题样例并复核；人工修改与自动验证区分标记，回复不自动外发。', detail: '产品取舍：先沉淀可回查的反馈，再决定新增知识还是修改规则。' }
    ],
    metricpilot: [
      { title: '先把自己的订单表变成可分析的数据。', text: '预览订单 CSV、映射字段并检查数据质量，确认退款按原订单日还是发生日统计。问题与确认口径冲突时暂停查询，由用户统一。', detail: '产品取舍：让冲突先显现，避免带完整证据回答了错误的问题。' },
      { title: '让统计工具只执行已确认的任务。', text: '使用受约束的只读统计工具，明确期间、渠道、指标和分母。混合期间、不支持的分母与多条件先澄清，防止静默截断。CSV 版当前入口使用规则解析，没有外部模型调用。', detail: '产品取舍：有限问题范围换取口径和执行可核对，尚非通用自然语言转 SQL。' },
      { title: '从结论，追到订单源行。', text: '报告关联源文件指纹、源行号、SQL 参数、查询编号与结果。金额用整数分计算；退款归属与分母随报告保存，缺少证据时不解释经营原因。', detail: '产品取舍：数字可复核与问题理解正确分别验收，不能只看报告是否生成。' }
    ],
    climbai: [
      { title: '让训练重点，有可回查的依据。', text: '画像节点读取档案和训练记录，区分已知事实、用户自评与待验证判断。未测量的能力保留未知；用户可以修正档案和目标。', detail: '产品取舍：用可解释的观察建立信任，避免未经测量的能力分数。' },
      { title: '把个人条件，变成有来源的训练安排。', text: '30 条知识由浏览器与后端共享，覆盖基础术语、装备、场馆规则与训练记录。检索返回来源和适用条件，规划按目标、时间及器材生成可回看的版本；资料不足时说明无法确认。', detail: '产品取舍：先维护同一份可追溯知识；保留 10 个练习模板，未新增强度或负荷处方。' },
      { title: '结束训练以后，再决定下一次怎么练。', text: '训练结束独立保存，用户可稍后补反馈。反馈节点展示原计划、调整建议与原因，用户选择接受或保持；出现不适时暂停相关推荐。', detail: '产品取舍：保持原计划也是有效结果；训练完成与反馈提交分别计数，保留完整分母。' }
    ]
  };

  const cases = {
    supportflow: {
      kicker: 'CASE 01 / KNOWLEDGE & HUMAN REVIEW', name: 'SupportFlow', subtitle: '从知识导入到审核反馈，检查来源是否真正支持当前问题。',
      fact: 'AI 协作个人作品 · 合成政策与开发回归 · 可选模型接口仅做本地模拟验证',
      sections: [
        { title: '发现的问题', content: '<p>问“退款多久会到账”，原实现用“7 天内申请退款”生成可批准草稿；导出保留时间也被当作生成耗时。来源存在，仍可能答非所问。问题来自可复现审阅输入，尚非客服访谈。</p>' },
        { title: '比较与选择', content: '<p>比较收紧数字规则、增加事项与周期支持检查、引入模型语义判断，选择可解释的支持检查。检索沿用同义扩展与逐问题 BM25，并与冻结关键词方案同题对照；向量与真实模型方案尚未实测。</p>' },
        { title: '交付的改进', content: '<ul><li>结构化知识导入、来源与地区版本治理；更新政策后拦截旧稿。</li><li>核对实际选中条款的事项、周期和问题覆盖；共享地区表达以发现矛盾。</li><li>各审核终态保存编辑稿、原因及来源版本，导出问题样例；修复同秒历史排序。</li></ul>' },
        { title: '同题验证与边界', content: '<p>本轮同 26 条审阅回归由 14 条提升至 26 条通过，工程回归 118/118。此前冻结关键词基线与完整新版流程同 60 题对照为 33/60 → 60/60，未做 BM25 单项消融；两组分母分开报告。<a href="https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/supportflow/docs/ITERATION_EVIDENCE.md" target="_blank" rel="noopener noreferrer">查看方案、冻结基线与逐题证据 ↗</a></p><p>均为参与开发的合成回归，不是盲测、真实模型准确率或客服效率收益；开放表述与真实试用仍待验证。</p>' }
      ]
    },
    metricpilot: {
      kicker: 'CASE 02 / CSV & METRIC CONTRACT', name: 'MetricPilot', subtitle: '让订单导入、字段映射、业务口径和查询证据保持一致。',
      fact: 'AI 协作个人作品 · CSV 订单分析 · 当前为规则解析与受约束统计，未调用外部模型',
      sections: [
        { title: '发现的问题', content: '<p>固定数据无法接入自己的订单；CSV 版又出现“数字正确、任务错误”：混合期间只保留一段，问题要求退款发生日却沿用原订单日，未知分母被替换为毛收入。同一 9 单样例的两种日期口径分别得到 30 元与 120 元。</p>' },
        { title: '比较与选择', content: '<p>选择受约束统计工具，限定范围并保留查询证据。对界面与问题冲突，比较两种自动覆盖与先确认，选择冲突时零查询；混合期间要求统一表达，未知分母明确澄清。尚未开展备选方案的真实模型对照。</p>' },
        { title: '交付的改进', content: '<ul><li>订单 CSV 预览、字段映射、数据质量检查与口径确认。</li><li>阻止混合期间截断、日期归属冲突和运算分母被静默替换。</li><li>报告保留源文件指纹、源行号、参数与查询编号，支持导出。</li></ul>' },
        { title: '同题验证与边界', content: '<p>同 22 项验收：11/22 → 首次修复 17/22 → 最终 22/22；CSV 版工程回归 90/90，固定业务任务 24/24。旧版 72 项另列，不当作新版业务效果。<a href="https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/metricpilot/docs/ITERATION-20261019.md" target="_blank" rel="noopener noreferrer">查看冻结版本、手算夹具与逐题证据 ↗</a></p><p>各组任务有重叠，不能累计为独立样本；当前不是已验证的真实 LLM Agent。不支持任意 SQL、多币种或经营因果解释，真人任务效果待测。</p>' }
      ]
    },
    climbai: {
      kicker: 'CASE 03 / TOC AI COACH & FEEDBACK LOOP', name: 'ClimbAI', subtitle: '从个人目标出发，让训练、反馈和下一次安排形成持续使用的产品闭环。',
      demo: 'climbai/',
      fact: '2026.10 新建 · AI 协作个人作品 · 可交互浏览器演示 / 本地规则与示例数据 · 可选后端真实模型尚未调用',
      sections: [
        { title: '用户场景与目标', content: '<p>聚焦室内抱石初阶用户的训练决策与复盘场景，降低“今天练什么”和“下次怎么调整”的负担。痛点与价值仍是待验证假设，尚未开展真实用户访谈或训练效果试验。</p>' },
        { title: '知识问题与方案选择', content: '<p>原先后端 10 条知识与浏览器内置 4 条示例各自维护，覆盖有限且容易不同步。选择前后端共享一份 30 条知识，扩充术语、装备与场馆问题；保留原有 10 个练习模板，不增加未经审核的负荷处方。</p><p>18 条带外部参考、12 条为自编产品规则；外部依据来自 7 个官方页面，逐条标注支持范围、适用条件和待教练审核状态。</p>' },
        { title: 'Agent 与交互设计', content: '<ul><li>画像、知识检索、训练规划、反馈优化四个受控节点，展示决策依据与运行轨迹。</li><li>独立保存训练结束，反馈可稍后提交；计划版本可回看。</li><li>调整建议显示原因，用户可接受或保持；不适反馈暂停相关训练推荐。</li></ul>' },
        { title: '验证方法与当前边界', content: '<p>10 月 15 日记录：50/50 固定检索验收、14 项定向浏览器检查通过；50 条检索题已包含于 116 项后端测试，不重复计数。<a href="https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/climbai/docs/VALIDATION.md" target="_blank" rel="noopener noreferrer">查看原始验收及范围 ↗</a></p><p>在线为本地规则演示。知识扩充不证明训练效果；原生 Chroma 未在扩充回归中重验，真实模型、真人试用及专业教练逐条审核待完成。</p>' }
      ]
    }
  };

  function safeUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try { const url = new URL(value); return url.protocol === 'https:' ? url.href.replace(/\/$/, '') : ''; }
    catch (_) { return ''; }
  }
  const repo = safeUrl(config.repoUrl);
  const branch = encodeURIComponent(config.branch || 'main');
  function projectUrl(project) {
    if (!repo) return '';
    if (!project) return repo;
    const path = (config.projectPaths && config.projectPaths[project]) || ('projects/' + project);
    return repo + '/tree/' + branch + '/' + path.split('/').map(encodeURIComponent).join('/');
  }
  function docUrl(project) {
    const override = safeUrl(config.docs && config.docs[project]);
    if (override) return override;
    if (!repo) return '';
    const path = (config.projectPaths && config.projectPaths[project]) || ('projects/' + project);
    return repo + '/blob/' + branch + '/' + path.split('/').map(encodeURIComponent).join('/') + '/docs/PRD.md';
  }
  function setLink(link, url) {
    if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    else { link.href = '#source'; link.removeAttribute('target'); link.removeAttribute('rel'); }
  }
  function configureLinks(scope) {
    scope.querySelectorAll('[data-repo-url]').forEach(link => setLink(link, projectUrl(link.dataset.repoUrl)));
    scope.querySelectorAll('[data-doc-url]').forEach(link => setLink(link, docUrl(link.dataset.docUrl)));
    scope.querySelectorAll('[data-metric]').forEach(node => {
      const value = config.metrics && config.metrics[node.dataset.metric];
      if (typeof value === 'string' && value.trim()) node.textContent = value;
    });
  }
  configureLinks(document);
  if (repo) document.getElementById('source-status').textContent = '源码、运行说明与离线验收记录均在项目仓库中。';

  document.querySelectorAll('[data-workflow]').forEach(workflow => {
    const project = workflow.dataset.workflow;
    const tabs = Array.from(workflow.querySelectorAll('[role="tab"]'));
    const panel = workflow.querySelector('[role="tabpanel"]');
    function select(index, focus) {
      tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; });
      const content = workflows[project][index];
      panel.querySelector('h4').textContent = content.title;
      panel.querySelector('p').textContent = content.text;
      panel.querySelector('.workflow-detail').textContent = content.detail;
      panel.setAttribute('aria-labelledby', tabs[index].id);
      if (focus) tabs[index].focus();
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(index, false));
      tab.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else return;
        event.preventDefault(); select(next, true);
      });
    });
  });

  const dialog = document.getElementById('case-dialog');
  let dialogTrigger = null;
  document.querySelectorAll('[data-case]').forEach(trigger => {
    trigger.addEventListener('click', event => {
      if (typeof dialog.showModal !== 'function') return;
      const project = trigger.dataset.case, item = cases[project];
      if (!item) return;
      event.preventDefault();
      dialogTrigger = trigger;
      document.getElementById('dialog-kicker').textContent = item.kicker;
      const content = document.getElementById('dialog-content');
      content.innerHTML = '<h2 id="dialog-title">' + item.name + '</h2><p class="dialog-subtitle">' + item.subtitle + '</p>' +
        '<p class="dialog-fact">' + (item.fact || '2026.10 新建 · AI 协作个人作品 · 合成数据 / 离线规则演示 · 真实模型效果尚未实测') + '</p>' +
        '<div class="case-sections">' + item.sections.map(section => '<section><h3>' + section.title + '</h3>' + section.content + '</section>').join('') + '</div>' +
        '<p class="case-metric" data-metric="' + project + '">离线回归，结果待写入</p>' +
        '<div class="dialog-links">' + (item.demo ? '<a class="button primary" href="' + item.demo + '">体验演示 <span aria-hidden="true">↗</span></a>' : '') + '<a class="button ' + (item.demo ? 'secondary' : 'primary') + '" data-doc-url="' + project + '" href="#source">阅读产品文档 <span aria-hidden="true">↗</span></a><a class="text-link" data-repo-url="' + project + '" href="#source">查看源码 <span aria-hidden="true">↗</span></a></div>';
      configureLinks(content);
      document.body.classList.add('modal-open');
      dialog.showModal();
      dialog.scrollTop = 0;
      dialog.querySelector('.close-dialog').focus();
    });
  });
  dialog.querySelector('.close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => { document.body.classList.remove('modal-open'); if (dialogTrigger) dialogTrigger.focus(); });

  document.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || link.getAttribute('href') !== '#source' || !link.matches('[data-repo-url],[data-doc-url]')) return;
    if (dialog.open) dialog.close();
    const source = document.getElementById('source');
    source.classList.remove('source-attention');
    void source.offsetWidth;
    source.classList.add('source-attention');
    document.getElementById('source-status').textContent = '仓库链接尚未配置；产品详情与流程仍可在此页面展开查看。';
  });
  document.documentElement.classList.remove('no-js');
})();
