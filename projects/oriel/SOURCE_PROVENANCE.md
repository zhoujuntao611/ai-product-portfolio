# 源码来源与同步范围

同步日期：2026-10-26。

- 来源仓库：[pico-harness](https://gitee.com/htxoffical/pico-harness)
- 来源分支：`release/maintainer-profile`
- 固定提交：`afdd62099b900a3c046dd96396268b7a8403d9c4`
- GitHub 副本：[source/](source/)，完整导出该提交受版本管理的 **1,197 个文件**，不修改源码字节。
- 校验：[SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) 记录每个文件的路径、原 Git Blob、文件模式、字节数与 SHA-256。

此副本包含 Runtime、维护流程、PicoBench、测试、文档、TUI、依赖锁与构建输入。它是固定提交的源码快照，不是完整 Git 历史，也不代表跟随来源仓库自动更新。原始作者记录仍在来源仓库，副本保留文件内署名、包元信息、LICENSE、NOTICES 及 LICENSES。

导出不读取本机的未跟踪文件，因此不包含开发账号、私有配置、模型凭据、运行中的会话、虚拟环境或 `.pico` 原始运行凭证。构建输出按源码说明在本地生成；可选外部记忆实现未包含在该发布源树中。

## 责任与许可

周俊涛负责的项目工作包括 Oriel 产品流程、Pico Runtime 和 PicoBench 的设计实现，开发采用 AI 编程协作。此职责说明与开源组件来源分别记录。

[NOTICES.md](source/NOTICES.md) 说明 Pico 基于 nanobot，并包含 hermes-agent / ink 相关组件；适用条款见 [LICENSE](source/LICENSE) 及 [LICENSES](source/LICENSES/)。本次同步不重写其作者字段、版权、包名或第三方声明。其他基础组件与依赖不计为个人原创。

## 验证副本

在作品仓库根目录执行：

```sh
python scripts/check-oriel-source.py
```

检查全部文件的 SHA-256、字节数、Git Blob 及关键文件完整性。快照内的原始文档保持原样，可能保留 Gitee 链接或原发布安装入口；新增 [运行说明](RUNNING.md) 以 GitHub 本地源码安装为准，便于直接复现。
