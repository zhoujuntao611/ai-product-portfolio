# 周俊涛的个人项目

这里收录攀岩记录、开源维护、客服回复和订单分析相关的个人项目，包括产品文档、源码入口和开发记录。开发借助 AI 编程工具完成。

[个人主页](https://zhoujuntao611.github.io/ai-product-portfolio/) · [运行与验证](docs/DEVELOPMENT.md)

## 攀迹 · 攀岩记录小程序

记录到馆训练、线路尝试和卡点，把视频关联到对应记录。下次挑战同一条线路时，可以查看不同日期的尝试。

支持训练草稿、连续记录、线路历史和视频回看。当前为 0.2.2 开发预览，尚未公开发布；训练记录可存云端，视频与关联信息保存在当前设备。

[查看项目](https://zhoujuntao611.github.io/ai-product-portfolio/panji/) · [源码与运行](projects/panji) · [验证范围](projects/panji/docs/EVIDENCE.md)

## Oriel · 开源维护者 Agent

面向飞书社区中的项目答疑与 Bug 反馈，通过 `/issue` 将有效问题沉淀为 Gitee Issue，再通过 `/fix` 启动修复与独立验证，交付带补丁和测试记录的 PR Candidate，由维护者审查并决定是否合入。

Oriel 是面向维护者的产品层，Pico Runtime 提供任务调度、上下文、工具和评测底座。实现与评测位于外部 Pico 仓库的 `release/maintainer-profile` 分支；本仓库提供项目介绍与证据口径，不包含引擎源码。页面中的流程是示意，不是运行截图，实验结果也不代表线上社区采用效果。

[查看项目](https://zhoujuntao611.github.io/ai-product-portfolio/oriel/) · [实现与评测](https://gitee.com/htxoffical/pico-harness/tree/release/maintainer-profile)

## SupportFlow · 客服回复助手

根据政策资料整理回复草稿，展示引用原文和版本。客服可以修改、批准、退回或转人工，处理结果保存在本地。

支持政策导入与版本管理。默认规则模式，可自行配置模型；未接入真实客服渠道，界面与测试使用合成政策和工单，尚无节省工时等真实使用效果数据。

[查看项目](https://zhoujuntao611.github.io/ai-product-portfolio/supportflow/) · [源码与运行](projects/supportflow) · [开发记录](projects/supportflow/docs/ITERATION_EVIDENCE.md)

## MetricPilot · 订单分析工具

导入订单 CSV，查看收入、渠道和退款情况。报告保留筛选条件、查询和原始数据行，可以核对并导出。

当前使用规则识别常见问题，没有外部模型调用。支持单张订单表，不支持多币种混算或分次退款；示例与测试结果不代表真实经营效果。

[查看项目](https://zhoujuntao611.github.io/ai-product-portfolio/metricpilot/) · [源码与运行](projects/metricpilot) · [修改与测试记录](projects/metricpilot/docs/ITERATION-20261019.md)

## 运行与检查

Windows 可使用根目录 `start-projects.cmd` 启动两个本地网页应用，使用 `stop-projects.cmd` 关闭。其他系统及各项目的独立运行方式见 [开发说明](docs/DEVELOPMENT.md)。GitHub Pages 提供项目介绍和界面预览，不运行 Python 后端。

工程检查、模型实验和用户效果分别记录。最新工程检查见 [GitHub Actions](https://github.com/zhoujuntao611/ai-product-portfolio/actions/workflows/verify.yml)，历史实验见 [实测记录](docs/LIVE_PRACTICE_20261019.md)。当前没有已验证的留存、节省工时或训练改善结果。

早期 ClimbAI 原型已退出公开展示，源码保留在 [projects/climbai](projects/climbai)，用于复现历史记录。

## 来源与许可

SupportFlow、MetricPilot、ClimbAI 代码按各自随附 MIT LICENSE 提供。攀迹代码用于公开展示，未授予统一开源许可；其中 OSM 数据子集适用独立的 ODbL，其他资料保留各自来源与权利。见 [攀迹来源与许可](projects/panji/README.md#数据来源与许可)。

仓库不提供开发账号、模型凭据、私人简历或用户训练数据。项目界面使用示例数据；公共场所资料不代表用户规模或实时营业状态。
