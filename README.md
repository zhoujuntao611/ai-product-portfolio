# 周俊涛的产品项目记录

我在北航读信息与通信工程。这些是与 AI 编程工具协作完成的个人项目，分别涉及攀岩记录、客服审核和订单分析。仓库保留源码、方案取舍和失败样例，开发检查与真实用户效果分开记录。

[个人主页](https://zhoujuntao611.github.io/ai-product-portfolio/) · [完整复盘文案](docs/PROJECT_NOTES.md) · [运行与验证](docs/DEVELOPMENT.md) · [ClimbAI 与攀迹的关系](docs/CLIMBING_EVOLUTION.md)

## 项目记录

### 攀迹

**背景：** 从早期训练规划转向现场记录，希望下一次能找回同一线路的尝试和视频。

**动作：** 补上连续保存、草稿恢复和线路关联，把视频移进尝试卡片；视频限制放宽后，仍需复试手机原片。

**关键决策：** 同名线路由用户关联，避免自动串错；训练可以存云端，视频留在本机；模型只做基于摘要的文字复盘，建议由用户确认。

**局限：** 关联多一步，换机影响视频回看。0.2.2 仍是开发预览，完整手机验收、公开发布与训练效果验证尚未完成。

[复盘](https://zhoujuntao611.github.io/ai-product-portfolio/panji/) · [源码与运行](projects/panji) · [验证范围](projects/panji/docs/EVIDENCE.md)

### SupportFlow

**背景：** 合成客服任务中，系统曾用“退款申请期限”回答“到账时间”。有引用，也可能答非所问。

**动作：** 对实际选中条款核对事项和周期，并修复问句拆分丢失主语、同义表达被误判为缺证据的问题。

**关键决策：** 小型政策库先用显式规则校验，模型只选择已有证据，回复保留人工审核。代价是资料和规则需要维护，审核工作仍然存在。

**局限：** 同组 24 项合成场景中，模型从 16/24 到 24/24，规则也从 18/24 到 24/24，未证明模型的额外增益。没有真实客服试用或节省工时的结果。

[复盘](https://zhoujuntao611.github.io/ai-product-portfolio/supportflow/) · [源码与运行](projects/supportflow) · [模型与规则对照](docs/LIVE_PRACTICE_20261019.md)

### MetricPilot

**背景：** 9 单合成表按原订单日与退款发生日，分别得到 30 元和 120 元。原流程曾忽略问题与界面的口径冲突。

**动作：** 拦截混合期间、口径冲突和未知分母。第一次修复还漏了 5 个运算或条件表达，同组 22 项验收经历 11 → 17 → 22 项通过。

**关键决策：** 冲突时不查询，让用户统一；只开放有限规则和受约束的只读统计。报告能追溯源行，但不能从订单单表推断经营原因。

**局限：** 复杂问题可能需要反复改写，不支持任意商品比较、多币种或分次退款事件。当前 CSV 入口没有外部模型调用，也没有真实使用效果验证。

[复盘](https://zhoujuntao611.github.io/ai-product-portfolio/metricpilot/) · [源码与运行](projects/metricpilot) · [三版重放](projects/metricpilot/docs/ITERATION-20261019.md)

## 早期探索：ClimbAI

**背景：** 最初尝试训练规划、知识检索与反馈调整，需求仍是未经过访谈验证的产品假设。

**动作：** 跑通建档、计划确认、记录和反馈。一次后端合成任务根据时间不足的反馈，将下次安排从 30 分钟改为 25 分钟。

**关键决策：** 允许用户保持原计划。在线演示使用本地规则，真实模型实验来自独立后端，两种结果分别说明。

**局限：** 实测 9 项检查只达到 8 项，复合知识问题未完整覆盖。没有教练审核或训练成效验证。后续以攀迹的记录与回看为主，两套代码、知识和存储没有自动合并。

[早期复盘](https://zhoujuntao611.github.io/ai-product-portfolio/climbai-notes/) · [本地规则演示](https://zhoujuntao611.github.io/ai-product-portfolio/climbai/) · [源码](projects/climbai) · [与攀迹的关系](docs/CLIMBING_EVOLUTION.md)

## 如何验证

SupportFlow 与 MetricPilot 默认只需 Python；攀迹本地检查需要 Node.js；ClimbAI 的前端和后端可分别运行。完整命令、依赖、网站检查及发布文件校验见 [开发与验证说明](docs/DEVELOPMENT.md)。

- **工程检查**验证已列出的程序行为；当前执行结果以 [GitHub Actions](https://github.com/zhoujuntao611/ai-product-portfolio/actions/workflows/verify.yml) 为准。
- **模型实验**有请求和逐题记录，但合成同题复测不等于盲测、真实用户成功率或业务收益。[实测记录](docs/LIVE_PRACTICE_20261019.md)
- **攀迹公开副本**有 174 项本地测试；原工程 176 项包含两项未公开的部署处理器测试，范围不同。[证据说明](projects/panji/docs/EVIDENCE.md)
- 当前没有已验证的留存、节省工时或训练改善结果。下一步应通过目标用户任务观察检验记录负担、审核成本与建议采纳。

## 来源与许可

SupportFlow、MetricPilot、ClimbAI 代码按各自随附 MIT LICENSE 提供。攀迹代码目前用于公开展示，未授予统一开源许可；其中 OSM 数据子集适用独立的 ODbL，其他资料保留各自来源与权利。见 [攀迹来源与许可](projects/panji/README.md#数据来源与许可)。

仓库不提供开发账号、模型凭据、私人简历或用户训练数据。项目界面和验收使用合成样例；公共场所资料不代表用户规模或实时营业状态。
