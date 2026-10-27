# 文件导览

完整源码位于 [source/](source/)，包名沿用 Pico，避免破坏导入、构建和原有文档。

- [pico/maintenance/](source/pico/maintenance/)：`/issue`、`/fix`、任务持久化、修复、独立验证与候选包。
- [本轮迭代说明](source/docs/onboarding/maintenance-regression.zh-CN.md)：2026-10-27 可选三阶段回归、候选包 v2 与 SQLite 冲突回滚。
- [技术栈学习指南](source/docs/onboarding/oriel-tech-stack.zh-CN.md)：结合源码学习 Runtime、工具、上下文、TUI、存储与评测，附七天练习和面试问题。
- [离线演示](source/scripts/demo_maintenance_regression.py)：无需账号的五种确定性维护场景，使用真实 Git 与本地检查。
- [pico/spine/](source/pico/spine/)：Turn、会话 Lane 与多入口调度。
- [pico/agent/](source/pico/agent/)：Agent Loop、上下文及工具执行；[MCP 接入](source/pico/agent/tools/mcp.py)。
- [pico/memory_engine/](source/pico/memory_engine/)：记忆后端接口与 Skill 管理。
- [pico/evolver/](source/pico/evolver/)：受控候选搜索与验收。
- [pico/tracing/](source/pico/tracing/)：链路记录与查看器。
- [benchmarks/picobench/](source/benchmarks/picobench/)：冻结任务、预算、Verifier、报告重建；[成本协议与12个固定用例](source/benchmarks/picobench/packs/tokenwise_cost/)。
- [tests/](source/tests/)：保留的工程测试；[维护流程](source/tests/test_maintenance.py)、[三阶段回归](source/tests/test_maintenance_regression.py)、[SQLite 事务](source/tests/test_maintenance_store_transactions.py)。
- [docs/](source/docs/)：原始运行、设计和评测说明；[飞书维护模式](source/docs/onboarding/feishu.zh-CN.md)。
- [ui-tui/](source/ui-tui/)：终端交互界面源码与构建输入。
- [scripts/](source/scripts/)、[Makefile](source/Makefile)、[pyproject.toml](source/pyproject.toml)、[uv.lock](source/uv.lock)：工具、依赖与构建。
- [LICENSE](source/LICENSE)、[NOTICES.md](source/NOTICES.md)、[LICENSES/](source/LICENSES/)：项目及第三方许可。

先读 [完整流程](WORKFLOW.md)，再按 [安装与验证](RUNNING.md) 运行；数字和实验限制集中在 [EVIDENCE.md](EVIDENCE.md)。[同步来源](SOURCE_PROVENANCE.md) 说明上游与本轮迭代的归属；[当前清单](SOURCE_MANIFEST.json)、[基线清单](SOURCE_BASELINE_MANIFEST.json) 和[变更清单](SOURCE_CHANGES.json) 用于核对版本与完整性。
