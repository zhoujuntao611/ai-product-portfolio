# 简历技能对应的项目与记录

更新于 2026-10-26。本文将技能、实际实现和验证范围放在一起，便于从简历继续查看。当前简历主述 Oriel、攀迹和 SupportFlow；早期 ClimbAI 原型的代码仍保留在仓库中。

## 检索增强与模型调用

SupportFlow 将客户问题拆开，按政策原文进行检索与 BM25 排序，按地区、版本和时间条件筛选。模型模式选择已有条款，再由本地原文组装答案，保留引用与人工审核。

这是受约束的检索增强流程，未将其写成已经实测过的语义向量检索。

[检索与模型选证实现](../projects/supportflow/core.py#L142) · [检索方案比较](../projects/supportflow/docs/RETRIEVAL.md) · [知识资料与版本](../projects/supportflow/docs/KNOWLEDGE.md)

## LangGraph 与 FastAPI

这两项来自早期 ClimbAI 原型。`coach.py` 实际创建、编译并调用 `StateGraph`；`main.py` 创建 FastAPI 应用、注入状态并提供接口。当前 SupportFlow 的 HTTP 服务使用另一套实现，不能将它描述为基于 FastAPI。

ClimbAI 已退出主展示页面，保留代码和历史实测记录用于复现，不将其混同为攀迹微信小程序的实现框架。

[LangGraph 工作流](../projects/climbai/backend/coach.py#L40) · [FastAPI 接口](../projects/climbai/backend/main.py#L41) · [历史运行记录](../projects/climbai/verification/live-workflow-20261019.json)

## MCP 工具接入

Pico Runtime 中有实际 MCP 连接与工具执行逻辑：导入 stdio、SSE 和 Streamable HTTP transport，初始化 Session，发现并注册工具，随后调用远端工具。

[MCP 实现源码](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/oriel/source/pico/agent/tools/mcp.py) · [维护者产品与运行时关系](../projects/oriel/README.md)

上述源码现已同步至本 GitHub 仓库，获取和验证步骤见 [Oriel 运行说明](../projects/oriel/RUNNING.md)，不依赖 Gitee 网页访问。

## Python 与 SQL

SupportFlow 使用 Python 处理政策检索、模型协议和服务逻辑；SQLite 保存工单与审核记录，包含参数化查询、插入和更新。

[服务及 SQL 实现](../projects/supportflow/server.py#L33) · [数据结构与业务逻辑](../projects/supportflow/core.py)

## 产品文档与可运行原型

产品文档说明使用流程、异常状态、范围取舍和验收条件。SupportFlow 前端具有草稿生成、编辑、审核和资料维护交互；攀迹为微信小程序开发预览，页面公开的是开发者工具截图，不把图片当作已经公开上线的应用。

[SupportFlow PRD](../projects/supportflow/docs/PRD.md) · [前端交互实现](../projects/supportflow/web/app.js#L94) · [攀迹 PRD](../projects/panji/docs/PRD.md) · [攀迹验证范围](../projects/panji/docs/EVIDENCE.md)

## 评测集、基线比较与问题复盘

SupportFlow 保留固定问题集、冻结的对照版本、逐题预期和失败原因。26 项集合用于已知问题修复后的开发回归，其中两道选证题使用模拟模型，不作为未见样例上的准确率。

PicoBench 的成本实验使用 4 类负载、每类 3 个固定用例、每个重复 3 次，共 36 组配对。两组成功数相同，在此条件下比较单位成功任务的估算成本；它不是真实社区 Issue 修复率实验。

[SupportFlow 回归与取舍记录](../projects/supportflow/docs/ITERATION_EVIDENCE.md) · [回归执行脚本](../projects/supportflow/verification/review_regression.py#L84) · [Oriel 成本口径](../projects/oriel/EVIDENCE.md) · [PicoBench 成本实验说明](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/oriel/source/docs/evaluation/tokenwise-cost.md)
