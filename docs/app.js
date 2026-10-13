(function () {
  'use strict';
  const config = window.PORTFOLIO_CONFIG || {};
  const workflows = {
    supportflow: [
      { title: '先确认知识能回答什么。', text: '关键词检索当前有效知识，保留来源编号与政策地区。知识未覆盖或退款地区不明确时，停止直接答复并提示补充信息。', detail: '产品取舍：完整回答之前，先避免把不适用的政策合并。' },
      { title: '每条草稿，都能回到具体来源。', text: '回复草稿组合已有知识陈述，并逐条显示来源编号。可选模型接口只选择已有证据编号，不直接接受模型编写的新事实；真实供应商模型尚未调用评测。', detail: '产品取舍：先建立可检查的引用关系，再扩展生成能力。' },
      { title: '最后一步，由人工审核。', text: '审核人可以批准本地草稿、驳回或转人工。工单保存审核轨迹；人工修改与自动验证区分标记，不向外部系统发送回复。', detail: '产品取舍：自动生成与审核决定分开，异常任务有清楚出口。' }
    ],
    metricpilot: [
      { title: '先对齐问题，再计算数字。', text: '明确期间、分析维度与指标。净收入使用“毛收入 − 关联退款”；退款金额占比与退款订单占比分别保留分母，缺少信息时先澄清。', detail: '产品取舍：不把模糊期间或不同退款率静默解释成同一个问题。' },
      { title: '让工具只做被允许的查询。', text: '使用参数化只读 SQL，限制可访问表、函数与查询资源。执行过程保留 SQL、参数和返回结果；可选模型只调用已确认范围内的统计工具，真实模型效果尚未实测。', detail: '产品取舍：分析任务允许查询，不赋予写入业务数据的权限。' },
      { title: '报告是证据的另一种呈现。', text: '结论关联查询编号、原始数据和任务轨迹。金额以整数分保存，净收入与退款率使用明确口径；结果不推断缺少证据的经营原因。', detail: '产品取舍：把可核对的数字和未证实的解释分开。' }
    ]
  };

  const cases = {
    supportflow: {
      kicker: 'CASE 01 / WORKFLOW & HUMAN REVIEW', name: 'SupportFlow', subtitle: '让知识查询、回复草稿与人工审核形成一条可检查的流程。',
      sections: [
        { title: '问题与目标', content: '<p>围绕客服查询政策与整理回复的任务，设计一个可以回查来源的本地助手。目标是展示从问题到证据、草稿和审核的完整流程，而非用一次生成替代客服判断。</p>' },
        { title: 'MVP 范围与取舍', content: '<ul><li>使用虚构产品知识与关键词检索，保持来源可检查。</li><li>地区政策缺失或冲突时先澄清，证据不足时转人工。</li><li>仅保存本地草稿与审核记录，不接入真实客服发送。</li></ul>' },
        { title: '关键产品设计', content: '<ul><li>知识有地区、有效状态与更新时间，草稿逐条显示引用。</li><li>草稿、批准、驳回和转人工分别记录；人工编辑不标为自动验证。</li><li>可选模型只选已有证据编号，输出仍由本地引用构成。</li></ul>' },
        { title: '验收与当前边界', content: '<p>通过合成用例检查引用、地区政策、信息不足与审核状态。风险识别使用有限规则，不代表通用提示词注入防护。真实模型效果、真实用户反馈及效率提升尚未验证。</p>' }
      ]
    },
    metricpilot: {
      kicker: 'CASE 02 / METRIC SEMANTICS & SQL EVIDENCE', name: 'MetricPilot', subtitle: '让分析问题、指标口径、只读查询和结论证据保持一致。',
      sections: [
        { title: '问题与目标', content: '<p>围绕收入、渠道与产品分析任务，设计一个能够展示查询过程的本地助手。目标是让报告中的数字有明确口径和可回查结果，不将自然语言回答当作数据证据。</p>' },
        { title: 'MVP 范围与取舍', content: '<ul><li>使用固定合成订单，支持明确期间与有限指标。</li><li>净收入、退款金额占比和退款订单占比保留计算口径。</li><li>只允许读取数据；不开放任意写入或通用自然语言转 SQL。</li></ul>' },
        { title: '关键产品设计', content: '<ul><li>缺失期间或指标时先澄清，支持参数化筛选。</li><li>报告关联 SQL、原始结果、查询编号和任务轨迹。</li><li>可选模型在已确认的计划内选择统计工具，最终数字来自查询结果。</li></ul>' },
        { title: '验收与当前边界', content: '<p>通过合成用例核对金额、退款分母、只读限制与查询结果。固定数据仅验证流程与实现；真实模型工具使用能力、线上稳定性及真实业务价值尚未验证。</p>' }
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
        '<p class="dialog-fact">2026.10 新建 · AI 协作个人作品 · 合成数据 / 离线规则演示 · 真实模型效果尚未实测</p>' +
        '<div class="case-sections">' + item.sections.map(section => '<section><h3>' + section.title + '</h3>' + section.content + '</section>').join('') + '</div>' +
        '<p class="case-metric" data-metric="' + project + '">离线回归，结果待写入</p>' +
        '<div class="dialog-links"><a class="button primary" data-doc-url="' + project + '" href="#source">阅读产品文档 <span aria-hidden="true">↗</span></a><a class="text-link" data-repo-url="' + project + '" href="#source">查看源码 <span aria-hidden="true">↗</span></a></div>';
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
