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
- 前端：组件/表单测试覆盖校验与错误反馈，最终执行生产构建。当前前端仅有 `src/app/App.test.tsx` 一个测试，**页面级测试是已知缺口**，新页面交付时应补上。
- 改任何票的 `Status:` 或勾选验收标准时，同一提交内同步 `docs/development-plan.md` 的状态列。

工作流细节见 `docs/development-workflow.md`。
