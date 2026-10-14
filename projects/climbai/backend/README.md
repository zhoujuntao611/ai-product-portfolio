# Coach API 实现说明

从项目根目录运行：

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

安装依赖见根目录 `requirements.txt`。若根目录存在 `dist/`，同一个服务也提供前端。Swagger 位于 `/docs`。数据库路径按项目根目录解析，改变启动工作目录不会把记录写到别处。

## 模式与事实边界

- 默认 `provider=demo`：画像来自自评及真实输入记录，训练计划由明确规则组成，不调用模型。运行记录的 `model_calls=0`。
- 可选 `provider=llm`：同时显式配置 `.env` 中的 key/model，规划节点调用结构化模型，从库内练习ID选择计划；反馈节点归纳用户卡点与待验证假设；知识问答使用当前检索证据。反馈计划的动作和时长仍由代码约束，模型不能提高负荷或覆盖已确认计划。
- API 未配置完整时，health/state 展示 `configuration_warning`；模型服务失败返回502，保留原计划，记录脱敏失败运行。不会将模型失败静默替换为规则结果。
- 知识库为开发者整理的 Demo 内容，含参考资料的短中文摘要与自编产品规则。专业教练审核、训练效果验证均待完成。
- Chroma 使用本地字符 n-gram 哈希向量；这是检索 Demo，不是模型语义 embedding。不下载模型。未安装Chroma或测试显式关闭索引时使用同一算法的本地备用检索，health标明实际后端。
- Chroma 在私有子进程中启动，完成实际索引查询后才报告就绪。原生库崩溃不会终止 API；health 的 `index_status=fallback_ready` 与 `index_warning` 明确记录降级。Windows 开发依赖固定为已选择验证的 Chroma0.6.3、ONNX1.20.1、NumPy1.26.4。
- 画像不包含力量/耐力分数；没有测量的数据为未知。疼痛反馈立即暂停相关任务并跳过模型；保持原计划按钮不能解除暂停。

## 身份与保存

除了 health/docs，每个API请求需要 `X-Session-ID: <UUID>`。这是匿名工作区的 bearer ID，持有该ID能访问该工作区；仅适用于隔离作品集 Demo，并非生产身份系统。服务默认只监听本机。生产部署还需要账户登录、权限、速率限制和监控。

SQLite事务保存完整业务状态及可查询的画像、计划、训练、报告、回答、运行快照。训练完成与反馈独立保存。接受修改生成新计划版本；拒绝修改保留原计划并记录决定。修改时在事务内核验预期版本，旧版本请求返回409。Demo 为简化实现会在模型请求期间持有写事务；多人高并发部署需将外部调用移出写事务并加 CAS。

## 主要接口

- `GET /api/health`：provider、编排器、实际检索后端与知识库状态。
- `GET /api/state`：完整前端状态；所有业务变更接口也返回该状态。
- `GET /api/profile`；`POST/PUT /api/profile`：保存档案，`adult_confirmed=true` 是生成计划前置条件。
- `POST /api/profile/correct`：`{dimension_key,correction}`，保存用户纠正与画像版本。
- `POST /api/plans/generate`：可选 `{goal,available_minutes}`。
- `GET /api/plans/current`；`POST /api/plans/confirm` 或 `/api/plans/{id}/confirm`：`{expected_version}`。
- `POST /api/sessions/{id}/complete`：`{actual_minutes}`，独立保存训练完成。
- `POST /api/sessions/{id}/feedback`：`{difficulty:1..5,completed,main_issue,pain,notes?,actual_minutes?}`；需先保存完成。
- `POST /api/reports/{id}/accept|keep` 或 `/api/adjustments/{id}/accept|keep`：`{expected_version}`。
- `POST /api/knowledge/ask`：`{question}`，返回回答、库内引用、provider、资料不足标志、run_id。
- `GET /api/history`；`GET /api/runs`：版本、日志、埋点及工作流轨迹。
- `GET /api/export`；`DELETE /api/data`：仅作用于当前匿名工作区。
- `POST /api/demo/reset|load`：`{scenario:'footwork'|'time_short'|'pain'|'empty'}`；替换当前工作区为明确标注的模拟案例，绝不消费付费模型调用。

## 可复验验证

```powershell
.\.venv\Scripts\python.exe -m pytest tests/backend -q
```

测试覆盖时长/器材/引用校验、真实节点轨迹、匿名隔离、独立完成、重复提交、用户确认、旧版本冲突、不适暂停、未知问题拒答、画像纠正、重启持久化、导出/删除、LLM失败保留状态与有限修复。网络模型部分使用明确标注的模拟响应验证结构与业务约束；未声称完成真实付费模型质量评测。

API适配依据：[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)。`responses` 模式使用 `text.format`，`chat` 模式使用 `response_format`。输出token上限、25秒请求超时及至多一次计划修复限制资源消耗。服务器不会把API key、Authorization或供应商错误响应写入业务日志或导出。
