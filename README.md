# 周俊涛｜AI 产品经理实习作品集

围绕用户任务，完成产品流程、方案取舍、原型实现与评测验证。项目覆盖开源维护 Agent、客服知识工作流、订单分析和攀岩训练记录。

[作品主页](https://zhoujuntao611.github.io/ai-product-portfolio/) · [公开履历](https://zhoujuntao611.github.io/ai-product-portfolio/profile/) · [技术能力与项目实践](docs/RESUME_EVIDENCE.md) · [运行与验证](docs/DEVELOPMENT.md)

## Oriel · 开源维护者 Agent

- **用户与问题：**面向开源维护者，将飞书社区中的答疑与 Bug 反馈沉淀为 Gitee Issue，再组织修复和验收，减少问题在聊天中丢失、修改缺少可审核依据的情况。
- **我的工作：**负责维护流程、Pico Runtime 的任务调度与上下文能力，以及 PicoBench 的评测协议、用例和验收设计实现。
- **关键取舍：**修复和验收在不同工作目录执行，交付补丁、变更说明与测试记录，由维护者审查后决定 PR 与合入。新增三阶段回归门禁，并检查验收后的源码与候选补丁一致。
- **状态与证据：**维护者 MVP 与受控评测阶段。已实现反馈整理、Issue 创建、修复候选生成与独立验收，提供[维护回归测试](projects/oriel/source/tests/test_maintenance_regression.py)、[运行步骤](projects/oriel/RUNNING.md)和[实验记录](projects/oriel/EVIDENCE.md)。

[查看项目](https://zhoujuntao611.github.io/ai-product-portfolio/oriel/) · [完整源码](projects/oriel/source) · [流程与运行](projects/oriel/README.md) · [实验与验证](projects/oriel/EVIDENCE.md)

## SupportFlow · 客服回复助手

- **用户与问题：**面向查政策、拟回复和审核草稿的客服，展示依据原文、地区与版本，处理“引用存在，但条款没有回答所问问题”的风险。
- **我的工作：**设计资料导入与版本管理、逐问题检索、人工编辑审核和问题样例回收，实现原型并整理失败案例与回归记录。
- **关键取舍：**模型从已有条款中选择依据，程序检查适用范围；资料不足先澄清或转人工，政策更新后要求旧稿重新生成，保留人工批准与退回。
- **状态与证据：**本地原型，默认规则模式，支持配置模型。固定 26 项合成开发回归由 14/26 到 26/26；历史真实模型接入实验单独记录，样本与同题复测条件见[结果说明](projects/supportflow/docs/RESULTS.md)。

[查看项目](https://zhoujuntao611.github.io/ai-product-portfolio/supportflow/) · [源码与运行](projects/supportflow) · [历史开发回归](projects/supportflow/docs/ITERATION_EVIDENCE.md) · [真实模型实测及原始报告](docs/LIVE_PRACTICE_20261019.md)

## MetricPilot · 订单分析工具

- **用户与问题：**面向用订单表整理收入、渠道和退款简报的运营与产品人员，让数据准备、指标定义和报告结论能够相互核对。
- **我的工作：**设计 CSV 接入、字段匹配、异常处理、口径确认和证据报告，实现原型并使用可手算的示例订单检查结果。
- **关键取舍：**首版聚焦单张订单表的收入、渠道与退款。退款日期归属与分母先由用户确认；问题与已确认条件冲突时暂停查询，待条件统一后执行。
- **状态与证据：**CSV v2 已实现规则解析、受约束计算与报告导出；报告保留查询条件、计算依据和源数据行号。同组 22 项已知输入回归全部通过，固定示例与修改过程见[迭代说明](projects/metricpilot/docs/ITERATION-20261019.md)。

[查看项目](https://zhoujuntao611.github.io/ai-product-portfolio/metricpilot/) · [源码与运行](projects/metricpilot) · [产品范围](projects/metricpilot/docs/PRD.md) · [修改与测试记录](projects/metricpilot/docs/ITERATION-20261019.md)

## 攀迹 · 攀岩训练与 AI 复盘微信小程序

- **用户与问题：**面向希望回看训练过程、找到同一线路历次尝试与视频的攀岩者，将记录、复盘和下次目标衔接起来。
- **我的工作：**负责产品范围、训练与复盘流程、AI 建议确认机制，结合手机操作反馈调整视频入口、连续记录与草稿恢复。
- **关键取舍：**线路由用户明确关联，避免同名误合并；训练记录可上云，视频与关联留本机，控制存储成本，并明确告知视频不跨设备同步。程序提供事实，模型提建议，用户确认后才保存为目标。
- **状态与证据：**0.2.2 开发预览，已实现训练记录、线路关联与视频回看。原开发环境完成腾讯混元 `cloudbase/hy3` 的 3 类合成场景、7 项开发检查，公开[验证摘要](projects/panji/docs/EVIDENCE.md)。下一步完成完整手机验收并准备公开发布。

[查看项目](https://zhoujuntao611.github.io/ai-product-portfolio/panji/) · [源码与运行](projects/panji) · [产品案例](projects/panji/portfolio/01_项目总结.md) · [验证记录](projects/panji/docs/EVIDENCE.md)

## 运行与检查

Windows 可使用根目录 `start-projects.cmd` 启动 SupportFlow 和 MetricPilot，使用 `stop-projects.cmd` 关闭。其他系统及各项目的运行方式见[开发说明](docs/DEVELOPMENT.md)。GitHub Pages 提供项目介绍和界面预览，应用按文档在本机运行。

工程执行结果见 [GitHub Actions](https://github.com/zhoujuntao611/ai-product-portfolio/actions/workflows/verify.yml)，模型接入与历史实验见[实测记录](docs/LIVE_PRACTICE_20261019.md)。本地回归可直接运行；真实模型实验按文档配置凭据与预算后单独执行。

## 来源与许可

Oriel / Pico 源码按随附 Apache-2.0 及第三方条款提供，保留 nanobot、hermes-agent / ink 等来源声明。见[同步与许可](projects/oriel/SOURCE_PROVENANCE.md)。

SupportFlow、MetricPilot、ClimbAI 代码按各自随附 MIT LICENSE 提供。攀迹代码用于公开展示，未授予统一开源许可；其中 OSM 数据子集适用独立的 ODbL，其他资料保留各自来源与权利。见[攀迹来源与许可](projects/panji/README.md#数据来源与许可)。

项目界面使用示例数据，应用凭据由运行者在自己的环境中配置。
