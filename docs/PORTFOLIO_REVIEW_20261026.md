# 作品集内容与信息结构

评审记录：2026-10-26；最近整理：2026-10-27。本文记录主页与项目介绍的内容组织方式。

## 主页阅读顺序

- 首屏说明 AI 产品经理实习方向、教育背景与工作方式。
- 项目顺序为 Oriel、SupportFlow、MetricPilot、攀迹，突出主打项目和配套案例。
- 项目卡片依次呈现目标用户、我的工作、关键取舍与验证材料。
- 履历、源码、联系方式与返回入口支持继续阅读。

## 项目叙事

- **Oriel：**从群聊反馈、Issue、修复到独立验收，重点呈现人工确认、三阶段回归门禁与候选交付。正文保留成本和调度两组实验，Runtime 扩展实验收进技术附录。详见[维护流程](../projects/oriel/WORKFLOW.md)与[实验记录](../projects/oriel/EVIDENCE.md)。
- **SupportFlow：**围绕政策检索、引用核对与人工审核，说明申请期限和到账时间分开检查的决策。26 项合成开发回归与历史模型接入实验分别呈现，样本和同题复测条件集中在[结果说明](../projects/supportflow/docs/RESULTS.md)。
- **MetricPilot：**围绕 CSV 导入、口径确认与结果追溯，用九笔示例订单说明退款日期归属的影响。固定输入回归与修改过程见[迭代记录](../projects/metricpilot/docs/ITERATION-20261019.md)。
- **攀迹：**围绕训练记录、线路历史、视频回看与文字复盘，呈现手机操作反馈带来的交互调整，以及训练上云、视频留本机的存储选择。模型接入与开发检查见[验证记录](../projects/panji/docs/EVIDENCE.md)。

早期 ClimbAI 的训练计划与反馈探索保留在[项目演进](CLIMBING_EVOLUTION.md)和[历史实现](../projects/climbai/README.md)中，供技术阅读与复现。

## 验证与下一步

网页布局、静态链接及本地应用的检查方式见[开发说明](DEVELOPMENT.md)，执行结果见对应报告与 [Actions](https://github.com/zhoujuntao611/ai-product-portfolio/actions/workflows/verify.yml)。实验条件和数据来源放在各项目的验证材料中。

后续结合实际任务记录客服处理用时、指标口径理解、训练建议采纳及维护者审查结果，用于确定下一轮迭代重点。
