# Oriel 指标与证据范围

核对日期：2026-10-25（北京时间）。本次检查源码、实验说明与作品集链接，没有重新执行付费模型实验，也没有操作真实飞书群或 Gitee Issue。

## 源码快照

维护者功能位于 `release/maintainer-profile`，核对版本为 `afdd62099b900a3c046dd96396268b7a8403d9c4`。默认 `main` 分支在本次核对时主要展示 Runtime，作品集因此直接链接维护者分支。

- [飞书维护模式说明](https://gitee.com/htxoffical/pico-harness/blob/afdd62099b900a3c046dd96396268b7a8403d9c4/docs/onboarding/feishu.zh-CN.md)：`/issue`、`/fix`、去重、进度回传及候选文件交付。
- [维护命令与授权](https://gitee.com/htxoffical/pico-harness/blob/afdd62099b900a3c046dd96396268b7a8403d9c4/pico/maintenance/coordinator.py)：维护者命令与任务协调。
- [修复和验证流程](https://gitee.com/htxoffical/pico-harness/blob/afdd62099b900a3c046dd96396268b7a8403d9c4/pico/maintenance/runner.py)：独立工作目录、补丁与终态。
- [维护流程测试](https://gitee.com/htxoffical/pico-harness/blob/afdd62099b900a3c046dd96396268b7a8403d9c4/tests/test_maintenance.py)：临时 Git 仓库验收测试。存在测试代码与本次实际运行测试是不同的事实；本次未重新运行该引擎测试。

PR Candidate 为本地补丁及报告，不代表已经创建远程 Pull Request，也不代表维护者已采纳。

飞书接入文档将 Candidate 到 Skill 列为后续流程；本次未发现维护任务自动调用 Skill / Evolver 的管线。Runtime 经验复用实验不能写成已经接通的维护业务闭环。

## 仓库有实验说明的指标

### 调度

真实 Agent 实验执行 4,160 次 Turn，4,158 次通过任务验收（99.95%）；前台 P95 观测值从 13.57 秒降至 11.66 秒。两次回复缺少验收标记，因此未达到预注册的全部通过门槛，聚合报告明确为 `claim_eligible: false`。不据此宣称整体通过优化门槛。评测请求数不代表社区用户数或线上业务量。

[实验方法、结果及边界](https://gitee.com/htxoffical/pico-harness/blob/afdd62099b900a3c046dd96396268b7a8403d9c4/docs/evaluation/runtime-scheduler-experiments.md)。原始运行凭证按上游说明保留在 Git 外，作品集未重新执行实验。

### 模型调用估算成本

36 组配对、72 次 Trial、504 次真实 DeepSeek 调用，两组分别 36/36 通过。稳定前缀相比逐次扰动前缀，单位成功任务估算成本的**任务聚类配对估计为下降 72.0750%（展示四舍五入为 72.08%）**；汇总比值为下降 72.3413%，两种估计不能混写。

对照是冻结任务条件下的前缀扰动实验，不是产品改版前后。费用使用冻结价格快照，尚未与 Provider 账单核销。

[成本实验说明](https://gitee.com/htxoffical/pico-harness/blob/afdd62099b900a3c046dd96396268b7a8403d9c4/docs/evaluation/tokenwise-cost.md)。原始记录未随仓库公开，文档保留摘要、摘要哈希和重建流程。

### 追踪开销

1,000 组确定性配对、2,000 次 Turn；开启追踪的一侧保留 1,000 条 Trace 并完整关联。P95 延迟差约 2.245 ms，每个启用追踪的 Turn 写入约 25.1 KiB。基线是很短的本地确定性任务，不能外推为线上相对开销。

[追踪测量说明](https://gitee.com/htxoffical/pico-harness/blob/afdd62099b900a3c046dd96396268b7a8403d9c4/docs/evaluation/tracing-overhead.md)。原始凭证在 Git 外，本次仅核对实验说明。

## 作者提供、未随公开仓库附原始凭证的结果

以下数据来自本项目作者提供的项目材料，不作为本次独立复现结果：

- **请求完整性：** 10,000 个已接受请求无丢失、无非预期重复、无永久未决，来自作者提供的确定性压力实验；代码有对应记账与门槛，受查公开说明中未检出该次原始结果。范围为进程内请求接受至任务终态，不代表跨崩溃或外部副作用恰好一次。
- **Tool Disclosure：** Schema Token 减少 92.89%，任务通过数 24→23，延迟上升；据此不认定为正向优化。没有证据支持“减少 92.89% 总 Token 或总成本”。
- **Skill 受控 A/B：** 6 类能力、48 个未见及干扰任务中，通过数 15/48→24/48，提升 18.75 个百分点；该集合中未出现原本成功任务在加经验后失败。混淆负例仍有误选，保留人工激活。属于 Runtime 侧实验，不能当作真实社区修复成功率或已接通 Candidate→Skill 管线。
- **上下文与记忆：** 72 组确定性配对全部通过、仓库重复读取减少 50%，该集合中陈旧记忆及跨仓库污染均为 0；当前公开发布仅提供可选记忆后端接口，不捆绑外部记忆实现。
- **读取并行：** 8 路合成异步读取微基准中位耗时 185.31 ms→51.50 ms，结果顺序一致。实验代码明确标为 `synthetic_async_scheduler_microbenchmark`、`positive_claim_eligible: false`，不能外推为真实读盘、生产端到端或完整修复任务提速。
- **Evolver 小样本：** 训练通过率 40%→60%，四题封闭测试 25%→50%；样本不足，不作为统计稳定的效果结论。与 48 题 Skill A/B 是不同实验。

上游仓库中是否保留完整原始记录与本作品集是否能公开审计，应分别判断。后续补充脱敏记录、冻结清单及独立摘要绑定后，才能加强可复现性表述。

## 不纳入 Oriel 效果的数字

Myna 在 LoCoMo 上的 1,540 问与 84.74% 属于独立记忆系统的评测，不能作为 Oriel 的准确率或社区修复通过率。本页不据此宣称产品效果。

当前未提供可核验的真实试用群数、用户数、运行周数、远程 PR 数、维护者采纳率或节省工时。主页业务指标保留为后续采集计划。
