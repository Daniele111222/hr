# AGENTS.md

PayLite —— 单目标公司的工资数据管理系统。本机部署，数据不出本机。第一阶段维护员工月薪，以考勤表和绩效表为月度输入，生成工资记录，按主体与期间保存、查询、汇总，并导出四类工资 Excel。

后端 `backend/src/paylite/`（Python 3.13、FastAPI、SQLAlchemy、Alembic、PostgreSQL 16），前端 `frontend/src/`（Vite + React + TypeScript + Less）。个税计算、远程部署、复杂权限明确不在范围内。

## Agent skills

### Issue tracker

票以本地 markdown 文件存放于 `.scratch/paylite-mvp/issues/NN-<slug>.md`，状态写在文件的 `**Status:**` 行；不使用 GitHub Issues。见 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个规范角色名（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`），本仓库另有终态 `completed`。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文：根 `CONTEXT.md` 为领域词汇表，`docs/adr/` 惰性创建。见 `docs/agents/domain.md`。

### Design prototype

`design/` 是前端视觉、布局和交互的实现依据。开始任何页面开发前必须先读：

1. `design/DESIGN-MANIFEST.json`：确认屏幕边界、对应文件和响应式检查范围。
2. 对应的 `design/*.html`：确认页面信息层级、文案、控件和状态。
3. `design/assets/app.css`：提取颜色、字体、间距、圆角、表格、抽屉和响应式规则。
4. `design/assets/app.js`：确认筛选、弹层、状态切换等原型交互。
5. `design/DESIGN-HANDOFF.md`：执行交付检查，不把 `index.html` 当作全部页面的合并稿。

当前路由与原型来源：

| 前端路由 | 原型文件 |
| --- | --- |
| `/` | `design/index.html` |
| `/organization` | `design/organization.html` |
| `/employees` | `design/employees.html`；员工详情参考 `design/employee-detail.html` |
| `/imports` | `design/import-center.html`、`design/import-batch.html` |
| `/payroll` | `design/periods.html`、`design/batch-detail.html`、`design/incentive.html` |
| `/rules` | `design/city-rules.html`、`design/payroll-rules.html` |
| `/exports` | `design/export-center.html` |

前端实现必须遵守以下优先级：

- **业务规则：** `CONTEXT.md` 与对应票高于原型文案和演示数据；原型冲突时先修正原型，再实现页面，避免错误规则继续传播。
- **视觉与交互：** 原型高于框架默认样式；必须保持应用外壳、信息层级、紧凑数据密度、状态反馈和响应式行为，禁止先交付通用 Ant Design 页面再补视觉。
- **真实数据：** 禁止把原型中的演示公司、人数、期间或薪资写入生产代码；只使用真实接口数据或明确的“未初始化/尚未实现”状态。
- **技术落地：** 使用 React、Ant Design 与局部 `*.module.less` 重建原型；禁止让生产代码直接依赖 `design/` 的 HTML、CSS 或 JavaScript。
- **页面边界：** 一个原型屏幕对应独立路由或页面职责；禁止把多个屏幕压成一个通用卡片页，因为这会丢失原型的信息架构。
- **交付检查：** 页面首次实现时即对照对应原型检查默认、加载、空、错误、成功、禁用与窄屏状态；不得把原型对齐作为后续补充任务。

## 开工前

1. 读 `docs/agents/domain.md` 指向的领域文档，尤其是 `CONTEXT.md` 的"2026-09-15 业务决策确认"八条。
2. 查 `docs/development-plan.md` 的"业务决策门槛"表，确认当前票的待收敛决策是否已定。
3. 查票文件的 `Blocked by`，确认前置票已 `completed`。
4. 首次克隆后启用提交钩子（backend 改动会自动重建本地容器）：

```bash
git config core.hooksPath .githooks
```

## 硬性约束

这些来自 `docs/development-plan.md`，违反会直接改变金额或归属：

- 金额使用 `Decimal`；项目和最终结果四舍五入保留两位。身份证、银行卡、API 金额遵循**文本契约**。
- 全系统展示与导出必须明确标识"未扣个税金额"；无来源税务字段留空并提示，**不把未知税额默认为零**。
- 新 schema 需求使用**新增** Alembic revision 与可审查 SQL，不改写初始迁移，不静默猜测既有记录的业务值。
- 确认后业务内容不可直接改写；更正通过整批新版本与受控替代机制实现，保留历史快照。
- 规则变更、输入修正、公司期间激励变更必须参与试算版本校验；确认与导出不能使用过期结果。
- 员工资料只维护当前信息与算薪必需的生效信息，不扩展完整历史档案；历史工资依赖计算时快照解释。
- 分层：API 负责 DTO 与错误映射，service 负责用例与事务，domain 用规范化输入做纯计算，Excel 适配器负责格式。简单查询不强制套通用 Repository。`services`、`domain`、`excel` 在对应竖切实现前**不预建空目录**。
- 不先建一整层空框架；每项按页面、用例、必要迁移和测试形成可验证竖切。
- 集成测试只使用专用测试数据库（`paylite_test`）并显式设置 `PAYLITE_ALLOW_TEST_DATABASE_RESET=1`，**不指向开发数据库 `paylite`**——测试 teardown 会执行 downgrade。

## 提交与验证

每项验收勾选必须有实际证据，不能用计划中的测试替代已运行结果。

- 后端：改动范围的 Ruff 与格式检查、`lint-imports`、编译检查、`pytest`；涉及持久化的功能跑 PostgreSQL 集成测试。
- 前端：组件/表单测试覆盖校验与错误反馈，最终执行生产构建。测试与页面同目录；新增或改造交互时同步更新对应 `index.test.tsx`。
- 改任何票的 `Status:` 或勾选验收标准时，同一提交内同步 `docs/development-plan.md` 的状态列。

工作流细节见 `docs/development-workflow.md`。

## 本文档的维护规则

- AGENTS.md 中的每条规则必须能回答“违反它会导致什么具体后果”；无法回答的规则应删除。
- 能被 lint、CI 或类型检查自动强制的规则不重复写入，除非需要解释原因。
- 发现文档与代码不一致时，以代码为准并更新本文档。
- 新增公共组件、工具、约定或设计屏幕时，评估是否需要同步更新本文档及 `design/DESIGN-MANIFEST.json`。

<!-- last-verified: 2026-09-21 -->
