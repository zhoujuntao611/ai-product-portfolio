# 运行、验证与维护

网站展示四个项目：攀迹、Oriel、SupportFlow 和 MetricPilot。项目依赖独立，主页只需静态服务。GitHub Pages 不运行 Python 后端。

## 启动应用

Windows 下使用根目录的 `start-projects.cmd` 启动 SupportFlow 和 MetricPilot，`stop-projects.cmd` 关闭启动器创建的服务。也可在两个终端、仓库根目录分别执行：

```sh
python projects/supportflow/server.py
python projects/metricpilot/app.py
```

本机地址分别为 `http://127.0.0.1:8765`、`http://127.0.0.1:8766`。默认模式只需 Python，不要求模型密钥。更多选项见 [SupportFlow 说明](../projects/supportflow/README.md)和 [MetricPilot 说明](../projects/metricpilot/README.md)。

攀迹需要微信开发者工具及自己的小程序账号；云端功能需要自己的环境。运行与部署方式见 [攀迹说明](../projects/panji/README.md)。当前未公开发布。

Oriel 的完整源码、维护工作流和 Python 3.12 安装步骤见 [Oriel 运行说明](../projects/oriel/RUNNING.md)。维护执行器需要 Linux、macOS 或 WSL，不能直接等同于原生 Windows 支持。

## 工程检查

这些检查使用合成数据或模拟服务，不调用真实模型，也不验证用户效果。部分脚本更新本地报告及耗时，提交前应审阅差异，不将无关时间戳重新提交。

在 `projects/supportflow`：

```sh
python -m unittest discover -s tests -v
python evaluate.py
python verification/review_regression.py
```

在 `projects/metricpilot`：

```sh
python evaluate.py
python evaluate_tasks.py
python verification/replay_20261019.py
```

在 `projects/panji`，需要 Node.js 22+：

```sh
npm ci
npm run verify
```

历史范围见 [SupportFlow 开发记录](../projects/supportflow/docs/ITERATION_EVIDENCE.md)、[MetricPilot 修改记录](../projects/metricpilot/docs/ITERATION-20261019.md)和 [攀迹验证说明](../projects/panji/docs/EVIDENCE.md)。最新执行结果以 [Actions](https://github.com/zhoujuntao611/ai-product-portfolio/actions/workflows/verify.yml) 为准。

## 网页与界面检查

在仓库根目录，需要 Node.js 22+、Python 3.10+：

```sh
npm ci
npx playwright install chromium
npm run verify:site
npm run check:workspaces
```

Linux 若缺少系统依赖，执行 `npx playwright install --with-deps chromium`。可以通过 `QA_BROWSER_PATH` 指定已有 Chromium 系浏览器；脚本不含作者电脑路径。

- `check:oriel` 校验 1,197 个固定源码文件的字节、Git Blob、执行模式及许可完整性。
- `check:links` 检查作品文档、页面、锚点和本仓库源码链接，包含路径大小写；不请求外部网址。固定上游快照内的原始文档保持原样，由源码校验单独保护；作品页指向快照的链接仍检查。
- `check:site` 在 Pages 项目路径下检查首页和四个项目页的 320／390／768／1440 宽度、图片、字体、阅读目录、截图放大、界面预览的键盘切换和无 JavaScript 阅读。另检查两个已撤下的旧路径能够跳转到攀迹。
- `check:workspaces` 启动两个本地应用，使用临时数据库和合成数据，检查工单审核、政策版本、导出、CSV 导入和分析条件冲突。退出时关闭服务并清理临时数据。

报告和截图位于被忽略的 `verification/site-current/` 与 `verification/workspaces-current/`；Actions 保留产物 14 天。需要刷新发布截图时执行 `node scripts/check-workspaces.mjs --update-previews`。普通检查不会覆盖网站截图。

## 发布内容

主页使用 `docs/index.html`、`docs/style.css` 和 `docs/home.css`；四个项目页位于 `docs/panji`、`docs/oriel`、`docs/supportflow` 和 `docs/metricpilot`，共享 `docs/case.css`。

`reading.js` 提示阅读位置，`interaction.js` 提供截图放大、原尺寸查看和适应窗口切换，`preview.js` 切换真实应用截图。原尺寸下可以滚动查看细节。无 JavaScript 时，正文、原图链接和全部界面截图仍可阅读。应用运行依赖与网站预览分开说明，按钮不伪装为在线应用入口。

ClimbAI 已撤下公开介绍和浏览器演示。两个旧网址只负责跳转到攀迹，静态演示资源已移除；源码与历史实验保留，不自动合并到攀迹。ClimbAI 的独立构建和后端检查仍验证归档源码，运行方式见 [原项目说明](../projects/climbai/README.md)。

修改文案时同步 [项目介绍全文](PROJECT_NOTES.md)，并按 [字体说明](assets/fonts/README.md)更新自托管字体子集。历史实验报告保留原内容。发布前完成工程和网页检查，部署后确认正式页面与提交一致。
