# SupportFlow · 智能客服工单助手

一个具备证据引用与人工审核流程的本地客服助手 MVP：**输入工单 → 检索有效政策 → 生成逐条引用草稿 → 人工审核 → 本地持久化与审计**。

产品“云桥协作”、知识政策与所有评估工单均为虚构演示构造。项目没有接入真实企业，没有真实客户、用户采纳率或节省工时数据。默认引擎是关键词检索与规则摘录，不是假装调用大模型的演示。

## 启动

需要 Python 3.10 或更高版本，不需要安装第三方依赖。

Windows：在项目文件夹打开 PowerShell，运行：

```powershell
python server.py
```

也可运行 `launch.ps1`。打开 [http://127.0.0.1:8765](http://127.0.0.1:8765)。按 Ctrl+C 停止。

如默认端口被占用：

```powershell
python server.py --port 8775
```

服务只绑定 `127.0.0.1`。不要改为外网绑定。本地工作区不包含账号登录、组织权限或加密数据库，不能作为共享生产系统。

## 3 分钟体验

1. 保留默认发票工单，点击“检索并生成草稿”。进入“检索证据”，核对 `KB-002` 的版本、更新时间、三条原文与草稿引用。
2. 返回草稿页，勾选人工检查，点击“批准并保存本地”。进入“审计记录”，确认生成事件、批准事件、内容 SHA-256 指纹；刷新页面后仍能从“最近工单”打开记录。
3. 选择“退款地区未知”样例。生成后应看到地区冲突，并同时展示大陆/海外两份候选文档；批准按钮保持禁用。选择大陆地区后重新生成，应仅引用 `KB-003` 的 7 天申请窗口。
4. 选择提示注入或立即删除样例。分别检查拒绝/转人工分支。可以保存转人工状态，但不会执行退款、账户删除或消息发送。
5. 修改可答工单的草稿，应显示“修改内容未自动验证”；批准后的审计事件应记录 `human_edited: true`。

“知识库与版本”可检查 9 份有效文档与 1 份已归档文档。导出按钮生成包含当前草稿、候选来源和审核记录的 Markdown 文件。

## 验证与评测

```powershell
python -m unittest discover -s tests -v
python evaluate.py
node --check web/app.js
```

Node 仅用于可选的前端语法检查，运行项目不需要 Node。

本次实际验证：32 个单元/接口测试通过；31/31 条合成离线工单回归通过。结果保存在 `eval_report.json`。该评估不是盲测，没有真实模型调用，不代表真实客服准确率。“引用一致性”只证明事实条目来自已有原文，不能证明选中的证据一定正确或完整回答问题。

## 可选真实模型

项目支持兼容 `POST /chat/completions`、JSON object 输出的 HTTPS 服务。配置项只在服务端环境变量中读取，不写入浏览器、不包含在代码中。API 提供方的格式、模型 ID 和权限需要自行确认。

在当前 PowerShell 会话中设置 `SUPPORTFLOW_API_BASE`、`SUPPORTFLOW_MODEL`、`SUPPORTFLOW_API_KEY`，再启动服务。以下演示使用隐藏输入，避免密钥出现在命令历史；不要把真实密钥粘贴到工单或提交到仓库。

```powershell
$env:SUPPORTFLOW_API_BASE = 'https://api.deepseek.com'
$env:SUPPORTFLOW_MODEL = '<填写账户实际可用的模型 ID>'
$taskSecret = Read-Host 'API key' -AsSecureString
$taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
try {
    $env:SUPPORTFLOW_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer)
}
python server.py
```

模型只选择检索候选文档的**既有条目编号**，草稿文本由本地逐条原文组装。未知编号、格式异常、输出截断、空证据、超时等有明确错误或停止生成路径。人工仍需判断相关性与覆盖度。接口凭据只能通过 HTTPS 发送；服务禁止重定向，避免凭据被转发到不同地址。

**已验证的是模拟模型响应的适配器契约；未做真实提供商联调或模型质量评测。**启用真实模型会将基础脱敏后的工单及检索证据发送给所配置的提供商，界面会提示；基础格式隐藏不是完整隐私防护，应只用演示工单。

实现参考：[DeepSeek Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)、[JSON 输出说明](https://api-docs.deepseek.com/zh-cn/guides/json_mode/)，核对日期 2026-10-13。模型名称不固定写死，以实际账户权限为准。

## 结构

- `server.py`：仅本地 HTTP 服务、SQLite 持久化、审核状态机、来源与 CSRF 校验。
- `core.py`：地区判定、有效版本过滤、关键词检索、风险路由、证据约束、模型适配器。
- `web/`：中文工作台、历史工单、知识版本、审计、可编辑草稿与导出。
- `data/knowledge.json`：虚构政策及明确的有效/归档状态。
- `eval/cases.json`：31 条带独立期望路由、文档集合和关键事实的合成案例。
- `evaluate.py`、`eval_report.json`：可复现离线回归和实际结果。
- `tests/`：32 个工程测试，涵盖全部 7 个前端样例、持久化、审批、来源校验及模拟模型接口异常。
- `docs/PRD.md`：产品假设、范围、优先级、验收标准与验证计划。
- `docs/EVALUATION.md`：指标定义、实际结果、局限和下一步测试设计。

运行数据会生成在 `work/supportflow.sqlite3`；它是本地演示记录，不应作为源码打包提交。若需重置演示，请先停止服务，再将该文件移到备份目录，然后重启。源码 `.gitignore` 已排除运行数据、密钥文件与 Python 缓存。

## 产品边界

关键词召回可能遗漏同义词或误召回；风险正则仅覆盖列出的回归样例，并不是通用提示注入防护。9 份有效政策不构成完整知识库。没有线上监控、RBAC、真实工单集成、向量检索、客服发送渠道或资金操作。所有审核记录仅在本机保存，不构成企业不可篡改审计。
