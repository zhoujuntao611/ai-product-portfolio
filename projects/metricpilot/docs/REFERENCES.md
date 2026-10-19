# 产品参考与设计采用

观察日期：2026-10-18。以下为公开产品页面中的流程与原则参考；采用的是交互和复核方法，不使用其客户、收入或效果数字作为本项目成果。

## Julius：从文件到可交付报告

[Julius AI Report Generator](https://julius.ai/home/ai-report-generator) 展示“提供文件或需求 → 运行分析 → 结构化报告”的流程，并强调数字来自可检查的计算。

MetricPilot 采用连续的任务闭环：导入自己的 CSV，完成分析后直接导出报告；图表、结果表和结论使用同一份计算结果。首版将输入收敛为单张订单 CSV，重点把映射、数据检查和口径确认做完整。

## ThoughtSpot：让数据、查询与计算可复核

[ThoughtSpot AI Principles](https://www.thoughtspot.com/trust/ai-principles) 强调基于数据的输出、来源归属、查询可见和人工监督。

MetricPilot 将这些原则转成可操作功能：每条结论关联查询编号，查询展示参数与原始结果；源文件哈希和物理行号定位输入；日期、退款分母及取消状态由用户确认。工程实现使用范围明确的只读工具。

这些采用点属于本项目的产品设计解释；公开页面不是 MetricPilot 的用户验证或第三方认证。
