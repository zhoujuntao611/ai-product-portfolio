# Oriel 实验与验证记录

更新日期：2026-10-27（北京时间）。本文汇总维护验收迭代、受控模型实验和 Runtime 扩展实验的条件与结果。

## 源码基线与本轮迭代

维护者功能基于 `release/maintainer-profile` 的 `afdd62099b900a3c046dd96396268b7a8403d9c4` 继续开发，原始 1,197 文件清单保留在 [SOURCE_BASELINE_MANIFEST.json](SOURCE_BASELINE_MANIFEST.json)。当前开发提交和逐文件校验见 [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json)，后续改动见 [SOURCE_CHANGES.json](SOURCE_CHANGES.json)。参见[来源与许可](SOURCE_PROVENANCE.md)、[运行步骤](RUNNING.md)和[完整流程](WORKFLOW.md)。

本人负责 Oriel 产品流程、Pico Runtime 与 PicoBench 的设计实现。第三方基础组件保留原有许可与作者署名。

- [飞书维护模式说明](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/oriel/source/docs/onboarding/feishu.zh-CN.md)：`/issue`、`/fix`、去重、进度回传及候选文件交付。
- [维护命令与授权](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/oriel/source/pico/maintenance/coordinator.py)：维护者命令与任务协调。
- [修复和验证流程](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/oriel/source/pico/maintenance/runner.py)：独立工作目录、补丁与终态。
- [维护流程测试](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/oriel/source/tests/test_maintenance.py)：在临时 Git 仓库检查候选交付与失败路径，持续集成使用 Linux 环境。

当前交付本地 PR Candidate，由维护者审查补丁、创建远程 PR 并决定合入。Candidate 到 Skill 的接入列入下一阶段。

## 2026-10-27 维护验收迭代

- 可选 `regressionCommands` 在独立 Baseline 中逐条退出 `1`，在 Repair 与干净 Verifier 中逐条退出 `0`；原有验收仍须通过。基线已通过、退出其他码、超时或记录不完整时，任务受阻并保留诊断。回归断言与日志由维护者核对。
- 候选 manifest 升级为 `pico.maintenance.candidate.v2`，记录回归模式与三阶段退出码；未配置时标记未验证复现。
- 针对验收命令自动改写源码造成的误判，补充固定基线下的源码一致性检查及 10 项回归。Repair / Verifier 检查后源码须与候选补丁一致，包含候选新增文件；普通未跟踪缓存可以保留。
- SQLite 的 Proposal / Job 唯一约束冲突分支补充 `rollback()`，避免幂等返回后遗留写事务，影响后续配额或其他连接。

2026-10-27 Windows 合并检查为 **138 passed、4 deselected**，含 33 项新增回归验收、4 项事务回归及现有维护和配置检查。排除的两项 shell 测试另以真实 Git-for-Windows shell 适配路径验证通过；两项 POSIX 权限检查需在 Linux 执行。新增测试使用真实 Git、SQLite 与 Python 子进程，Windows 适配固定 Python 检查命令。完整范围见[验证摘要](source/docs/examples/maintenance-iteration-verification.json)，当前提交的持续集成结果见 [Actions](https://github.com/zhoujuntao611/ai-product-portfolio/actions/workflows/verify.yml)。

五种离线演示使用确定性编辑夹具，覆盖成功、未复现、执行异常、修复无效和干净验证失败，检查任务编排、候选包与退出码。[迭代与验证细节](source/docs/onboarding/maintenance-regression.zh-CN.md) · [演示入口](source/scripts/demo_maintenance_regression.py) · [学习指南](source/docs/onboarding/oriel-tech-stack.zh-CN.md)

## 受控实验

### 调度

在专门构造的队头阻塞负载下，真实 Agent 实验执行 4,160 次 Turn，4,158 次通过任务验收（99.95%）；前台 P95 观测值从 13.57 秒降至 11.66 秒。两次回复缺少验收标记，未达到预注册的全部通过门槛，聚合报告为 `claim_eligible: false`。据此保留延迟观测值，整体优化判定为未通过。

[实验方法、结果与命令](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/oriel/source/docs/evaluation/runtime-scheduler-experiments.md)。

### 模型调用估算成本

任务来自 PicoBench 成本协议中冻结的对话与工具链用例，覆盖稳定对话、长历史、跨轮工具累积和单轮工具链四类。4 类 × 每类 3 个用例 = **12 个固定用例**；每个用例重复 3 次，形成 **36 组配对**，按原始任务聚类估计。[协议与用例实现](https://github.com/zhoujuntao611/ai-product-portfolio/tree/main/projects/oriel/source/benchmarks/picobench/packs/tokenwise_cost)。

36 组配对、72 次 Trial、504 次真实 DeepSeek 调用，两组分别 36/36 通过。稳定前缀相比逐次扰动前缀，单位成功任务估算成本的**任务聚类配对估计为下降 72.0750%（展示四舍五入为 72.08%）**；另一个统计口径为汇总比值，下降 72.3413%。

对照采用冻结任务条件下的稳定前缀与扰动前缀，两组均 36/36 通过作为成本比较的任务成功护栏。费用使用冻结价格快照估算。

[成本实验说明](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/oriel/source/docs/evaluation/tokenwise-cost.md)。

### 追踪开销

本地短确定性任务执行 1,000 组配对、2,000 次 Turn；开启追踪的一侧保留 1,000 条 Trace 并完整关联。P95 延迟差约 2.245 ms，每个启用追踪的 Turn 写入约 25.1 KiB。测量范围为本地短任务的绝对延迟与写入量。

[追踪测量说明](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/oriel/source/docs/evaluation/tracing-overhead.md)。

## Runtime 扩展实验摘要

- **请求完整性：** 确定性压力实验记录 10,000 个已接受请求，测量范围为进程内从接受到任务终态，无丢失、无非预期重复、无永久未决。
- **Tool Disclosure：** Schema Token 减少 92.89%，任务通过数 24→23，延迟上升。综合通过数与延迟，该方案不列为正向优化。
- **Skill 受控 A/B：** 6 类能力、48 个未见及干扰任务中，通过数 15/48→24/48，提升 18.75 个百分点；该集合中原本成功的任务均保持通过。混淆负例仍有误选，保留人工激活。
- **上下文与记忆：** 72 组确定性配对全部通过、仓库重复读取减少 50%，该集合中陈旧记忆及跨仓库污染均为 0。当前发布提供可选记忆后端接口。
- **读取并行：** 8 路合成异步读取微基准中位耗时 185.31 ms→51.50 ms，结果顺序一致。该项为 `synthetic_async_scheduler_microbenchmark`，`positive_claim_eligible: false`，结果用于观察合成异步任务的调度开销。
- **Evolver 小样本：** 训练通过率 40%→60%，四题封闭测试 25%→50%。该项为探索性小样本实验，与 48 题 Skill A/B 分别记录，稳定性需扩大样本验证。

## 资料来源

维护迭代提供公开源码、测试、演示与验证摘要。受控模型实验的公开材料包含方法、结果摘要、摘要哈希及重建步骤；历史付费调用和追踪原始记录保留在 Git 外。Runtime 扩展实验来自内部摘要，原始运行凭证未公开，复核范围为上述公开材料。

## 下一步

在小型社区记录 Issue 沉淀、修复触发、验收通过、维护者采纳与拒绝原因；为 Candidate 到 Skill 接入独立回放验收，并补充扩展实验的脱敏记录与冻结清单。
