# Oriel · 开源维护者 Agent

Oriel 是面向社区成员与维护者的产品名，基于 Pico Runtime。它把飞书群聊问题整理为 Gitee Issue，启动复现、修改和独立验证，交付带证据的本地 PR Candidate，由维护者决定是否采纳。

[项目主页](https://zhoujuntao611.github.io/ai-product-portfolio/oriel/) · [实现源码](https://gitee.com/htxoffical/pico-harness/tree/release/maintainer-profile) · [指标与证据范围](EVIDENCE.md)

## 交付流程

1. 社区成员在飞书提问或反馈，资料不足时先澄清。
2. 配置中的维护者回复原消息并发送 `/issue`，创建持久化 Proposal 与 Gitee Issue，保留原消息链接并按来源去重。
3. 维护者用 `/fix` 引用 Issue；任务锁定仓库、Base Revision 与验收命令，同一 Issue 去重调度。
4. Repair Worktree 生成修复；干净 Verifier Worktree 重新应用 Patch 并执行验收。
5. 通过验证后交付 `CANDIDATE.md`、`candidate.patch`、变更文件、命令退出码与日志。终态为 `candidate_ready`、`verification_failed` 或 `blocked`。
6. 维护者审查并决定后续 PR 与合入。

当前维护任务不自动 Push、创建远程 PR、评论 Issue 或合并代码。创建 Gitee Issue 属于 `/issue` 的显式维护者操作。

## 产品与运行时

- Oriel 负责社区问答、问题沉淀、修复验收与结果交付的产品流程。
- Pico Runtime 统一 Turn 调度、上下文组装、工具、可选长期记忆、成本记账与链路追踪。
- PicoBench 固定任务、模型、预算与 Verifier，避免把模型故障、缺失用量或任务退化误判为优化收益。
- Runtime 侧的候选 Skill 与 Evolver 保留验证、失败回退与人工激活；维护者 Candidate 到 Skill 的业务流程仍列为后续接入计划。

技术栈：Python、asyncio、Agent Runtime、Context Management、Tool Calling / MCP、Agent Evaluation、Tracing；长期记忆通过可选后端接口接入，当前发布不捆绑 Myna 实现。

## 运行与状态

本目录保存作品集说明，不包含 Pico 引擎副本。安装、飞书配置和维护模式步骤以[维护者分支接入说明](https://gitee.com/htxoffical/pico-harness/blob/afdd62099b900a3c046dd96396268b7a8403d9c4/docs/onboarding/feishu.zh-CN.md)为准。开发借助 AI 编程工具；产品名与引擎名分开，不据此声称独立编写了全部底层代码。

当前为维护者 MVP 与受控评测阶段。尚无可公开核验的社区长期试用、候选采纳率与节省工时数据。下一步采集 Issue 沉淀、修复触发、验证通过和维护者采纳情况，并记录拒绝原因。模糊需求、验收条件不足和额外权限问题先澄清或交人工。

## 后续验收指标

- **核心指标：** 维护者采纳的 PR Candidate 数；需保留采纳的定义与时间窗口。
- **过程指标：** Issue 沉淀数、`/fix` 触发数、验证通过数 / 已完成验收任务数。
- **护栏：** 单位验收成功任务估算成本、前台 P95、验证通过但被维护者拒绝的候选数及拒绝原因。

这些为计划采集的业务指标，当前不填写未经核验的数值。实验数字与社区业务数据分开记录，详见证据说明。
