# 验证记录

验证日期：2026-10-14，Asia/Shanghai。全部使用合成档案和模拟训练，不包含真实参与者成效。

## 已执行：后端工程回归

**35 项测试通过，0 失败。** 场景与结果见 [backend-qa.json](../verification/backend-qa.json)。

覆盖匿名工作区隔离、成年确认、时间和器材约束、知识 ID、独立完成与反馈、重复请求、接受 / 保持、旧版本冲突、历史持久化、导出与删除、不适暂停、模型协议模拟和失败回滚。

0 分钟记录为跳过，使用 `training_skipped`；不计入已完成训练，后续调整和暂停保留终态。原始完成事件不能被反馈草案覆盖。

单元测试显式使用本地备用检索以隔离业务逻辑。另行实际启动了默认 Chroma 索引，健康检查及查询成功，重启后查询仍正常：`provider=demo`、`orchestrator=langgraph`、`retrieval_backend=chroma_hash_demo`、`index_status=ready`。

## 已执行：浏览器检查

使用本机 Microsoft Edge / Playwright 实际点击界面。桌面 1440px 和手机 375px 基线 29 个检查通过，最终版本另有 3 个定向浏览器检查、1 个直接 HTTP 跳过训练回归通过，共 **33/33（32 个浏览器场景 + 1 个 HTTP 场景），0 未捕获 JavaScript 异常**。构建版本与逐条结果见 [browser-qa.json](../verification/browser-qa.json)。

覆盖建档、计划确认、结束训练先独立保存、反馈接受 / 保持、来源展示和库外资料不足、JSON 导出、暂停、重载、删除、八页布局、连接失败恢复以及真实 FastAPI 联动。API 修改档案、同 ID 多版本历史与原训练记录保留均已检查。

这里的分母是工程场景，包含布局和错误状态，不是用户、训练次数或真实模型任务。截图使用内置“小林”模拟案例，样例与测试档案分开；截图不代表真人训练。

## 构建与依赖

- TypeScript 检查和 Vite 构建通过。
- Python 依赖一致性检查通过。
- npm 官方 registry 安全审计在本次执行中报告 0 已知漏洞；这不等同于完整安全审计。
- 本机发现新版原生检索依赖启动崩溃，已固定 Chroma 0.6.3、ONNX Runtime 1.20.1、NumPy 1.26.4 和兼容遥测依赖。问题复现与最终结果保留在后端报告。
- 原生索引运行在独立 worker 中，故障会明确降级并显示实际检索状态，避免杀死 API。哈希向量属于检索演示，不是模型语义 embedding。

## 尚未完成的效果验证

- 真实供应商模型业务质量：真实付费模型调用数为 0，现有适配检查使用模拟响应。
- 真实用户访谈、8 人试用、满意度和留存：未执行，不存在采纳率或效率提升结果。
- 专业教练逐条审核：待完成，示例库不称为认证训练方案。
- 攀爬水平提升、伤病预防和效果因果关系：未验证。
- 云端 Figma 文件：未创建；页面规格及可交互实现见产品与流程文档。

后续研究方法、建议目标和分母见 [RESEARCH_PLAN](RESEARCH_PLAN.md) 与 [PRD](PRD.md)。不要将这些计划目标写成已获得成果。

## 复验方式

安装依赖后在项目根目录运行：

```bash
python -m pytest tests/backend -q
npm run build
```

启动预览与本地 API，再运行浏览器脚本：

```bash
npm run preview -- --port 4173
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
node scripts/browser-qa.mjs --url http://127.0.0.1:4173/ --api http://127.0.0.1:8000
```

请在不同终端启动两个服务，Python 使用虚拟环境。浏览器检查需要 Playwright；可以运行 `npm install --no-save playwright` 与 `npx playwright install chromium` 安装开发工具，或通过 `PLAYWRIGHT_MODULE` 指定已有模块路径，并通过 `QA_BROWSER_PATH` 指定 Chromium 浏览器。日志记录实际运行时间与场景结果；模拟数据下载位于忽略的 `verification/downloads/`。
