# Oriel 完整维护流程

Oriel 的当前交付终点是可审查的本地 PR Candidate。以下将产品流程与对应源码放在一起。

## 1. 群聊答疑与澄清

输入是飞书群消息、原始消息链接和当前会话。普通问答走 Gateway；缺少环境、复现步骤或预期行为时，先补充资料。普通群成员通过提问参与，不获得修复工具或仓库写权限。

[飞书接入](source/docs/onboarding/feishu.zh-CN.md) · [会话与调度](source/pico/spine/)

## 2. 将有效反馈整理成 Issue

配置中的维护者回复原消息并发送 `/issue`。Coordinator 检查维护者及群授权，持久化 Proposal，按来源指纹去重，再在固定 Gitee 仓库创建或找到 Issue。卡片保留 Issue 和原消息入口。发布失败保留失败状态，不能把本地 Proposal 当作远程 Issue。

[协调与命令处理](source/pico/maintenance/coordinator.py) · [维护模块](source/pico/maintenance/)

## 3. 锁定修复任务

维护者发送 `/fix` 引用原问题或指定 Issue。重新读取 Issue 后，固定仓库、Base Revision 和验收命令；同一 Issue 已排队、运行或已有 Candidate 时不重复启动。Issue 正文作为问题数据传入独立 Session。

产物是持久化 Job、固定 Base Commit 和待执行的验收条件。进度通过原飞书消息或话题回传。

[任务模型](source/pico/maintenance/models.py) · [任务协调](source/pico/maintenance/coordinator.py)

## 4. 在 Repair Worktree 复现、修改与检查

Runner 从固定提交创建独立工作目录，运行修复 Agent，保存 Agent 日志，再执行验收命令。无修改、Agent 非正常退出或检查失败均保留诊断，不提前标记成功。

[修复执行器](source/pico/maintenance/runner.py)

## 5. 在干净 Verifier Worktree 重放补丁

从相同 Base Commit 创建另一份干净目录，重新应用 Patch，执行同一组固定验收命令，保存退出码与日志。验证目录不继承修复目录的未提交状态，避免依赖修复环境中的残留文件。

验收只覆盖预先定义的命令与条件，不能保证解决所有未知问题。维护流程测试涵盖成功候选，以及“修复检查通过但干净验证失败”的情况。

[重放与失败路径测试](source/tests/test_maintenance.py)

## 6. 交付候选与终态

- `candidate_ready`：干净验证通过，提供 `CANDIDATE.md` 和 `candidate.patch`。
- `verification_failed`：检查或补丁重放未通过，提供诊断。
- `blocked`：缺少前提、无修改或被中断等，说明原因。

候选包包含 `manifest.json`（Issue、基准版本、变更文件、命令、退出码和终态）、Agent 日志与检查日志。飞书终态回复关联原 Issue 和消息。Gateway 重启后未完成任务按受阻处理。

维护者检查补丁和测试范围，决定是否创建 PR 及合入。候选数、通过数与采纳数分别记录。

## 7. 后续经验复用

Runtime 的 Skill / Evolver 有独立的候选隔离、测试与人工激活流程。维护者 Candidate 自动提炼为 Skill 尚未接通；计划先积累多次相似案例，再在未参与归纳的历史 Issue 上验证，人工决定是否激活。

[Runtime 与评测文件导览](FILE_GUIDE.md) · [实验指标及边界](EVIDENCE.md) · [安装与验证](RUNNING.md)
