# 技术能力与项目实践

更新于 2026-10-27。围绕 Agent 工作流、检索增强、数据处理与交互原型，汇总关键实现和项目记录。

## Agent 工作流与回归验收

Oriel 将飞书反馈整理为 Gitee Issue，通过独立 Git Worktree 组织复现、修复和验证。可选回归检查要求 Baseline 退出 `1`、Repair 与 Verifier 退出 `0`，并核对验收后的源码与候选补丁一致；SQLite 保存任务状态、去重记录和配额。

[维护流程](../projects/oriel/WORKFLOW.md) · [三阶段回归测试](../projects/oriel/source/tests/test_maintenance_regression.py) · [事务回归测试](../projects/oriel/source/tests/test_maintenance_store_transactions.py)

## 检索增强与模型调用

SupportFlow 将客户问题拆开，按政策原文进行检索与 BM25 排序，按地区、版本和时间条件筛选。模型模式选择已有条款，再由本地原文组装答案，保留引用与人工审核。

[检索与模型选证实现](../projects/supportflow/core.py#L142) · [检索方案比较](../projects/supportflow/docs/RETRIEVAL.md) · [知识资料与版本](../projects/supportflow/docs/KNOWLEDGE.md)

## LangGraph 与 FastAPI

早期 ClimbAI 原型使用 LangGraph 编排训练计划与反馈流程：`coach.py` 创建、编译并调用 `StateGraph`，`main.py` 创建 FastAPI 应用、注入状态并提供接口。源码与历史运行记录保留用于复现。

[LangGraph 工作流](../projects/climbai/backend/coach.py#L40) · [FastAPI 接口](../projects/climbai/backend/main.py#L41) · [历史运行记录](../projects/climbai/verification/live-workflow-20261019.json)

## MCP 工具接入

Pico Runtime 中有实际 MCP 连接与工具执行逻辑：导入 stdio、SSE 和 Streamable HTTP transport，初始化 Session，发现并注册工具，随后调用远端工具。

[MCP 实现源码](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/oriel/source/pico/agent/tools/mcp.py) · [维护者产品与运行时关系](../projects/oriel/README.md)

安装与验证步骤见 [Oriel 运行说明](../projects/oriel/RUNNING.md)。

## Python 与 SQL

SupportFlow 使用 Python 处理政策检索、模型协议和服务逻辑；SQLite 保存工单与审核记录，包含参数化查询、插入和更新。

[服务及 SQL 实现](../projects/supportflow/server.py#L33) · [数据结构与业务逻辑](../projects/supportflow/core.py)

## 产品文档与可运行原型

产品文档明确使用流程、异常状态、范围取舍和验收条件。SupportFlow 实现草稿生成、编辑、审核和资料维护；攀迹已实现训练记录、线路关联、视频回看与文字复盘，当前为微信小程序开发预览。

[SupportFlow PRD](../projects/supportflow/docs/PRD.md) · [前端交互实现](../projects/supportflow/web/app.js#L94) · [攀迹 PRD](../projects/panji/docs/PRD.md) · [攀迹验证记录](../projects/panji/docs/EVIDENCE.md)

## 评测集、基线比较与问题复盘

SupportFlow 保留固定问题集、冻结的对照版本、逐题预期和失败原因。26 项合成输入用于同题修复后的开发回归，其中两道选证题使用模拟响应。

PicoBench 的成本实验使用 4 类负载、每类 3 个固定用例、每个重复 3 次，共 36 组配对。两组成功数相同，在此条件下比较单位成功任务的估算成本。

[SupportFlow 回归与取舍记录](../projects/supportflow/docs/ITERATION_EVIDENCE.md) · [回归执行脚本](../projects/supportflow/verification/review_regression.py#L84) · [Oriel 成本口径](../projects/oriel/EVIDENCE.md) · [PicoBench 成本实验说明](https://github.com/zhoujuntao611/ai-product-portfolio/blob/main/projects/oriel/source/docs/evaluation/tokenwise-cost.md)
