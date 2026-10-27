# Oriel · 开源维护者 Agent

社区成员在飞书提问或反馈 Bug，维护者通过 `/issue` 整理为 Gitee Issue，再通过 `/fix` 启动复现、修改与独立验证。最终交付补丁和测试记录，由维护者审查是否采纳。

[项目主页](https://zhoujuntao611.github.io/ai-product-portfolio/oriel/) · [完整源码](source/) · [完整流程](WORKFLOW.md) · [安装与验证](RUNNING.md) · [技术栈学习指南](source/docs/onboarding/oriel-tech-stack.zh-CN.md) · [实验与验证](EVIDENCE.md)

## 我的工作

我负责 Oriel 的需求与维护流程、Pico Runtime 的任务调度和上下文等运行时能力，以及 PicoBench 的评测协议、用例与验收设计实现。

Oriel 是维护者场景的产品名，Pico 提供共用运行时，PicoBench 提供评测工具。基础组件来源、许可与作者署名见 [LICENSE](source/LICENSE)、[NOTICES](source/NOTICES.md) 和 [LICENSES](source/LICENSES/)。

## 从反馈到交付

1. 在群里答疑；信息不足时先确认环境、复现步骤和预期行为。
2. 维护者回复原消息并发送 `/issue`，创建持久化 Proposal 与 Gitee Issue，保留原消息链接并按来源去重。
3. `/fix` 读取 Issue，同一 Issue 去重调度；Runner 执行时锁定 Base Commit 与配置的检查命令。
4. 配置可选 `regressionCommands` 时，先在独立 Baseline Worktree 检查每条退出码为 `1`；Repair 与干净 Verifier 中同一回归均须为 `0`，原有验收也须通过。检查后核对源码与候选补丁一致，包含候选新增文件。
5. 输出 `CANDIDATE.md`、`candidate.patch`、v2 `manifest.json`、变更文件、命令退出码与日志，终态为 `candidate_ready`、`verification_failed` 或 `blocked`。
6. 维护者审查候选，决定后续 PR 与合入。

[逐阶段输入、输出和验收](WORKFLOW.md)

## 运行时与评测

- Python asyncio 会话级 Lane 与前后台独立并发池管理长短任务。
- 按预算组装上下文，Session、长期记忆与 Skill 分开管理，记忆后端可选。
- 工具根据读写属性安排并发，统一处理取消；MCP 接入共享工具调用入口。
- CallEfficiency 统一每次真实模型调用的用量、缓存、重试与估算成本；Trace 关联任务和投递。
- PicoBench 冻结任务、模型、预算和 Verifier，分别判断任务成功与效率收益。
- Runtime 提供候选 Skill 与 Evolver 的经验复用能力。

2026-10-27 迭代新增可选三阶段回归门禁、验收后的源码一致性检查，以及 SQLite 幂等冲突后的事务清理，并提供学习指南和离线演示。当前源码基于维护者分支 `afdd62099b900a3c046dd96396268b7a8403d9c4` 开发，原始 1,197 文件清单与后续变更分别保留。[迭代说明](source/docs/onboarding/maintenance-regression.zh-CN.md) · [来源与同步范围](SOURCE_PROVENANCE.md) · [当前校验清单](SOURCE_MANIFEST.json) · [相对基线的变更](SOURCE_CHANGES.json)

## 当前状态

维护者 MVP 与受控评测阶段，已实现反馈整理、Issue 创建、修复候选生成、独立验收与人工审查流程。

下一步在小型社区记录 Issue 沉淀、修复触发、验证通过与维护者采纳情况，分析拒绝原因，并将 Candidate 到 Skill 的流程接入独立回放验收。
