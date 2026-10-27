# Oriel · 开源维护者 Agent

社区成员在飞书提问或反馈 Bug，维护者通过 `/issue` 整理为 Gitee Issue，再通过 `/fix` 启动复现、修改与独立验证。最终交付补丁和测试记录，由维护者审查是否采纳。

[项目主页](https://zhoujuntao611.github.io/ai-product-portfolio/oriel/) · [完整源码](source/) · [完整流程](WORKFLOW.md) · [安装与验证](RUNNING.md) · [技术栈学习指南](source/docs/onboarding/oriel-tech-stack.zh-CN.md) · [指标范围](EVIDENCE.md)

## 我的工作

我负责 Oriel 的需求与维护流程、Pico Runtime 的任务调度和上下文等运行时能力，以及 PicoBench 的评测协议、用例与验收设计实现；开发中使用 AI 编程工具。

Oriel 是维护者场景的产品名，Pico 是共用运行时，PicoBench 是评测工具。三者是同一项目中的不同部分。基础组件有开源来源，源码随附的 [LICENSE](source/LICENSE)、[NOTICES](source/NOTICES.md) 和 [LICENSES](source/LICENSES/) 保留原有许可与署名，不将全部依赖或基础代码列为个人原创。

## 从反馈到交付

1. 在群里答疑；信息不足时先确认环境、复现步骤和预期行为。
2. 维护者回复原消息并发送 `/issue`，创建持久化 Proposal 与 Gitee Issue，保留原消息链接并按来源去重。
3. `/fix` 读取 Issue，同一 Issue 去重调度；Runner 执行时锁定 Base Commit 与配置的检查命令。
4. 配置可选 `regressionCommands` 时，先在独立 Baseline Worktree 检查每条退出码为 `1`；Repair 与干净 Verifier 中同一回归均须为 `0`，原有验收也须通过。未配置时保留原验收路径，并注明未验证缺陷复现。
5. 输出 `CANDIDATE.md`、`candidate.patch`、v2 `manifest.json`、变更文件、命令退出码与日志，终态为 `candidate_ready`、`verification_failed` 或 `blocked`。
6. 维护者审查候选，决定后续 PR 与合入。

当前修复任务交付本地 PR Candidate；远程 PR 和合入由维护者处理。创建 Gitee Issue 是维护者通过 `/issue` 明确触发的操作。[逐阶段输入、输出和验收](WORKFLOW.md)

## 运行时与评测

- Python asyncio 会话级 Lane 与前后台独立并发池管理长短任务。
- 按预算组装上下文，Session、长期记忆与 Skill 分开管理；记忆后端可选，发布源码不捆绑 Myna。
- 工具根据读写属性安排并发，统一处理取消；MCP 接入共享工具调用入口。
- CallEfficiency 统一每次真实模型调用的用量、缓存、重试与估算成本；Trace 关联任务和投递。
- PicoBench 冻结任务、模型、预算和 Verifier，分别判断任务成功与效率收益。
- Runtime 提供候选 Skill 与 Evolver；维护者 Candidate 到 Skill 的业务接入仍为后续计划。

当前源码在维护者分支基线 `afdd62099b900a3c046dd96396268b7a8403d9c4` 上包含 2026-10-27 维护验收迭代：可选三阶段回归证据、SQLite 幂等冲突后的事务清理，以及学习指南和离线演示。原始 1,197 文件清单单独保留，当前版本不再声明与上游基线逐字节相同。[迭代说明](source/docs/onboarding/maintenance-regression.zh-CN.md) · [来源与同步范围](SOURCE_PROVENANCE.md) · [当前校验清单](SOURCE_MANIFEST.json) · [相对基线的变更](SOURCE_CHANGES.json)

## 当前状态

维护者 MVP 与受控评测阶段。公开实验摘要不等于社区采用效果，原始付费模型运行凭证未随源码公开，本次同步不重新运行付费实验。当前没有可公开核验的长期试用人数、维护者采纳率或节省工时数据。

下一步采集 Issue 沉淀数、修复触发数、验证通过数和维护者采纳数，同时记录拒绝原因与单位成功任务估算成本。模糊需求、验收不足及额外权限问题先澄清或交人工。
