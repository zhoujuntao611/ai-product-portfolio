# ClimbAI —— AI 攀岩训练助手

面向室内抱石初阶成年用户的 ToC AI Coach 产品作品。根据个人目标、可用时间与训练反馈，建立带证据的画像、生成计划、记录训练并确认下一次安排。

**[在线体验](https://zhoujuntao611.github.io/ai-product-portfolio/climbai/)** · [个人主页](https://zhoujuntao611.github.io/ai-product-portfolio/) · [产品案例](docs/CASE_STUDY.md) · [完整 PRD](docs/PRD.md) · [验证记录](docs/VALIDATION.md)

## 产品能力

- 共享知识库 demo-kb-1.1：30 个知识条目、7 个官方参考页面；浏览器演示与后端读取同一份内容，支持主题入口、来源与适用条件查看。
- 八个产品视图：今日、建档目标、能力画像、周计划、训练记录、反馈报告、知识助手、个人历史。
- 画像分开呈现事实、自评、假设和证据充分度，支持纠正。
- 一周计划及当次训练卡，展示时长、理由、来源、步骤和停止条件。
- 结束训练先保存完成事件，反馈可随后补交。
- 展示计划修改与依据，支持接受调整或保持计划，保留版本。
- 疼痛反馈立即暂停相关推荐；知识不足时说明不足。
- 历史、运行追踪、JSON 导出、删除与样例重置。

在线版本使用浏览器本地数据和明确标识的规则示例。Python 后端支持 LangGraph 工作流、SQLite 持久化、Chroma 本地检索和可配置 LLM API。GitHub Pages 承载前端，不运行 Python。

## 交付范围

项目于 2026 年 10 月通过 AI 协作制作。默认演示没有调用真实模型，也没有采集真实用户训练数据。示例练习和知识库由开发者整理，专业教练审核待完成；示例时长用于展示产品约束，不作为效果已验证的训练处方。

工程和浏览器测试只验证已列出的系统行为。真实模型业务质量、真人访谈、用户试用、训练效果和云端 Figma 文件尚待完成。具体执行结果见 [VALIDATION](docs/VALIDATION.md)，不使用计划中的目标冒充实测成绩。

## 运行前端

需要 Node.js 22+。

```bash
npm ci
npm run dev
```

打开终端显示的本地网址，默认 `http://127.0.0.1:5173`。可以使用自己的档案或明确的模拟样例。数据只保存在当前浏览器。

```bash
npm run build
npm run preview
```

构建结果在 `dist/`，资源使用相对路径，适用于 GitHub Pages 子目录。

## 运行完整后端

推荐 Python 3.11，固定的本地检索依赖支持 Python 3.11 / 3.12。在项目根目录创建虚拟环境并安装依赖：

```bash
python -m venv .venv
```

Windows：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

macOS / Linux：

```bash
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

前端已经构建时，后端同时提供 `http://127.0.0.1:8000/`。前端的连接设置填入后端地址；API 文档为 `http://127.0.0.1:8000/docs`。后端和浏览器本地演示分别保存数据，连接模式切换不自动上传本地记录。

匿名会话 ID 由前端生成并随请求传递，后端按会话隔离。这是 Demo 身份方案，不是公开生产服务的完整账号认证；默认仅绑定本机，不应直接暴露到公网。

## 配置真实模型

将 `.env.example` 复制为 `.env`，仅在自己的服务端填写：

```dotenv
CLIMBAI_PROVIDER=llm
CLIMBAI_API_KEY=your_server_side_key
CLIMBAI_MODEL=your_selected_model
CLIMBAI_API_BASE=https://api.openai.com/v1
CLIMBAI_API_MODE=responses
```

兼容 Chat Completions 的服务可将模式改为 `chat`，并设置对应 base URL 和模型。所选模型需要支持规定的结构化输出；不同供应商的兼容性需要实测。密钥不进入前端、导出或 Git。

适配实现参考 [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs/)。本项目没有用真实供应商调用证明训练建议质量；协议模拟与真实效果分别记录。

知识索引采用本地字符 n-gram 哈希向量，是透明的检索 Demo，不是经过评测的模型语义 embedding。检索证据和练习 ID 都经过业务校验；真实嵌入与更多知识可在后续版本引入。

## 架构

```text
React + TypeScript + Vite
  ├─ Local provider：浏览器持久化演示
  └─ API provider：FastAPI
       ├─ 画像 / 检索 / 规划 / 反馈工作流
       ├─ LLM adapter：结构化输出、有限修复与显式失败
       ├─ Chroma：示例知识索引
       └─ SQLite：记录、画像、计划与运行版本
```

具体职责、接口和数据边界见 [架构说明](docs/ARCHITECTURE.md)。

## 验证

```bash
python -m pytest tests/backend -q
npm run build
```

Windows 请将 `python` 替换成 `.\.venv\Scripts\python.exe`，或先激活虚拟环境。浏览器检查脚本在 `scripts/browser-qa.mjs`；依赖 Playwright 和可用浏览器，详细执行方式及实际结果见验证记录。

## 作品集材料

- [产品案例与取舍](docs/CASE_STUDY.md)
- [完整产品规划与 PRD](docs/PRD.md)
- [八页与关键流程](docs/FLOWS.md)
- [架构与 API](docs/ARCHITECTURE.md)
- [知识来源及边界](docs/KNOWLEDGE.md)
- [逐源核验记录](docs/SOURCES.md)
- [微信小程序迁移建议](docs/MINIPROGRAM.md)
- [真实工程验证与未完成验证](docs/VALIDATION.md)
- [访谈、对照与试用计划](docs/RESEARCH_PLAN.md)
- [简历表达与演示脚本](docs/PORTFOLIO.md)
- [立项交互方案画布](docs/planning-canvas.html)

代码采用 MIT 许可。外部参考资料保留来源与相应权利，不包含未经许可的长篇原文、真实训练数据、运行中数据库或凭据。
