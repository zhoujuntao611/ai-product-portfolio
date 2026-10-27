# 源码来源与同步范围

更新日期：2026-10-27。当前副本包含上游维护者基线及本轮后续开发，二者分别记录。

- 来源仓库：[pico-harness](https://gitee.com/htxoffical/pico-harness)
- 上游基线分支：`release/maintainer-profile`
- 上游基线提交：`afdd62099b900a3c046dd96396268b7a8403d9c4`
- 基线清单：[SOURCE_BASELINE_MANIFEST.json](SOURCE_BASELINE_MANIFEST.json) 保留首次导出的 **1,197 个文件**及原始校验信息。
- 当前 GitHub 副本：[source/](source/)，在该基线上包含 2026-10-27 维护回归验收、源码一致性检查、事务清理、测试、学习指南与演示等变更。
- 当前清单：[SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) 使用 schema 2，记录上游基线与 `development_commit`，并将 `source_modified` 标为 `true`；文件记录用于校验当前源码的路径、Git Blob、文件模式、字节数与 SHA-256。
- 变更归属：[SOURCE_CHANGES.json](SOURCE_CHANGES.json)列出基线到当前版本的变化，当前开发提交以清单记录为准。

此副本包含 Runtime、维护流程、PicoBench、测试、文档、TUI、依赖锁与构建输入，按清单标识版本维护。完整 Git 历史与原始作者记录见来源仓库；副本保留文件内署名、包元信息、LICENSE、NOTICES 及 LICENSES。

导出依据受版本管理的文件清单，构建产物按源码说明在本地生成。应用账号与凭据由运行者配置，记忆后端可按接口选配。

## 责任与许可

周俊涛负责 Oriel 产品流程、Pico Runtime 和 PicoBench 的设计实现。

[NOTICES.md](source/NOTICES.md)说明 Pico 基于 nanobot，并包含 hermes-agent / ink 相关组件；适用条款见 [LICENSE](source/LICENSE)及 [LICENSES](source/LICENSES/)。副本保留原作者字段、版权、包名和第三方声明。

## 验证副本

在作品仓库根目录执行：

```sh
python scripts/check-oriel-source.py
```

脚本核对当前源码、基线与变更清单，检查路径、Git Blob、文件模式和内容哈希的一致性。安装步骤见本项目[运行说明](RUNNING.md)。

维护能力见[回归验收迭代](source/docs/onboarding/maintenance-regression.zh-CN.md)，技术实现见[源码学习指南](source/docs/onboarding/oriel-tech-stack.zh-CN.md)，实验条件与结果见[验证记录](EVIDENCE.md)。
