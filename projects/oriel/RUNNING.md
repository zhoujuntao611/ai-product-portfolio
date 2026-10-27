# 从 GitHub 源码安装与验证

完整维护执行器使用 `/bin/sh`，请在 Linux、macOS 或 WSL 内的 Linux 环境运行。Python 版本为 **3.12**；默认 TUI 构建需要 **Node.js 22**。

## 获取源码

```sh
git clone https://github.com/zhoujuntao611/ai-product-portfolio.git
cd ai-product-portfolio
python scripts/check-oriel-source.py
cd projects/oriel/source
uv sync --frozen --extra dev --dev
```

`uv` 需要事先安装。安装依赖会访问包源，但下面的维护流程测试不需要真实模型、飞书账号、Gitee Token 或 Docker。

当前 `source/` 基于维护者分支继续开发，包含 2026-10-27 三阶段回归门禁、源码一致性检查与事务清理。当前提交与逐文件来源见 [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json)，变更见 [SOURCE_CHANGES.json](SOURCE_CHANGES.json)。

## 先验证修复与独立验收

```sh
uv run --frozen --extra dev pytest \
  tests/test_maintenance.py::test_runner_replays_patch_and_writes_candidate_packet \
  tests/test_maintenance.py::test_runner_keeps_patch_but_fails_closed_when_clean_verifier_fails \
  -q
```

第一项在临时 Git 仓库验证补丁重放与候选包；第二项检查干净验证失败时不会交付成功候选。维护模块完整测试：

```sh
uv run --frozen --extra dev pytest \
  tests/test_maintenance.py \
  tests/test_maintenance_regression.py \
  tests/test_maintenance_store_transactions.py -q
```

测试在临时 Git 仓库构造修复任务，检查补丁、退出码与候选包。最新执行状态见作品仓库 [Actions](https://github.com/zhoujuntao611/ai-product-portfolio/actions/workflows/verify.yml)。

## 学习与无需账号的演示

先读[技术栈学习指南](source/docs/onboarding/oriel-tech-stack.zh-CN.md)，再看[维护验收迭代](source/docs/onboarding/maintenance-regression.zh-CN.md)。演示在各自的临时 Git 仓库执行五种确定性场景，保留候选包与退出码：

```sh
uv run --frozen --extra dev python scripts/demo_maintenance_regression.py
```

输出位于当前源码目录下 `.pico/evidence/maintenance-regression/run-*/`。正确修复的回归退出码为 Baseline `1`、Repair `0`、Verifier `0`；其他情景演示未复现、执行异常、修复无效与干净重放失败的拒绝路径。

原生 Windows 可使用演示提供的固定 Python 命令适配器，完整 Runner 按上文在 POSIX shell 环境运行。[平台配置与本机验证](source/docs/onboarding/maintenance-regression.zh-CN.md)

## 本地交互与飞书配置

默认 TUI 使用源码构建：

```sh
npm ci
npm ci --prefix ui-tui
npm run build --prefix ui-tui
uv run pico onboard
```

飞书接入另需对应依赖：

```sh
uv sync --frozen --extra dev --extra channel-feishu --dev
```

按[飞书接入与维护模式](source/docs/onboarding/feishu.zh-CN.md)配置自己的应用、模型、群、维护者、目标仓库和验收命令，再启动 Gateway。可选 `maintenance.regressionCommands` 的退出码约定与日志复核步骤见[完整流程](WORKFLOW.md)。将示例仓库名和路径替换为自己的目标；Gateway、修复 Runner 与 Issue Token 分开配置，凭据留在本机私有文件中。

维护模式按目标环境配置隔离执行后端；BoxLite 示例面向 Apple Silicon Mac，其他环境按源码说明配置相应后端。

## 评测

先运行无需付费模型的 PicoBench 检查：

```sh
make picobench-smoke
```

[PicoBench 说明](source/benchmarks/picobench/README.md)包含各 Track、付费执行开关、预算与离线重建步骤。实验条件、结果与资料来源见[实验与验证记录](EVIDENCE.md)。
