# Oriel 完整维护流程

Oriel 将群聊反馈整理为 Issue，组织修复与独立验收，交付可审查的本地 PR Candidate。以下按阶段说明输入、产物与验收。

## 1. 群聊答疑与澄清

输入是飞书群消息、原始消息链接和当前会话。普通问答走 Gateway；缺少环境、复现步骤或预期行为时，先补充资料。普通成员提供问题，维护者确认仓库操作。

[飞书接入](source/docs/onboarding/feishu.zh-CN.md) · [会话与调度](source/pico/spine/)

## 2. 将有效反馈整理成 Issue

配置中的维护者回复原消息并发送 `/issue`。Coordinator 检查维护者及群授权，持久化 Proposal，按来源指纹去重，再在固定 Gitee 仓库创建或找到 Issue。成功卡片保留 Issue 和原消息入口，发布失败保留状态和原因。

[协调与命令处理](source/pico/maintenance/coordinator.py) · [维护模块](source/pico/maintenance/)

## 3. 锁定修复任务

维护者发送 `/fix` 引用原问题或指定 Issue。重新读取 Issue 后，确认仓库及配置的验收和可选回归命令；同一 Issue 已排队、运行或已有 Candidate 时不重复启动。Issue 正文作为问题数据传入独立 Session，Base Commit 在 Runner 实际执行时解析锁定。

产物是持久化 Job、固定 Base Commit 和待执行的验收条件。进度通过原飞书消息或话题回传。

[任务模型](source/pico/maintenance/models.py) · [任务协调](source/pico/maintenance/coordinator.py)

Proposal 或 Job 插入遇到唯一约束冲突时，先回滚失败事务，再返回已有对象，使后续配额事务及其他连接继续正常工作。[SQLite 事务回归测试](source/tests/test_maintenance_store_transactions.py)

## 4. 可选基线复现，再在 Repair Worktree 修改与检查

配置可选 `maintenance.regressionCommands` 后，Runner 先在第三份独立 Baseline Worktree 执行固定回归命令，每条均须退出 `1`；任一已通过、退出其他码、超时或缺少记录，任务受阻并保留诊断。

随后从相同提交创建 Repair，运行修复 Agent，保存日志，再执行原验收与可选回归。原验收必须全部通过，每条回归必须退出 `0`。无修改、Agent 非正常退出或检查失败均保留诊断，不提前标记成功。

未配置回归命令时使用原有 Repair / Verifier 路径，manifest 标记未验证复现。退出 `1` 也可能来自普通 Python 异常，维护者需核对日志，确认失败来自目标断言。[修复执行器](source/pico/maintenance/runner.py) · [回归配置说明](source/docs/onboarding/maintenance-regression.zh-CN.md)

## 5. 在干净 Verifier Worktree 重放补丁

从相同 Base Commit 创建另一份干净目录，重新应用 Patch，执行同一组固定验收及已配置的回归命令，全部须退出 `0`，保存退出码与日志。验证目录不继承修复目录的未提交状态，避免依赖修复环境中的残留文件。

补丁导出和一致性比较均相对锁定的 Base Commit；Repair 与 Verifier 检查后源码必须仍与候选补丁一致，候选新增文件也参与核对。验收自动改写源码或移动 HEAD 造成不一致时，任务保留失败诊断。

验收范围由固定命令与条件定义，测试覆盖范围及补丁中的测试修改由维护者复核。Worktree 用于工作目录分离，执行安全依赖配置的隔离后端。维护流程测试覆盖成功候选，以及“修复检查通过但干净验证失败”等情况。

[重放与失败路径测试](source/tests/test_maintenance.py) · [三阶段回归测试](source/tests/test_maintenance_regression.py)

## 6. 交付候选与终态

- `candidate_ready`：干净验证通过，提供 `CANDIDATE.md` 和 `candidate.patch`。
- `verification_failed`：检查或补丁重放未通过，提供诊断。
- `blocked`：缺少前提、无修改或被中断等，说明原因。

候选包的 `manifest.json` 使用 `pico.maintenance.candidate.v2`，保留 Issue、基准版本、变更文件、命令、退出码和终态，新增回归模式、状态与三阶段记录。各阶段按实际执行结果记录，外部读取程序需支持 v2。Agent 日志与检查日志随包保留，飞书终态回复关联原 Issue 和消息。Gateway 重启后未完成任务按受阻处理。

维护者检查补丁和测试范围，决定是否创建 PR 及合入。候选数、通过数与采纳数分别记录。

## 7. 后续经验复用

Runtime 的 Skill / Evolver 有独立的候选隔离、测试与人工激活流程。下一步将维护者 Candidate 接入经验提炼，积累相似案例后在未参与归纳的历史 Issue 上回放验证，由人工决定是否激活。

[Runtime 与评测文件导览](FILE_GUIDE.md) · [实验与验证记录](EVIDENCE.md) · [安装与验证](RUNNING.md)
