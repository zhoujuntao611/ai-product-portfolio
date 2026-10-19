# 三个项目的问题、取舍与验证证据

本索引汇总 SupportFlow、MetricPilot 的 2026-10-19 迭代，以及 ClimbAI 的 2026-10-15 知识扩充。问题来自代码审阅和可复现的合成任务；未开展真人访谈、真实模型评测或业务收益测量。项目为 AI 协作个人作品，开发验收不等于真实用户效果。

## SupportFlow：有来源，还要支持当前问题

**任务。** 导入政策资料，找到适用于当前客户的条款，整理成可核对的回复，再交给人工审核。

**发现。** 问“退款多久会到账”，旧逻辑引用“7 天内提交退款申请”；问导出耗时，却用文件保留时长支持。草稿虽然有引用，回答的仍是另一件事。常用地区表达未统一处理，也会造成重复澄清或政策适用错误。

**方案选择。** 比较收紧数字门槛、增加事项与周期支持检查、采用模型语义判断，选择可解释的支持检查。检索保留同义扩展与逐问题 BM25，并与冻结关键词方案同题对照；本轮没有进行向量检索或真实模型方案的性能实测。

**交付。** 结构化知识导入、来源与地区版本治理、旧稿过期拦截；对实际选中条款核对事项、周期和问题覆盖。审核各终态保存编辑稿、原因及来源版本，支持问题样例导出；修复同秒历史排序。

**同题验证。** 本轮固定 26 条审阅回归：14/26 → 26/26；118/118 工程检查通过。此前冻结关键词基线与完整新版流程同 60 题对照：33/60 → 60/60，未做 BM25 单项消融。两组回归与工程测试有重叠，分别报告，不累计成独立准确率分母。

- [完整问题、备选方案、实现与边界](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/supportflow/docs/ITERATION_EVIDENCE.md)
- [本轮冻结修改前代码清单](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/supportflow/eval/baseline_v2_0/manifest.json)
- [同 26 条修改前后逐题实跑](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/supportflow/verification/review-comparison-v2.1.json)
- [同 60 题检索对照报告](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/supportflow/eval/comparison_v2.json)
- [118 项工程结果](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/supportflow/verification/review-after-engineering.txt)

## MetricPilot：数字可追溯，也要算对用户的问题

**任务。** 导入自己的订单 CSV，映射字段、确认业务口径，完成有限范围的收入、渠道与退款分析，并复核结论。

**发现。** 用可手算的 9 单 CSV 重放：混合期间比较丢掉一个条件；问题指定退款发生日，仍沿用界面原订单日；未知或带运算的分母被替换为毛收入。同一夹具两种日期口径分别产生 30 元与 120 元，系统必须先让用户统一含义。

**方案选择。** 继续使用受约束统计工具，限制指标与查询范围。比较问题覆盖界面、界面覆盖问题、冲突先确认，选择冲突时不查询。混合期间先要求统一表达，未知分母明确澄清；没有扩成通用日期理解或任意自然语言转 SQL。

**交付。** CSV 预览、字段映射和质量检查；期间、日期归属与完整分母检查；报告保存源文件指纹、源行号、参数及查询编号。当前 CSV 入口是规则解析与受约束统计，没有外部模型调用，不能称为已验证的真实 LLM Agent。

**同题验证。** 固定 22 项验收实跑：11/22 → 首次修复 17/22 → 最终 22/22，保留中间失败版本。当前 CSV 版 90/90 工程检查、24/24 固定业务任务通过；旧版 72 项单列。这些任务存在重叠，不累计为独立业务样本量。

- [完整迭代、备选方案与复跑方式](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/metricpilot/docs/ITERATION-20261019.md)
- [修改前实跑 11/22](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/metricpilot/verification/20261019-before.json)
- [第一次修复实跑 17/22](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/metricpilot/verification/20261019-first-fix.json)
- [修改后实跑 22/22](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/metricpilot/verification/20261019-after.json)
- [工程检查报告](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/metricpilot/docs/eval_report.json)与[固定任务阶段结果](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/metricpilot/docs/task_report.json)

## ClimbAI：共享知识，支持训练决策与复盘

**任务。** 面向室内抱石初阶用户，帮助确定“这次练什么”，并把完成情况和反馈转成下一次可确认的安排。痛点与价值仍是待验证假设。

**发现。** 原后端 10 条知识与浏览器内置 4 条示例分开维护，覆盖有限且容易不同步。增加知识之前，应解决内容一致、来源可回查和资料不足时如何处理。

**方案选择与交付。** 使用前后端共享的 30 条知识，扩展术语、装备、场馆与记录主题；保留 10 个原有练习模板，没有新增训练强度或负荷处方。18 条带外部参考，12 条明确标为自编产品规则；外部资料来自核验过的 7 个官方页面。每条补充来源、支持范围、适用条件与待教练审核状态。原有画像、检索、规划与反馈四节点保留，计划调整交由用户确认。

**验证。** 10 月 15 日扩充记录：116 项后端检查通过，其中已包含 50/50 固定检索题，另有 14 项定向浏览器验收。资料扩充与通过数不能证明训练效果。该轮未重新验证原生 Chroma、未调用真实供应商模型；真人试用与教练逐条审核待完成。

- [在线规则演示](https://zhoujuntao611.github.io/ai-product-portfolio/climbai/)
- [知识治理与内容边界](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/climbai/docs/KNOWLEDGE.md)与[官方来源核验](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/climbai/docs/SOURCES.md)
- [50 条固定检索逐题结果](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/climbai/verification/knowledge-retrieval-20261015.json)
- [14 项浏览器验收记录](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/climbai/verification/knowledge-browser-20261015.json)
- [完整验证日期、依赖范围与未测项目](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/climbai/docs/VALIDATION.md)

## 如何解释这些结果

冻结的修改前实现、同一组输入、可核对的期望和完整实际输出，支持复现具体错误及修复效果。样例参与了开发，属于开发回归，不是独立盲测；工程检查、业务任务和浏览器场景的分母分别说明。

真实模型理解、工具选择、成本与延迟，以及真人任务完成率、用时、采纳率和留存尚未测量。下一轮应冻结未参与修改的新任务并独立标注，开展授权脱敏资料与目标用户试用，再记录失败、修改及复测结果。
