# Issue tracker: Local Markdown

本仓库的 issue 与 spec 以 markdown 文件形式存放在 `.scratch/`。

GitHub remote（`github.com/Daniele111222/hr`）存在，但**不**作为 issue tracker。不要对票执行 `gh issue create`；票就是仓库里的文件，随代码一起提交和审查。

## 约定

- 一个 feature 一个目录：`.scratch/<feature-slug>/`
- Spec 是 `.scratch/<feature-slug>/spec.md`
- 实现票是一票一文件：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 起按依赖顺序编号（前置票在前），**永不**合并成单个 tickets 文件
- 状态记录在文件顶部附近的 `**Status:**` 行（角色字符串见 `triage-labels.md`）
- 评论与讨论追加到文件底部的 `## Comments` 标题下

当前 feature：

- **`paylite-mvp`**：原 MVP 共 16 张票（`01`—`16`），沿用既有无独立 spec 的登记方式。
- **`paylite-workbook-monthly`**：整本导入与月度不含绩效，含 `spec.md` 及三张用户已确认的实施票（`01`—`03`）；2026-10-10 完成需求设计，尚未实施。

## 本仓库的两处既有偏差

这两点是 2026-09-17 登记时形成的事实，后续 skill 应沿用而不是自行"修正"：

1. **没有 `spec.md`。** 16 张票由对话直接拆出，未经 `/to-spec`。`/code-review` 的 Spec 轴应把票文件本身连同 [docs/development-plan.md](../development-plan.md) 一起当作 spec 来源；不要因为没有 `spec.md` 就跳过 Spec 轴。
2. **`Status:` 行同时承载 triage 角色和执行状态。** 票 `01`、`02` 已从 `ready-for-agent` 改为 `completed`。`completed` 不属于五个规范 triage 角色，它是本仓库的终态值，含义是"该票已过 triage 且实现完成"。skill 被要求应用 triage 角色时，对 `completed` 的票不要覆盖。

## 执行索引必须同步

[docs/development-plan.md](../development-plan.md) 是原 16 张 MVP 票及新增整本导入需求的执行索引（状态列 + 交付阶段 M1—M4 + 业务决策门槛）。新增票以 WB01—WB03 在索引中区分，文件仍按各 feature 内的 01—03 编号。改任何票的 `Status:` 或勾选验收标准时，**同一提交内**更新该索引的状态列。索引自身写明"更新状态时同步修改任务文件和本索引"。

票文件里的验收标准复选框必须逐条勾选，且勾选需有实际证据——development-plan.md 的"验证和完成标准"一节禁止用计划中的测试替代已运行结果。

## 当 skill 说"publish to the issue tracker"

在 `.scratch/<feature-slug>/` 下新建文件（目录不存在则创建）。

## 当 skill 说"fetch the relevant ticket"

读取被引用路径的文件。票号须结合 feature 或当前会话范围；例如 MVP `03` 对应 `.scratch/paylite-mvp/issues/03-rules.md`，WB03 对应整本导入需求的 `03-workbook-correction-trace.md`，不能跨 feature 猜测。

## Wayfinding operations

由 `/wayfinder` 使用。**map** 是一个文件，每张票一个**子**文件。

- **Map**：`.scratch/<effort>/map.md`（Notes / Decisions-so-far / Fog 正文）。
- **Child ticket**：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 编号，正文写问题。`Type:` 行记录票类型（`research`/`prototype`/`grilling`/`task`）；`Status:` 行记录 `claimed`/`resolved`。
- **Blocking**：顶部附近的 `Blocked by: NN, NN` 行。列出的文件全部 `resolved` 时该票解除阻塞。
- **Frontier**：扫描 `.scratch/<effort>/issues/`，取未关闭、未阻塞、未认领的文件；编号最小者优先。
- **Claim**：任何工作开始前先把 `Status: claimed` 写盘。
- **Resolve**：在 `## Answer` 标题下追加答案，置 `Status: resolved`，然后把上下文指针（要点 + 链接）追加到 `map.md` 的 Decisions-so-far。
