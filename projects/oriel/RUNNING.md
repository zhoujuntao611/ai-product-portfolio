# 从 GitHub 源码安装与验证

当前维护执行器调用 `/bin/sh`，完整修复流程请使用 Linux、macOS 或 WSL 内的 Linux 环境。Python 版本为 **3.12**；默认 TUI 构建需要 **Node.js 22**。原生 Windows 不等价于已支持完整维护执行器。

## 获取源码

```sh
git clone https://github.com/zhoujuntao611/ai-product-portfolio.git
cd ai-product-portfolio
python scripts/check-oriel-source.py
cd projects/oriel/source
uv sync --frozen --extra dev --dev
```

`uv` 需要事先安装。安装依赖会访问包源，但下面的维护流程测试不需要真实模型、飞书账号、Gitee Token 或 Docker。

当前 `source/` 包含 2026-10-27 迭代，并非上游基线的原样副本；当前提交与逐文件来源见 [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json)，变更见 [SOURCE_CHANGES.json](SOURCE_CHANGES.json)。

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

测试产生的是临时仓库中的合成修复任务，不代表已在真实社区修复 Issue。最新执行状态见作品仓库 [Actions](https://github.com/zhoujuntao611/ai-product-portfolio/actions/workflows/verify.yml)。

## 学习与无需账号的演示

先读[技术栈学习指南](source/docs/onboarding/oriel-tech-stack.zh-CN.md)，再看[本轮迭代说明](source/docs/onboarding/maintenance-regression.zh-CN.md)。演示在各自的临时 Git 仓库执行五种确定性场景，保留候选包与退出码，不调用真实模型：

```sh
uv run --frozen --extra dev python scripts/demo_maintenance_regression.py
```

输出位于当前源码目录下 `.pico/evidence/maintenance-regression/run-*/`。正确修复的回归退出码为 Baseline `1`、Repair `0`、Verifier `0`；其他情景演示未复现、执行异常、修复无效与干净重放失败的拒绝路径。

原生 Windows 可运行这份演示的固定 Python 命令适配器，但它不支持任意 shell，也不改变生产 Runner 的 POSIX shell 要求。[平台范围与本机验证](source/docs/onboarding/maintenance-regression.zh-CN.md)

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

按 [飞书接入与维护模式](source/docs/onboarding/feishu.zh-CN.md) 配置自己的应用、模型、群、维护者、目标仓库和验收命令，再启动 Gateway。可选 `maintenance.regressionCommands` 要求固定检查在基线退出 `1`、修复和独立验证退出 `0`，仍须通过原验收；不能把任意异常退出当作目标缺陷复现。文档中的仓库名和路径是示例，需要替换为自己的目标。Gateway、修复 Runner 与 Issue Token 分开配置，凭据留在本机私有文件中。

真实维护模式涉及独立修复执行与验证容器；BoxLite 配置示例面向 Apple Silicon Mac，其他环境的隔离后端应按源码说明单独确认。不要将无容器的临时仓库测试误写为生产隔离部署已经验收。

## 评测

先运行无需付费模型的 PicoBench 检查：

```sh
make picobench-smoke
```

[PicoBench 说明](source/benchmarks/picobench/README.md) 包含各 Track、付费执行开关、预算与离线重建步骤。本次同步源码没有重新执行付费模型实验；公开源码中的历史摘要不能替代未公开的原始运行凭证。[指标范围](EVIDENCE.md)
