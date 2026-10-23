# 运行、验证与维护

本仓库包含三个主项目和一个保留的早期原型。各项目有独立依赖，根目录的 Node.js 依赖仅用于检查个人主页；安装它们不会安装全部项目或连接模型服务。

## 从哪里体验

- SupportFlow：[运行说明](../projects/supportflow/README.md)。默认规则模式，只需 Python 3.10+。
- 攀迹：[运行说明](../projects/panji/README.md)。先做 Node.js 本地检查；手机预览需微信开发者工具及自己的小程序账号，云端能力需自己的环境。
- MetricPilot：[运行说明](../projects/metricpilot/README.md)。Python 本机应用，支持导入 CSV。
- ClimbAI：[早期浏览器演示](https://zhoujuntao611.github.io/ai-product-portfolio/climbai/)无需安装；[完整运行说明](../projects/climbai/README.md)分别介绍前端与后端。

Windows 下根目录的 `start-projects.cmd` 启动 SupportFlow 和 MetricPilot；`stop-projects.cmd` 关闭启动器创建的服务。这个入口不启动微信小程序或 ClimbAI 后端。

其他系统可以在两个终端、仓库根目录分别执行：

```sh
python projects/supportflow/server.py
python projects/metricpilot/app.py
```

本机地址分别为 `http://127.0.0.1:8765`、`http://127.0.0.1:8766`。GitHub Pages 只提供静态网页，不运行 Python 后端。

## 项目检查

以下命令分别在所示项目目录运行。它们使用合成数据或模拟服务，不要求模型密钥，不验证真实用户效果。评测脚本会更新本地报告及耗时，检查完成后先审阅差异，不将无关时间戳重新提交。

SupportFlow，目录 `projects/supportflow`：

```sh
python -m unittest discover -s tests -v
python evaluate.py
python verification/review_regression.py
```

MetricPilot，目录 `projects/metricpilot`：

```sh
python evaluate.py
python evaluate_tasks.py
python verification/replay_20261019.py
```

攀迹，目录 `projects/panji`，需要 Node.js 22+：

```sh
npm ci
npm run verify
```

ClimbAI，目录 `projects/climbai`，建议 Python 3.11 虚拟环境及 Node.js 22+。先创建并激活自己的虚拟环境，再执行：

```sh
python -m pip install -r requirements.txt
python -m pytest tests/backend -q
python -m backend.evaluate_knowledge --output verification/knowledge-retrieval-ci.json
npm ci
npm run build
```

历史范围分别记录在 [SupportFlow 迭代](../projects/supportflow/docs/ITERATION_EVIDENCE.md)、[MetricPilot 迭代](../projects/metricpilot/docs/ITERATION-20261019.md)、[攀迹公开副本说明](../projects/panji/docs/EVIDENCE.md)和 [ClimbAI 验证](../projects/climbai/docs/VALIDATION.md)。最新执行是否成功以 [Actions](https://github.com/zhoujuntao611/ai-product-portfolio/actions/workflows/verify.yml) 为准，不将相互重叠的场景数量相加。

## 个人主页与文档检查

在仓库根目录，使用 Node.js 22+、Python 3.10+：

```sh
npm ci
npx playwright install chromium
npm run verify:site
```

Linux 若缺少浏览器系统依赖，使用 `npx playwright install --with-deps chromium`。本机也可以通过 `QA_BROWSER_PATH` 指定已有 Chromium 系浏览器的可执行文件；脚本默认使用 Playwright 安装的浏览器，不包含作者电脑路径。

- `npm run check:links`：离线检查 Git 跟踪及未忽略新文档的行内 Markdown 本地文件链接、静态 HTML 文件／锚点及指向本仓库主分支的源码链接。校验路径大小写；不访问外部 URL、不验证 Markdown 标题锚点。
- `npm run check:site`：临时启动只绑定本机的静态服务，使用 `/ai-product-portfolio/` 路径模拟 Pages。检查首页与三个案例页的 320／390／768／1440 宽度、图片、字体、页内锚点、脚本与资源错误、首屏项目入口、键盘展开验证记录，以及无 JavaScript 时从首页进入案例并返回的完整路径，并运行 ClimbAI 的本地知识问答冒烟检查。
- 报告和截图写入被忽略的 `verification/site-current/`；GitHub Actions 上传检查产物，保留 14 天。截图供审阅，不使用跨平台逐像素基线，也不代表审美或用户效果已达标。

检查只访问本地网页，不调用模型或用户数据库。新增页面后应同步扩展检查范围。

## 防止演示源码与发布文件分叉

ClimbAI 前端源码位于 `projects/climbai/web`，构建输出为 `projects/climbai/dist`，Pages 使用已提交的 `docs/climbai`。

先在 ClimbAI 目录完成 `npm ci` 与 `npm run build`，再回到根目录执行：

```sh
npm run check:climbai-build
```

检查逐文件名和 SHA-256 比对两份产物。若有差异，审阅构建结果后同步到 `docs/climbai`，同时处理已经失效的旧哈希资源，并重新检查。脚本只报告差异，不自动删除或覆盖文件。Windows 和 Linux 工程 CI 都运行此检查。

主页源码为 `docs/index.html`、`docs/style.css`；三个案例分别位于 `docs/panji`、`docs/supportflow`、`docs/metricpilot`，共用 `docs/case.css`。首页和案例采用静态 HTML，阅读与导航不依赖 JavaScript；ClimbAI 仍使用其独立应用。若改字体或文案，注意[本地字体子集说明](assets/fonts/README.md)。

## 维护约定

- 攀岩方向以攀迹为主，ClimbAI 保留复现与兼容性维护，详见[项目演进](CLIMBING_EVOLUTION.md)。不合并用户数据或重新包装为两个独立主成果。
- 发布前确认工程与网页检查通过，记录对应提交和截图日期。GitHub Pages 的发布成功与工程检查通过是不同状态，当前 Pages 发布没有以工程检查为强制前置条件。
- 历史记录保留日期、范围及失败案例。模型实验见[原始实测索引](LIVE_PRACTICE_20261019.md)，需要自己的服务端配置，普通检查不执行这些脚本。
- 不上传账号配置、密钥、真实记录或过期预览码。代码和第三方数据许可分别遵循各项目说明，本次没有改变授权范围。
