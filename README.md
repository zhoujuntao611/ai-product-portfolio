# 周俊涛｜AI 产品经理实习作品集

围绕用户任务，完成产品流程、方案取舍、原型实现与评测验证。项目覆盖开源维护 Agent、客服知识工作流、订单分析和攀岩训练记录；开发使用 AI 编程工具，个人职责、实现范围与验证结果分别说明。

[作品主页](https://zhoujuntao611.github.io/ai-product-portfolio/) · [公开履历](docs/profile/) · [运行与验证](docs/DEVELOPMENT.md) · [本轮内容审阅](docs/PORTFOLIO_REVIEW_20261026.md)

## Oriel · 开源维护者 Agent

- **用户与问题：**面向开源维护者，将飞书社区中的答疑与 Bug 反馈沉淀为 Gitee Issue，再组织修复和验收，减少问题在聊天中丢失、修改缺少可审核依据的情况。
- **我的工作：**负责维护流程、Pico Runtime 的任务调度与上下文等能力，以及 PicoBench 的评测协议、用例和验收设计实现；开发采用 AI 编程协作，保留基础组件的开源来源与署名。
- **关键取舍：**修复和验收在不同工作目录执行；最终交付本地补丁、变更说明与测试记录，由维护者决定是否采纳。生成候选不等于创建远程 PR 或完成合入。
- **状态与证据：**维护者 MVP 与受控评测阶段。公开维护流程源码、运行步骤与[维护测试](projects/oriel/source/tests/test_maintenance.py)；实验说明与限制见[指标范围](projects/oriel/EVIDENCE.md)。原始付费模型运行凭证未随源码公开，实验摘要不代表真实社区采纳率或节省工时。

[查看项目](https://zhoujuntao611.github.io/ai-product-portfolio/oriel/) · [完整源码](projects/oriel/source) · [流程与运行](projects/oriel/README.md) · [证据与边界](projects/oriel/EVIDENCE.md)

## SupportFlow · 客服回复助手

- **用户与问题：**面向查政策、拟回复和审核草稿的客服，展示依据原文、地区与版本，处理“引用存在，但条款没有回答所问问题”的风险。
- **我的工作：**设计资料导入与版本管理、逐问题检索、人工编辑审核和问题样例回收，在 AI 编程协作下实现并整理失败案例与回归证据。
- **关键取舍：**模型从已有条款中选择依据，程序检查适用范围；资料不足先澄清或转人工，政策更新后要求旧稿重新生成，保留人工批准与退回。
- **状态与证据：**可本机运行，默认规则模式，也支持配置真实模型。26 项历史开发回归由 14/26 到 26/26，该轮没有真实模型调用；后续 2026-10-19 DeepSeek 实测中，模型接入流程在固定构造场景上由 16/24 到 24/24，修复后规则流程也为 24/24。这些是已知场景的回归结果，不能解释为模型增益、盲测准确率或真实客服收益。

[查看项目](https://zhoujuntao611.github.io/ai-product-portfolio/supportflow/) · [源码与运行](projects/supportflow) · [历史开发回归](projects/supportflow/docs/ITERATION_EVIDENCE.md) · [真实模型实测及原始报告](docs/LIVE_PRACTICE_20261019.md)

## MetricPilot · 订单分析工具

- **用户与问题：**面向用订单表整理收入、渠道和退款简报的运营与产品人员，让数据准备、指标定义和报告结论能够相互核对。
- **我的工作：**设计 CSV 接入、字段匹配、异常处理、口径确认和证据报告；通过 AI 编程协作实现原型，使用可手算的示例订单检查结果。
- **关键取舍：**首版聚焦单张订单表能解释的指标。退款按下单日还是退款日归属、分母是什么，先由用户确认；问题与已确认条件冲突时暂停查询，不替用户决定业务定义。
- **状态与证据：**当前 CSV v2 使用规则解析与受约束统计，没有外部模型调用；报告保留查询条件、计算依据和源数据行号。固定示例、失败记录及复测见[迭代说明](projects/metricpilot/docs/ITERATION-20261019.md)，不代表真实经营效果，也不支持多币种混算或分次退款。

[查看项目](https://zhoujuntao611.github.io/ai-product-portfolio/metricpilot/) · [源码与运行](projects/metricpilot) · [产品范围](projects/metricpilot/docs/PRD.md) · [修改与测试记录](projects/metricpilot/docs/ITERATION-20261019.md)

## 攀迹 · 攀岩训练与 AI 复盘微信小程序

- **用户与问题：**面向希望回看训练过程、找到同一线路历次尝试与视频的攀岩者，将记录、复盘和下次目标衔接起来；该场景仍待系统用户研究验证。
- **我的工作：**负责产品范围、训练与复盘流程、AI 建议确认机制，以及结合手机操作反馈推进交互迭代；通过 AI 编程协作实现并验收开发预览。
- **关键取舍：**线路由用户明确关联，避免同名误合并；训练记录可上云，视频与关联留本机，控制存储成本，并明确告知视频不跨设备同步。程序提供事实，模型提建议，用户确认后才保存为目标。
- **状态与证据：**0.2.2 开发预览，尚未公开发布。原开发环境已完成腾讯混元 `cloudbase/hy3` 的 3 类合成场景、7 项开发检查；公开副本提供清洗后的[证据说明](projects/panji/docs/EVIDENCE.md)，本地工程检查不代替真实模型、完整手机验收或训练效果验证。

[查看项目](https://zhoujuntao611.github.io/ai-product-portfolio/panji/) · [源码与运行](projects/panji) · [产品案例](projects/panji/portfolio/01_项目总结.md) · [验证范围](projects/panji/docs/EVIDENCE.md)

## 运行与检查

Windows 可使用根目录 `start-projects.cmd` 启动 SupportFlow 和 MetricPilot，使用 `stop-projects.cmd` 关闭。其他系统及各项目的独立运行方式见[开发说明](docs/DEVELOPMENT.md)。GitHub Pages 提供项目介绍和界面预览，不运行 Python 后端。

工程检查、模型实验和用户效果分别记录。工程执行结果见 [GitHub Actions](https://github.com/zhoujuntao611/ai-product-portfolio/actions/workflows/verify.yml)，历史模型实验见[实测记录](docs/LIVE_PRACTICE_20261019.md)。普通启动与本地回归不要求外呼模型；真实模型实验需要自行配置并单独执行，费用与结果按相应记录解释。当前没有已验证的留存、节省工时或训练改善结果。

早期 ClimbAI 原型已退出公开展示，源码保留在 [projects/climbai](projects/climbai)，用于复现历史实现与模型实验。ClimbAI 与攀迹的代码、数据和存储独立，历史 DeepSeek 调用不能算作攀迹的模型验证，详见[项目演进说明](docs/CLIMBING_EVOLUTION.md)。

## 来源与许可

Oriel / Pico 源码按随附 Apache-2.0 及第三方条款提供，保留 nanobot、hermes-agent / ink 等来源声明。见[同步与许可](projects/oriel/SOURCE_PROVENANCE.md)。

SupportFlow、MetricPilot、ClimbAI 代码按各自随附 MIT LICENSE 提供。攀迹代码用于公开展示，未授予统一开源许可；其中 OSM 数据子集适用独立的 ODbL，其他资料保留各自来源与权利。见[攀迹来源与许可](projects/panji/README.md#数据来源与许可)。

仓库不提供开发账号、模型凭据、私人简历或用户训练数据。项目界面使用示例数据；公共场所资料不代表用户规模或实时营业状态。
