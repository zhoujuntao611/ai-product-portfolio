# 作品集内容审阅与调整

审阅日期：2026-10-26（北京时间）。本记录核对改进清单与仓库现有材料，说明本轮内容调整及证据边界，不新增用户成效或模型实验结果，也不代表重新执行了历史付费实验。

## 清单中成立的判断

- 求职定位、本人职责和产品判断应先于功能与技术细节，项目需要明确主次。
- 卡片应同时回答目标用户、核心问题、我的工作、关键取舍、项目阶段与证据入口。
- 固定开发题的通过数、模拟响应、真实模型调用和用户效果需要分别说明；测试通过不能直接换算为业务收益。
- 简历或公开履历、源码、联系与返回入口应真实可用；移动端和链接应另行检查。

## 本轮已处理的内容

- [仓库首页](../README.md)调整为 AI 产品经理实习方向，顺序统一为 Oriel、SupportFlow、MetricPilot、攀迹；各项目补充本人工作、一个代表性取舍、实现状态和验证材料。
- Oriel 优先展示从问题沉淀、修复到独立验收的维护流程，并说明本地候选仍需维护者决定；[流程](../projects/oriel/WORKFLOW.md)、[源码](../projects/oriel/source/)与[指标边界](../projects/oriel/EVIDENCE.md)分别提供入口。
- SupportFlow 将历史模拟回归与后续真实模型实测分开；MetricPilot 保留规则解析、口径确认与结果追溯定位；攀迹明确开发预览和原环境模型验证范围。
- 公开履历入口指向[公开资料页](https://zhoujuntao611.github.io/ai-product-portfolio/profile/)，不增加私人简历、开发环境资料或模型凭据。运行、历史 ClimbAI 状态、AI 协作和许可说明继续保留。

## 需要纠正的三点

### 攀迹不等于 ClimbAI

ClimbAI 探索训练计划和反馈调整，历史网页演示采用规则模式，后端另有 DeepSeek 实测。攀迹是独立的微信训练记录小程序，使用自己的代码与存储，原环境模型为腾讯混元 `cloudbase/hy3`。两者不能合称“攀迹 ClimbAI”，也不能合并模型调用或验证结果。

证据：[项目演进](CLIMBING_EVOLUTION.md)、[ClimbAI 历史实现](../projects/climbai/README.md)、[历史模型实测](LIVE_PRACTICE_20261019.md)、[攀迹证据说明](../projects/panji/docs/EVIDENCE.md)。攀迹手机操作反馈没有可核实的人数与时长，不写成系统用户研究。

### 历史批次零调用不代表项目从未调用模型

SupportFlow 的 26 项开发回归包含模拟响应，该轮真实模型调用为零；后续 2026-10-19 已记录真实 DeepSeek 调用。模型流程在固定构造场景中由 16/24 到 24/24，规则流程修复后同样为 24/24，不能据此归因于模型增益。题目用于修复后的同题复测，不能称为独立盲测或真实客服准确率。

证据：[26 项历史回归](../projects/supportflow/docs/ITERATION_EVIDENCE.md)、[统一口径首轮报告](../projects/supportflow/verification/live-20261019-initial-regraded.json)、[修复后报告](../projects/supportflow/verification/live-20261019-after.json)、[题目与评分要求](../projects/supportflow/eval/live_cases_20261019.json)、[实测解释](LIVE_PRACTICE_20261019.md)。MetricPilot 当前 CSV 路由仍无外部模型调用，见[产品范围](../projects/metricpilot/docs/PRD.md)。

### Oriel 公开说明不等于原始付费运行凭证

Oriel 提供维护流程源码、运行方法与实验说明，但历史付费模型原始运行凭证未随仓库公开，本轮未独立重跑。4,158/4,160 中有两次缺少验收标记，未达到该实验的全部通过门槛；48 项 Skill 实验属于固定受控任务，不能写成真实社区修复率或已接通的维护经验闭环。首页优先展示可查看的流程与实现，完整实验口径保留在[指标范围](../projects/oriel/EVIDENCE.md)。

## 验证与后续边界

本轮内容审阅沿用已有报告，不新增模型调用、用户数据或效果测量。网页布局、静态链接及本地应用检查的执行方式见[开发说明](DEVELOPMENT.md)，实际执行结果应以对应报告与 [Actions](https://github.com/zhoujuntao611/ai-product-portfolio/actions/workflows/verify.yml) 为准。

真实用户试读、客服任务用时、指标理解、训练建议采纳与长期使用结果仍需另行获取；这些是后续验证方向，不是本次已获得成果。
