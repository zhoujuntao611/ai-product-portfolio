# SupportFlow · 有依据、可审核的客服回复助手

SupportFlow 帮助客服把自己的政策资料转成可检查的回复草稿：**导入资料 → 按地区与版本检索 → 核对逐条依据 → 人工编辑审核 → 回收问题样例**。

本次在原有 v1 工单工作台、模型接口和 SQLite 审核流程上迭代，补齐知识维护、实际问题检索、证据检查与反馈闭环。产品重点是让客服知道“依据在哪里、适用于谁、还有什么没回答”。

范围说明：内置政策与固定问题集采用合成资料；支持导入授权脱敏资料，当前完成规则模式与模拟模型接口验证，真实模型效果及用户业务收益尚未测量。项目定位为本机产品作品验证，批准结果保存在本地。

2026-10-19 审阅迭代：统一常见地区表达及矛盾检测；区分退款申请窗口、审核与到账时效、导出生成与保留时长、API 速率与周期额度；修复同秒工单历史顺序。冻结本地 v2.0 后，同一套 26 条合成开发回归 **14/26 → 26/26**，118 项工程测试通过。问题、备选方案、选择理由与逐题证据见 [迭代记录](docs/ITERATION_EVIDENCE.md)，这些结果不代表真实模型准确率或用户业务收益。

## 启动

需要 Python 3.10 或更高版本，无须安装第三方依赖。在项目目录打开 PowerShell：

```powershell
python server.py
```

也可运行 `launch.ps1`。打开 [http://127.0.0.1:8765](http://127.0.0.1:8765)，按 Ctrl+C 停止。如默认端口被占用：

```powershell
python server.py --port 8775
```

## 用自己的资料完成一次流程

1. 打开“知识库与版本”，下载示例 JSON，或使用 [data/import-example.json](data/import-example.json)。填写来源、地区、版本、生效时间和完整政策条款，粘贴内容或选择 JSON 文件后点击“校验并导入”。缺失字段会显示具体位置，整批通过后才会保存。
2. 回到“工单工作台”，输入 5–4000 字问题并选择地区。默认规则模式按问题检索资料；草稿附 `[文档编号 §条目编号]` 引用，“检索证据”展示原文、版本、适用地区及每个问题的覆盖情况。
3. 资料不足时按提示补充地区或拆分问题；冲突、未覆盖和高影响操作进入澄清或人工处理路径。有据可答时，检查事实、条件与引用，再批准保存。
4. 可以先编辑并点击“保存编辑”，逐次保留修改。审核者可标记“来源不适用、遗漏条件、回答不完整、依据不支持回复、其他”，补充备注，再批准、转人工或退回。
5. 在“处理轨迹”导出问题样例 JSON，获得脱敏问题、原稿、修改稿、来源版本和审核原因，供整理下一轮固定问题集。草稿也可单独复制或导出带依据的 Markdown。
6. 政策变化后，在资料清单发布同编号的新版本，或停用旧资料。历史工单保留生成时的依据；待批准草稿必须重新生成，避免把更新前的政策带入审核结果。

资料格式与接口见 [知识维护指南](docs/KNOWLEDGE.md)。内置快速体验还覆盖发票、地区退款、导出限制、Webhook、越权请求和未知能力。

## 为什么这样设计

**知识先于回复。** 每份资料都有来源、地区、版本和有效期；每个编号仅使用最新版本，已停用、过期或未生效的资料退出当前检索。

**按问题找依据。** v1 使用关键词命中数排序、全局最多 4 份候选；v2 增加可维护的同义表达、逐问题拆分与 BM25 排序，并在生成前检查地区和政策冲突。保留轻量、可本地运行和可解释的实现，先用固定问题集比较收益，再决定是否需要向量服务。取舍详见 [检索改进说明](docs/RETRIEVAL.md)。

**引用与支持分开检查。** 每个事实条目验证原文、条目编号、版本、有效期和地区；同时检查多问题覆盖及常见入口、时间和数量问法。回复使用完整政策条款，保留限制条件。缺少支持时先澄清或转人工。

**审核成为改进输入。** 保存原稿与每次修改、处理原因和版本信息；导出保留审核判断，便于人工整理评测期望与错误分类。

## 验证与评测

```powershell
python -m unittest discover -s tests -v
python evaluate.py
python verification/review_regression.py
node --check web/app.js
```

Node 仅用于可选的前端语法检查，运行项目不需要 Node。评测口径和结果索引见 [EVALUATION.md](docs/EVALUATION.md)。

- 原有 31 条回归案例与历史结果继续保留在 [eval/cases.json](eval/cases.json)、[eval_report.json](eval_report.json)。
- 冻结原方案实现 [eval/baseline_v1_core.py](eval/baseline_v1_core.py)、知识 [eval/baseline_v1_knowledge.json](eval/baseline_v1_knowledge.json) 和 [原评测记录](eval/baseline_v1_report.json)，使对比可以复现。
- 新一轮固定问题集对照原方案与改进方案，逐题保存政策适用性、引用支持、澄清、转人工及失败原因；对比结果输出到 `eval/comparison_v2.json`。
- 工程测试覆盖政策导入/替换/停用、旧草稿拦截、人工编辑持久化、审核原因、样例脱敏导出、模型接口和 HTTP 校验。

## 可选真实模型

沿用兼容 `POST /chat/completions`、JSON object 输出的 HTTPS 接口。配置只从服务端环境变量读取。

在当前 PowerShell 会话中设置以下变量再启动。隐藏输入可避免密钥进入命令历史：

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

模型从检索候选的既有条目中选择编号，本地按原文组装草稿并检查证据支持。无密钥时使用规则模式；未知编号、非候选条目、格式异常、截断、空证据和超时都有明确处理。启用真实模型会将基础脱敏后的问题及候选资料发送到配置的服务商，需使用合成或授权脱敏资料。

## 代码与产品材料

- [server.py](server.py)：本地 HTTP 接口、SQLite、编辑审核状态与问题样例导出。
- [knowledge.py](knowledge.py)：资料校验、原子写入、版本替换、停用与有效期快照。
- [core.py](core.py)、[检索配置](data/retrieval_config.json)：同义表达、逐问题检索、政策适用、证据检查与原模型适配器。
- [web/](web/)：中文工作台、知识导入和版本维护、证据、审核与处理轨迹。
- [PRD](docs/PRD.md)：问题定义、迭代取舍、状态、验收标准与验证计划。
- [知识维护指南](docs/KNOWLEDGE.md)、[检索说明](docs/RETRIEVAL.md)、[评测说明](docs/EVALUATION.md)：使用规范、方案对比与可复核验收。

运行数据分别保存在 `work/supportflow.sqlite3` 和 `work/knowledge.json`；种子资料 `data/knowledge.json` 保持独立。若需重置，请停止服务后备份这两个运行文件，再重新启动。运行数据、密钥与缓存已由仓库忽略配置排除。
