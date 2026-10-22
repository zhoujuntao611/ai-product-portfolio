(function () {
  'use strict';
  const config = window.PORTFOLIO_CONFIG || {};
  const workflows = {
    supportflow: [
      { title: '先让资料可用、可维护。', text: '导入带来源、地区、版本和有效期的知识；用同义表达与逐问题 BM25 检索。政策更新后拦截旧稿，避免旧依据继续进入审核。', detail: '产品取舍：先用可解释的词法方案建立基线，再验证更复杂检索是否必要。' },
      { title: '有引用，还要回答所问事项。', text: '退款申请窗口不能证明到账时效，文件保留时间也不能证明导出耗时。对实际选中条款检查事项、周期和问题覆盖；缺少支持就澄清，可选模型只选择已有证据编号。', detail: '产品取舍：采用显式支持规则与正向对照；已完成限定场景的真实模型接入检查，开放域泛化与用户效果仍需验证。' },
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
  "supportflow": {
    "kicker": "CASE 02 / KNOWLEDGE & HUMAN REVIEW",
    "name": "SupportFlow",
    "subtitle": "把查政策、模型选证与人工审核串成可交付的客服工作流。",
    "fact": "DeepSeek-V4-Pro · 模型选证 + 引用校验 · 24 项场景验收通过",
    "sections": [
      {
        "title": "产品任务",
        "content": "<p>面向客服查询政策、整理回复草稿和审核答复的任务，连接资料导入、有效版本检索、逐条引用、人工审核与问题回收。来源、地区、有效期和版本随草稿保存，政策变化时拦截旧稿。</p>"
      },
      {
        "title": "关键判断与修复",
        "content": "<p>真实接入后发现，“CSV 下载链接过期了，怎样重新取得数据？”被拆成丢失主语的两个问题，导致反复澄清；发票更正的同义表述也被误判为缺少依据。改进逗号拆分、主题继承与条款支持校验，保留独立问题和异常分流。</p>"
      },
      {
        "title": "落地结果",
        "content": "<p>同组 24 项模型接入场景由 16/24 提升至 24/24；完成 123 项工程检查。实测覆盖正常答复、多问题、地区矛盾、依据不足、越权请求及人工接管。<a href=\"https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/docs/LIVE_PRACTICE_20261019.md\" target=\"_blank\" rel=\"noopener noreferrer\">查看请求记录与逐题结果 ↗</a></p>"
      },
      {
        "title": "可继续验证的方向",
        "content": "<p>已保留模型调用次数、请求 ID、用量和完整输出。下一步用目标用户任务检验采纳与审核负担，继续比较规则和模型各自适合的环节。</p>"
      }
    ]
  },
  "metricpilot": {
    "kicker": "CASE 03 / CSV & METRIC CONTRACT",
    "name": "MetricPilot",
    "subtitle": "让一份订单 CSV 生成口径明确、可复核的经营简报。",
    "fact": "CSV 自助分析 · 字段映射与指标确认 · 22 项场景验收通过",
    "sections": [
      {
        "title": "产品任务",
        "content": "<p>围绕运营与小团队整理收入、渠道、退款简报的任务，将固定数据演示升级为 CSV 预览、字段映射、质量检查、口径确认、统计和导出。</p>"
      },
      {
        "title": "关键产品判断",
        "content": "<p>同一份 9 单样例，退款按原订单日与发生日统计分别得到 30 元和 120 元。比较两种自动覆盖与先确认，选择让用户在查询前统一口径；期间和分母不明确时先澄清。</p>"
      },
      {
        "title": "交付与验证",
        "content": "<p>报告保留源文件指纹、源行号、SQL、参数与查询编号。22 项验收由 11/22 提升至 22/22；本轮重新执行 24 项 CSV 固定任务与完整 162 项测试，均通过。</p>"
      },
      {
        "title": "产品价值",
        "content": "<p>让数据接入、指标含义、计算过程与结论保持一致，支持使用者复核每一个数字，避免带着完整证据回答了错误的问题。</p>"
      }
    ]
  },
  "climbai": {
    "kicker": "EXPLORATION / WEB TRAINING & FEEDBACK",
    "name": "ClimbAI",
    "subtitle": "连接这次练什么、训练后如何复盘，以及下一次如何调整。",
    "demo": "climbai/",
    "fact": "DeepSeek-V4-Pro 后端实测 · 计划生成与反馈归纳 · 浏览器可交互体验",
    "sections": [
      {
        "title": "用户任务与产品流程",
        "content": "<p>面向室内抱石初阶用户，设计画像、知识检索、训练规划与反馈四节点流程。训练结束与反馈分别保存，调整方案展示修改依据，由用户确认后生成新计划版本。</p>"
      },
      {
        "title": "真实模型实践",
        "content": "<p>在每次最多 45 分钟的条件下，模型生成 35 分钟和 30 分钟两次安排。反馈临时加班、实际训练 25 分钟后，模型归纳时间限制，下一次计划从 30 分钟缩至 25 分钟，用户确认后生效。</p>"
      },
      {
        "title": "知识与交付",
        "content": "<p>统一前后端 30 条知识与来源、适用条件，保留 10 个练习模板；完成 50 条检索验收和 14 项定向浏览器检查。后端本轮完成 3 次真实模型调用及 116 项测试。</p>"
      },
      {
        "title": "体验入口",
        "content": "<p>浏览器可直接体验建档、训练记录、反馈和计划版本；本地后端可接入模型。模型实测的输入、输出、请求 ID 与用量记录随源码提供。</p>"
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
        '<p class="dialog-fact">' + (item.fact || '产品设计 · 运行交付 · 场景验证') + '</p>' +
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
