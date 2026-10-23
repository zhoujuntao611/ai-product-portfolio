# 周俊涛 · AI 产品项目集

北京航空航天大学信息与通信工程硕士在读，求职 AI 产品经理实习。这里整理三个项目方向：客服回复审核、攀岩训练记录、订单分析。我负责问题定义、流程与交互、方案取舍和验证，借助 AI 编程工具完成实现。

[个人主页](https://zhoujuntao611.github.io/ai-product-portfolio/) · [运行与验证](docs/DEVELOPMENT.md) · [ClimbAI 与攀迹的关系](docs/CLIMBING_EVOLUTION.md)

## 精选项目

### SupportFlow｜客服回复审核

**问题：** 找到了退款条款，仍可能用“申请期限”回答“到账时间”。我把政策有效性、条款对问题的支持和人工审核接在同一流程里，保留修改原因与引用记录。

**验证：** 2026-10-19 的同组 24 项合成回归中，模型流程从 16/24 到 24/24，规则流程也从 18/24 到 24/24。改进支持上下文与校验策略的调整，尚未证明模型的额外增益。模型只选择已有证据编号，回复由本地原文组装，待人工审核。

**体验：** 本机运行，可导入自己的结构化政策；默认规则模式无需模型密钥。

[源码与运行](projects/supportflow) · [产品需求](projects/supportflow/docs/PRD.md) · [关键取舍](projects/supportflow/docs/ITERATION_EVIDENCE.md) · [模型与规则对照](docs/LIVE_PRACTICE_20261019.md) · [界面](docs/assets/supportflow.png)

### 攀迹｜攀岩训练记录与文字复盘

**问题：** 记过训练、拍过视频，下一次仍难以找回同一线路的尝试。我设计选馆、连续记录、线路回看和目标核对流程，并根据手机使用反馈，将关联视频直接放进尝试卡片。

**取舍：** 先留下训练事实，再生成可确认的建议；训练可存云端，视频及关联留在设备。程序计算统计事实，模型提出假设与建议，用户确认后才形成下次目标。

**状态：** 微信原生小程序 0.2.2 开发预览，14 个页面；混元文字复盘有限定合成场景的接入记录。完整手机验收、公开发布和用户效果验证待完成。浏览案例无需账号，运行源码与手机预览需使用自己的环境。

[完整案例](https://zhoujuntao611.github.io/ai-product-portfolio/panji/) · [源码与运行](projects/panji) · [产品需求](projects/panji/docs/PRD.md) · [验证范围](projects/panji/docs/EVIDENCE.md) · [界面](docs/assets/panji/route-project.png)

### MetricPilot｜订单 CSV 分析

**问题：** 同一组 9 笔合成订单，按原订单日和退款发生日分别算出 30 元与 120 元退款额。我选择先确认口径，问题与设置冲突时暂停查询。

**取舍：** CSV 预览、字段映射、质量检查、口径确认之后，才执行受约束的只读统计。结论保留源行、文件指纹和查询参数，便于复核。

**状态：** 可在本机导入订单 CSV；当前入口采用规则解析，没有外部模型调用。22 项固定合成验收由 11/22 到 22/22，属于开发回归。

[源码与运行](projects/metricpilot) · [产品需求](projects/metricpilot/docs/PRD.md) · [指标定义](projects/metricpilot/docs/METRICS.md) · [迭代证据](projects/metricpilot/docs/ITERATION-20261019.md) · [界面](docs/assets/metricpilot.png)

## 早期探索：ClimbAI

攀岩方向先用 ClimbAI Web 原型探索训练规划、知识引用和反馈确认，随后在攀迹中将重点转向现场记录、线路回看与下次目标。**作品集以攀迹为主，ClimbAI 作为早期探索保留，不再并列为第四个主项目。**

ClimbAI 的在线演示仍可体验，使用浏览器本地规则与数据；真实模型参与规划和反馈的记录来自独立后端实验。两套代码与存储独立，攀迹没有继承 ClimbAI 的知识库或规划工作流，也没有数据自动迁移。

[早期 Web 演示](https://zhoujuntao611.github.io/ai-product-portfolio/climbai/) · [保留的源码](projects/climbai) · [演进、保留范围与维护约定](docs/CLIMBING_EVOLUTION.md)

## 如何验证

SupportFlow 与 MetricPilot 默认只需 Python；攀迹本地检查需要 Node.js；ClimbAI 的前端和后端可分别运行。完整命令、依赖、网站检查及发布文件校验见 [开发与验证说明](docs/DEVELOPMENT.md)。

- **工程检查**验证已列出的程序行为；当前执行结果以 [GitHub Actions](https://github.com/zhoujuntao611/ai-product-portfolio/actions/workflows/verify.yml) 为准。
- **模型实验**有请求和逐题记录，但合成同题复测不等于盲测、真实用户成功率或业务收益。[实测记录](docs/LIVE_PRACTICE_20261019.md)
- **攀迹公开副本**有 174 项本地测试；原工程 176 项包含两项未公开的部署处理器测试，范围不同。[证据说明](projects/panji/docs/EVIDENCE.md)
- 当前没有已验证的留存、节省工时或训练改善结果。下一步应通过目标用户任务观察检验记录负担、审核成本与建议采纳。

## 来源与许可

SupportFlow、MetricPilot、ClimbAI 代码按各自随附 MIT LICENSE 提供。攀迹代码目前用于公开展示，未授予统一开源许可；其中 OSM 数据子集适用独立的 ODbL，其他资料保留各自来源与权利。见 [攀迹来源与许可](projects/panji/README.md#数据来源与许可)。

仓库不提供开发账号、模型凭据、私人简历或用户训练数据。项目界面和验收使用合成样例；公共场所资料不代表用户规模或实时营业状态。
