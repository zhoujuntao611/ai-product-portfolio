# 源码来源与同步范围

更新日期：2026-10-27。当前副本包含上游维护者基线及本轮后续开发，二者分别记录。

- 来源仓库：[pico-harness](https://gitee.com/htxoffical/pico-harness)
- 上游基线分支：`release/maintainer-profile`
- 上游基线提交：`afdd62099b900a3c046dd96396268b7a8403d9c4`
- 基线清单：[SOURCE_BASELINE_MANIFEST.json](SOURCE_BASELINE_MANIFEST.json) 保留首次导出的 **1,197 个文件**及原始校验信息。
- 当前 GitHub 副本：[source/](source/)，在该基线上包含 2026-10-27 维护回归验收、事务清理、测试、学习指南与演示等变更，不再声明与上游基线逐字节相同。
- 当前清单：[SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) 使用 schema 2，记录上游基线与 `development_commit`，并将 `source_modified` 标为 `true`；文件记录用于校验当前源码的路径、Git Blob、文件模式、字节数与 SHA-256。
- 变更归属：[SOURCE_CHANGES.json](SOURCE_CHANGES.json) 列出基线到当前版本的变化。当前开发提交以清单记录为准，不把后续改动归入上游原始 SHA。

此副本包含 Runtime、维护流程、PicoBench、测试、文档、TUI、依赖锁与构建输入。它是清单所标识版本的源码导出，不是完整 Git 历史，也不代表跟随来源仓库自动更新。原始作者记录仍在来源仓库，副本保留文件内署名、包元信息、LICENSE、NOTICES 及 LICENSES。

导出不读取本机的未跟踪文件，因此不包含开发账号、私有配置、模型凭据、运行中的会话、虚拟环境或 `.pico` 原始运行凭证。构建输出按源码说明在本地生成；可选外部记忆实现未包含在该发布源树中。

## 责任与许可

周俊涛负责的项目工作包括 Oriel 产品流程、Pico Runtime 和 PicoBench 的设计实现，开发采用 AI 编程协作。此职责说明与开源组件来源分别记录。

[NOTICES.md](source/NOTICES.md) 说明 Pico 基于 nanobot，并包含 hermes-agent / ink 相关组件；适用条款见 [LICENSE](source/LICENSE) 及 [LICENSES](source/LICENSES/)。本次同步不重写其作者字段、版权、包名或第三方声明。其他基础组件与依赖不计为个人原创。

## 验证副本

在作品仓库根目录执行：

```sh
python scripts/check-oriel-source.py
```

当前源码、基线与变更清单应一起核对；脚本结果只说明源码与记录的一致性，不代表真实模型、渠道、隔离部署或修复效果已经验收。原始文档仍可能保留 Gitee 链接或原发布安装入口；以本项目 [运行说明](RUNNING.md) 的 GitHub 本地安装步骤为准。

本轮功能和限制见[维护回归迭代说明](source/docs/onboarding/maintenance-regression.zh-CN.md)，整体技术学习见[源码学习指南](source/docs/onboarding/oriel-tech-stack.zh-CN.md)。本轮没有重新执行历史付费模型实验，也没有从源码完整性检查推导线上业务效果。
