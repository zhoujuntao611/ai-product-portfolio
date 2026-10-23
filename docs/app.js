(function () {
  'use strict';
  const config = window.PORTFOLIO_CONFIG || {};
  const workflows = {
    supportflow: [
      { title: '先让资料可用、可维护。', text: '导入带来源、地区、版本和有效期的知识；用同义表达与逐问题 BM25 检索。政策更新后拦截旧稿，避免旧依据继续进入审核。', detail: '先用可解释的词法方案建立基线，再验证更复杂检索是否必要。' },
      { title: '有引用，还要回答所问事项。', text: '退款申请窗口不能证明到账时效，文件保留时间也不能证明导出耗时。对实际选中条款检查事项、周期和问题覆盖；缺少支持就澄清，可选模型只选择已有证据编号。', detail: '采用显式支持规则与正向对照；已完成限定场景的真实模型接入检查，开放域泛化与用户效果仍需验证。' },
      { title: '审核修改，成为下一轮改进依据。', text: '批准、驳回和转人工均保存编辑稿、原因及来源版本。可导出问题样例并复核；人工修改与自动验证区分标记，回复不自动外发。', detail: '先沉淀可回查的反馈，再决定新增知识还是修改规则。' }
    ],
    metricpilot: [
      { title: '先把自己的订单表变成可分析的数据。', text: '预览订单 CSV、映射字段并检查数据质量，确认退款按原订单日还是发生日统计。问题与确认口径冲突时暂停查询，由用户统一。', detail: '让冲突先显现，避免带完整证据回答了错误的问题。' },
      { title: '让统计工具只执行已确认的任务。', text: '使用受约束的只读统计工具，明确期间、渠道、指标和分母。混合期间、不支持的分母与多条件先澄清，防止静默截断。CSV 版当前入口使用规则解析，没有外部模型调用。', detail: '有限问题范围换取口径和执行可核对，尚非通用自然语言转 SQL。' },
      { title: '从结论，追到订单源行。', text: '报告关联源文件指纹、源行号、SQL 参数、查询编号与结果。金额用整数分计算；退款归属与分母随报告保存，缺少证据时不解释经营原因。', detail: '数字可复核与问题理解正确分别验收，不能只看报告是否生成。' }
    ],
    climbai: [
      { title: '让训练重点，有可回查的依据。', text: '画像节点读取档案和训练记录，区分已知事实、用户自评与待验证判断。未测量的能力保留未知；用户可以修正档案和目标。', detail: '用可解释的观察建立信任，避免未经测量的能力分数。' },
      { title: '把个人条件，变成有来源的训练安排。', text: '30 条知识由浏览器与后端共享，覆盖基础术语、装备、场馆规则与训练记录。检索返回来源和适用条件，规划按目标、时间及器材生成可回看的版本；资料不足时说明无法确认。', detail: '先维护同一份可追溯知识；保留 10 个练习模板，未新增强度或负荷处方。' },
      { title: '结束训练以后，再决定下一次怎么练。', text: '训练结束独立保存，用户可稍后补反馈。反馈节点展示原计划、调整建议与原因，用户选择接受或保持；出现不适时暂停相关推荐。', detail: '保持原计划也是有效结果；训练完成与反馈提交分别计数，保留完整分母。' }
    ]
  };

  const cases = {
  "supportflow": {
    "kicker": "客服知识与人工审核",
    "name": "SupportFlow",
    "subtitle": "找到条款之后，怎样判断它真的回答了问题？",
    "fact": "政策导入、有效版本检索、回复草稿与人工审核",
    "sections": [
      {
        "title": "先定义什么算“有依据”",
        "content": "<p>我把客服任务拆成查询政策、整理草稿、核对依据和人工审核。草稿保留来源、地区、版本和有效期；政策一旦变化，旧稿就不能继续进入审核。</p><p>只检查“有没有引用”不够。退款申请窗口不能证明到账时效，文件保留时间也不能证明导出耗时，所以还要核对条款是否支持当前问题的具体事项。</p>"
      },
      {
        "title": "一次错误拆分，暴露了流程问题",
        "content": "<p>接入模型后，“CSV 下载链接过期了，怎样重新取得数据？”被拆成丢失主语的两个问题，系统因此反复澄清。发票更正的同义表述也曾被误判为缺少依据。</p><p>我据此调整逗号拆分、主题继承和条款支持校验，并保留独立问题、地区冲突和转人工分支。问题不在回复是否流畅，而在任务是否被理解完整。</p>"
      },
      {
        "title": "用相同场景复查，也保留比较结论",
        "content": "<p>同组 24 项模型接入场景由 16 项增至 24 项通过；修复后的规则方案也通过全部 24 项，因此这次结果不能证明模型带来了额外增益。另有 26 项固定合成开发回归，通过项由 14 项增至 26 项。</p><p>这些是开发验证。下一步需要用目标用户的实际任务，观察审核负担、修改原因和采纳情况，再决定在哪些环节引入模型更合适。</p><p><a href=\"https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/docs/LIVE_PRACTICE_20261019.md\" target=\"_blank\" rel=\"noopener noreferrer\">查看请求记录与逐题结果 ↗</a></p>"
      }
    ]
  },
  "metricpilot": {
    "kicker": "业务分析与数据口径",
    "name": "MetricPilot",
    "subtitle": "先统一问题的含义，再让工具计算。",
    "fact": "CSV 导入、字段映射、口径确认、只读统计与报告导出",
    "sections": [
      {
        "title": "一份表，两种退款额",
        "content": "<p>在 9 笔合成订单中，退款按原订单日和退款发生日归属，分别得到 30 元和 120 元。两个数字都可能计算正确，却回答了不同的问题。</p><p>我比较了自动覆盖和先询问两种处理方式，选择在查询前让用户确认口径；输入问题与已选口径冲突时，暂停查询并要求统一。</p>"
      },
      {
        "title": "把确认过程放进主流程",
        "content": "<p>产品从固定数据演示扩展到用户导入 CSV：先预览、映射字段、检查质量，再确认期间、渠道、退款归属和分母。当前 CSV 入口采用规则解析，对范围外的问题先澄清。</p><p>统计工具只执行已确认的只读任务。报告保存源文件指纹、源行号、查询参数与结果，让使用者能核对每一个数字。</p>"
      },
      {
        "title": "分别检查计算与问题理解",
        "content": "<p>22 项固定验收场景通过项由 11 项增至 22 项。这些使用示例数据的开发验收，同时核对统计结果与口径冲突处理。</p><p>我希望避免的是：生成了一份证据完整的报告，却从一开始就理解错了问题。真实业务使用中的理解成本和报告采纳情况，还需要继续验证。</p>"
      }
    ]
  },
  "climbai": {
    "kicker": "早期探索：训练规划与反馈",
    "name": "ClimbAI",
    "subtitle": "攀迹之前，我先做了一个可以体验的 Web 原型。",
    "demo": "climbai/",
    "fact": "浏览器演示使用本地数据；模型接入提供独立运行记录",
    "sections": [
      {
        "title": "先把计划和反馈接起来",
        "content": "<p>面向室内抱石初阶训练，我设计了个人档案、知识检索、训练规划和反馈流程。训练结束与反馈分别保存，计划调整显示修改依据，由用户确认后形成新版本。</p>"
      },
      {
        "title": "用一个时间变化的任务验证调整",
        "content": "<p>模型接入验证里，初始条件是每次最多 45 分钟。反馈临时加班、实际只练了 25 分钟后，下一次计划由 30 分钟缩至 25 分钟，再由用户确认生效。</p><p>浏览器与后端使用同一份 30 条知识和来源、适用条件。在线演示可体验建档、记录和反馈，本地后端另有模型输入、输出及请求记录。</p>"
      },
      {
        "title": "它怎样影响后来的攀迹",
        "content": "<p>这个原型让我进一步关注：建议的依据来自哪里，训练记录能否完整留下，以及下次训练会不会再打开这些内容。后来的攀迹，因此把现场记录、线路回看和目标核对放到了更靠前的位置。</p>"
      }
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
  if (repo) document.getElementById('source-status').textContent = '源码、运行说明与验证记录均在项目仓库中。';

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
        '<p class="dialog-fact">' + (item.fact || '产品设计 · 运行交付 · 场景验证') + '</p>' +
        '<div class="case-sections">' + item.sections.map(section => '<section><h3>' + section.title + '</h3>' + section.content + '</section>').join('') + '</div>' +

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
