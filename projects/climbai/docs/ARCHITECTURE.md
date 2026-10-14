# ClimbAI 架构与接口

## 两种运行方式

浏览器演示：React 前端通过 LocalProvider 操作当前浏览器的状态，示例知识与规则随构建发布。演示不联网调用模型，不自动上传记录。

完整本地服务：React APIProvider 调用 FastAPI，以 `X-Session-ID` 隔离匿名工作区。SQLite 保存业务状态与快照，Chroma 保存示例知识索引，模型适配仅运行在后端。

## 模块

- `web/src/lib/types.ts`：前端领域接口。
- `web/src/lib/provider.ts`：本地与 API 数据适配。
- `backend/main.py`：输入、匿名工作区、业务路由、确认与异常。
- `backend/models.py`：Pydantic 输入模型。
- `backend/coach.py`：LangGraph 受控流程与计划规则。
- `backend/provider.py`：Responses / Chat Completions 结构化模型协议与脱敏错误。
- `backend/knowledge.py`：哈希向量索引、场景筛选、来源读取。
- `backend/knowledge.json`：示例知识、练习、来源及审核状态。
- `backend/store.py`：SQLite 事务、状态与版本快照。

## 工作流

首次：画像 → 检索 → 计划 → 业务规则校验 → 用户确认。

反馈：完成记录 → 不适检查 → 反馈归纳 → 合并画像 → 检索 → 受约束调整 → 校验 → 用户确认。明确配置模型时，非不适反馈可以调用模型进行语义归纳，调整动作和时长仍由规则控制。不适跳过模型并立即暂停相关推荐。

知识问答：范围检查 → 检索证据 → 回答或说明不足 → 引用 ID 校验。

画像初始值以用户自评和记录为依据，没有科学能力评分。四个 Agent 是职责节点，检索、统计、版本和校验不必调用模型。

## 最小 API

除健康检查外，接口要求匿名 UUID 请求头。写入接口通常返回完整状态，知识问答返回答案对象。

- `GET /api/health`：运行模式、配置提示、检索和编排状态。
- `GET /api/state`：当前画像、计划、训练、报告、运行、知识元数据。
- `GET /api/profile`、`PUT /api/profile`：读取和保存档案。
- `POST /api/profile/correct`：提交画像纠正。
- `POST /api/plans/generate`：生成计划草案。
- `POST /api/plans/{plan_id}/confirm`：校验 `expected_version` 并确认。
- `GET /api/plans/current`：当前计划。
- `POST /api/sessions/{session_id}/complete`：独立保存完成事件。
- `POST /api/sessions/{session_id}/feedback`：反馈及调整草案。
- `POST /api/adjustments/{id}/accept`、`keep`：处理调整，保留版本。
- `POST /api/knowledge/ask`：知识回答及来源。
- `GET /api/history`、`GET /api/runs`：历史与运行。
- `GET /api/export`、`DELETE /api/data`：导出或删除当前工作区数据。
- `POST /api/demo/reset`：明确的模拟样例重置，不用于真人成效。

完整字段以运行时 `/docs` 的 OpenAPI 为准。

## 状态与版本

Profile、Plan、TrainingLog、FeedbackReport、KnowledgeAnswer、AgentRun 是主要领域对象。SQLite 同时保存工作区 JSON 和按工作区隔离的快照，训练记录关联所属计划版本。

计划草案与已确认计划分开。调整记录保存基础计划 ID 和版本；确认在事务中检查当前版本及画像版本。重复完成或重复反馈返回冲突，避免计数重复。模型或校验失败不发布未验证计划。

## 模型与边界

模型只能使用给定知识和练习 ID。结构化输出并不自动证明内容正确，仍需业务规则和人工领域评测。

时长、器材、准备 / 休息 / 复盘组成、引用 ID 和重复动作由代码检查。计划结构无效最多修复一次；调用失败显式显示错误。疼痛或诊疗请求走产品保守边界。

Responses 与 Chat 格式的协议适配都不代表已经完成真实供应商业务测试。费用与 token 统计未接入时保持未知，不展示虚构账单。

## 数据与运行限制

匿名 UUID 属于 Demo 工作区令牌，适合隔离测试；公开服务应增加正式认证、速率限制和访问审计。模型密钥仅在后端 `.env`，运行日志和导出不包含它。

默认绑定本机，CORS 限于声明的本地前端与个人主页来源。SQLite 写入采用事务；模型调用与写入在本地 Demo 中可能占用事务锁，正式多人服务需要拆分运行任务与提交事务。

Chroma 使用已实测的版本；知识索引可以重建，业务数据库不可作为索引缓存删除。库版本变化应重新评测并记录来源变更。
