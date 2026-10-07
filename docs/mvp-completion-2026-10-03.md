# PayLite MVP 需求完成情况（2026-10-04 更新）

**16 项需求的功能实现已完成；本轮发现的首页、正式工资员工明细、契约生成、URL 筛选和格式检查缺口已补齐。** 工程自动化与合成案例验收通过，仍不能把真实工资人工对账或用户页面验收写成已完成。所有改动保留在工作区，未提交 Git。

## 本轮交付

- 首页查询真实期间、各主体数据准备和批次状态，展示七步进度、待办、正式未扣个税金额及最近导入/四类导出；不写入原型演示数据。工作台只读试算摘要，不授予“已查看最新试算”的确认凭证。
- `/payroll/ledger/records/:recordId` 展示正式员工快照、收入扣缴项目、冻结公式及输入、考勤事实、社保公积金、历史期间和已替代版本。更正后的旧记录仍可追溯，台账合计只包含有效正式结果。考勤扣款由后端 Decimal 汇总扣款项目，排除激励收入。未保存的事实显示为 —，未知税额不补零。
- 后端补齐导入、试算、导出和正式明细响应 DTO；离线 `npm run api:generate` 从实际 FastAPI OpenAPI 生成完整类型，覆盖 77 个 HTTP 操作。金额展示按文本格式化，不用 JavaScript number 计算工资。
- 工资、台账、导入与导出筛选保存在 URL。跨菜单保留所选期间，修复旧期间误导出最新期间及激励链接误把期间 ID 当年月的问题。
- 本机正式运行由 FastAPI 同源托管 `frontend/dist`，业务 API 使用 `/api`；深链接刷新返回 SPA，未知 API 返回 404。API 单独运行保留原路径并提供 `/api` 别名。Vite 代理保留 `/api`，两种运行模式均可访问。
- 修复既有格式问题、imports hooks warning 和新增页面窄屏网格溢出；未新增数据库迁移、依赖或业务规则。

## 实际验证（2026-10-04）

| 检查 | 证据 | 结果 |
| --- | --- | --- |
| 后端完整回归 | Python 3.13，临时 PostgreSQL 16；`PAYLITE_TEST_DATABASE_URL=.../paylite_test PAYLITE_ALLOW_TEST_DATABASE_RESET=1 .venv/bin/pytest -q --tb=short` | **77 passed**，含 33 个 PostgreSQL 集成案例；2 条第三方弃用提示 |
| 后端静态检查 | `.venv/bin/ruff check src tests`、`ruff format --check src tests`、`lint-imports`、`python -m compileall -q src tests` | 全部通过；61 文件格式通过，2 contracts kept |
| 前端完整回归 | Node 24.21.0；`npm test -- --maxWorkers=1` | **13 文件 / 54 tests passed**；jsdom 伪元素能力提示 |
| 前端工程检查 | `npm run lint`、`npm run format:check`、`npm run build` | 全部通过；Vite 大 chunk 提示保留 |
| 同源服务与代理 | 最新源码的隔离运行镜像端口 31001；临时 Vite 51001 的 `/api/health` 与 `/api/payroll/ledger/records/1` 返回 200；静态托管自动化测试覆盖深链接/API 404/缺构建阻断 | 通过 |
| 浏览器闭环 | 合成数据在 `paylite_test`：普通试算→本期激励→查看最终试算→整批确认→锁定→台账详情→四类生成/报告/下载→首页进度 7/7 | 通过 |
| 金额与文件 | 固定 8000 + 绩效 2000 + 激励 30 = 应发 10030；个人社保/公积金 800；未扣个税 9230；公司成本 11230。四个实际下载 xlsx 经 openpyxl 读取断言 | 一致；银行卡 `000012345678901234` 为文本；申报模板 33 列、已缴税额 AF2 留空 |
| 响应式 | 首页、正式员工明细、工资工作台、台账、批次详情、激励、导入、导出共 8 页面；宽度 360/390/430/600/820/1024/1366/1440/1920 | 72 个页面/视口组合均无整页横向溢出；新增页面桌面/平板/手机截图已人工查看 |
| 状态与历史 | 页面测试覆盖加载、空、错误、禁用、快照/敏感信息及导航；集成测试验证旧快照不随当前姓名变化、已替代旧记录、修正后的考勤、激励不计入扣款和首页摘要不修改查看凭证 | 通过 |
| Standards 审查 | 相对 `3d08221` 的工作区增量，独立代理及最终增量复核 | 先发现 API 代理和扣款归类两项，修复后无阻断项 |
| Spec 审查 | CONTEXT、票 05/10、原型和整体验收核查，独立代理及最终增量复核 | 先发现历史期间导航问题，修复后无阻断项 |
| Compose / diff | `docker compose config --quiet`、`git diff --check` | 通过 |

浏览器截图及四类合成文件保存在本机 `output/playwright/`，不提交工资文件。后端/前端日志保存在 `/tmp/paylite-final-back-tests.log`、`/tmp/paylite-final-front-tests.log`；视口测量见 `/tmp/paylite-viewport-results.log`、`/tmp/paylite-existing-viewports.log`。这是合成工程案例，不是业务真实工资数据。

## 尚待外部验证

1. **04 号票用户页面验收及真实工资人工对账。** 本轮未收到真实考勤、绩效、规则和人工期望金额，保留用户验收勾选与 MVP 整体验收为待完成。工程浏览器验证不能替代用户确认或实际发薪/申报。
2. **原 Dockerfile 的标准镜像重建。** `docker build --tag paylite-remaining-backend:20261003 ./backend` 获取 `python:3.13-slim` 元数据被拒绝；本机没有该基础镜像缓存。本轮以既有 `hr-backend:latest` 的相同未变依赖为基础，覆盖最新源码、迁移及脚本，独立构建 `paylite-remaining-runtime:20261003`，`compileall` 和 `pip check` 通过，并完成同源浏览器闭环。该运行验证不等于原 Dockerfile 从基础镜像重新构建通过，14 工程验收仍保留待验收。

本轮只在新建的 `paylite-remaining-20261003` 专用测试库容器（15433）和测试后端（31001）运行；未挂载开发数据卷，未写入开发数据库 `paylite`。测试 schema 已 teardown，测试容器、本机 Uvicorn、临时 Vite 均已关闭。开发配置仍为后端 31000、数据库 15432。

---

## 2026-10-03 初始核查记录（历史；当前结论以上文为准）

# PayLite MVP 需求完成情况核查（2026-10-03）

核查基线：Git `3d08221`，开工时工作区干净。依据为 `CONTEXT.md`、16 张需求票、`docs/development-plan.md`、设计交付规范及当前源码。本次只更新文档，不修改业务代码，不提交 Git。

## 结论

**核心工资功能均已实现，但不能判定所有需求已完整交付或 MVP 整体验收完成。** 组织、员工、规则、三类导入、期间批次、试算、全公司激励、确认锁定、更正、独立补发和四类 Excel 导出都有实际实现及通过的自动化验证。仍有前端交付缺口、人工验收和工程检查未通过项。

票的 `Status:` 是接手/交付状态，开发计划的状态列是验收状态；`completed` 与“待验收”可以同时存在，见 `docs/agents/triage-labels.md`。本次不把它们机械改成相同字符串。

## 逐项核对

| 编号 | 需求 | 当前结果 | 源码及验证依据 |
| --- | --- | --- | --- |
| 01 | 公司与组织维护 | 已完成 | `api/organization.py`、组织页面、组织员工集成测试 |
| 02 | 员工与薪酬维护 | 已完成 | `api/employees.py`、员工页面；80%/20%、试用期及生效日期校验 |
| 03 | 城市及考勤规则维护 | 已完成 | `api/rules.py`、规则页面、0002；固定社保基数、5%/5% 公积金 |
| 04 | 员工 Excel 导入 | 开发及自动化验证完成，待用户页面验收 | `services/employee_import.py`、导入页面；票中首项仍未勾选 |
| 05 | 工资期间与批次工作台 | 核心验收已完成，保留前端约定整改项 | `services/payroll_workbench.py`、工资页面；票中已记录 URL 筛选与契约生成整改 |
| 06 | 考勤导入与错误修正 | 已完成 | `services/attendance_import.py`、导入页面；部分成功、纠错、输入修订号测试 |
| 07 | 绩效导入与错误修正 | 已完成 | `services/performance_import.py`；试用期、系数及纠错测试 |
| 08 | 普通工资试算与核对 | 已完成 | `domain/payroll.py`、`services/payroll_trial.py`、批次详情；部分失败、过期及精度测试 |
| 09 | 全公司考勤激励 | 已完成 | `services/attendance_incentive.py`、激励页面；全主体来源、幂等、失效及金额守恒测试 |
| 10 | 整批确认、锁定与台账 | 核心已完成，历史员工计算明细页面待补齐 | 确认与台账 service、0008、集成测试通过；台账页面只显示汇总及记录表 |
| 11 | 整批更正与有效版本切换 | 已完成 | `services/payroll_correction.py`、0009；全员覆盖、连续更正、切换回滚及导出版本回归 |
| 12 | 独立补发批次 | 已完成 | `services/payroll_supplement.py`、0010、补发详情；幂等、金额和导出去重回归 |
| 13 | 工资表导出 | 已完成 | `excel/payroll_export.py`、导出中心；锁定门槛、短事务、过期文件及更正/补发测试 |
| 14 | 代发工资表导出 | 功能及自动化验证完成，保留工程待验收 | `excel/bank_export.py`；模板差异、缺卡阻断、零金额和同员工合并测试；本次镜像构建超时 |
| 15 | 人工成本表导出 | 已完成 | `excel/labor_cost_export.py`；公司/个人费用、主体汇总、扩行和来源留空测试 |
| 16 | 申报辅助模板导出 | 已完成 | `excel/tax_export.py`；真实 xlsx 模板、来源字段、未知税务留空及更正/补发测试 |

这里“已完成”表示既有票的功能交付与验收记录获当前源码和回归支持，不等于本次重新进行了全部浏览器视觉验收或真实工资对账。

## 尚未完成或未通过的事项

1. **首页月度工作台尚未接入真实进度。** `frontend/src/pages/overview/index.tsx` 只查询服务健康、公司和员工；期间固定为“尚未选择”，进度固定为 `0 / 7`，流程步骤固定在第一个，保留“期间功能尚未实现”等旧提示。`design/index.html` 中的主体进度、待办、最近记录没有对应实现；应用壳 `AppLayout.tsx` 的当前期间也固定为“尚未选择”。这是现有原型的交付缺口，不是新增业务需求。
2. **正式台账的员工计算明细页面未落地。** `design/ledger-employee.html` 定义收入扣缴计算过程、社保公积金分项和历史各期间。当前 `AppRouter.tsx` 没有此页面入口，`pages/payroll/ledger.tsx` 未展示台账响应中的 `items`、`steps`，也没有员工计算明细入口。批次详情抽屉显示的是“试算明细”，不能据此认定正式历史台账页面已经交付。10 号票重新进入补齐实现队列，保留已有后端验收证据。
3. **04 号票用户页面验收仍未完成。** 保留未勾选项，不能用自动化通过替代用户验收。
4. **前端契约与筛选约定尚未完整落实。** `shared/api/schema.d.ts` 仅含 `/health`，业务请求主要使用 `resources.ts` 的手写类型；工资页面期间/主体/批次筛选保存在局部 state。05 号票此前已记录这类整改项，本次不扩展为新的业务功能。
5. **全量格式检查失败。** 后端 `src/paylite/__init__.py` 一处；前端七个文件：`pages/payroll/batch-detail.test.tsx`、`batch-detail.tsx`、`index.module.less`、`index.test.tsx`、`index.tsx`、`ledger.tsx`、`supplement-detail.tsx`。前端 lint 另有 `pages/imports/index.tsx:99` 的 hooks 依赖 warning。
6. **本次后端镜像构建失败。** 拉取 `python:3.13-slim` 元数据时 Docker Hub 连接超时，未进入代码构建。15、16 的 2026-10-02 记录有历史构建成功证据；本次不能据此宣称当前构建通过，也不把网络失败误写成导出功能缺失。
7. **真实工资人工对账和 MVP 整体人工验收仍待业务输入。** 本次使用合成测试数据；未对真实员工金额、实际发薪或税务申报作完成判断。正式前端静态发布方案也仍未定，现有运行方式是本机 Vite + FastAPI。

## 本次实际运行证据

| 检查 | 命令与环境 | 结果 |
| --- | --- | --- |
| 后端完整测试 | Python 3.13；`PAYLITE_TEST_DATABASE_URL=postgresql+psycopg://paylite:paylite_test_only@127.0.0.1:15433/paylite_test PAYLITE_ALLOW_TEST_DATABASE_RESET=1 .venv/bin/pytest -q --tb=short` | **73 passed**（41 非集成 + 32 集成，含参数化案例） |
| 后端 lint | `.venv/bin/ruff check src tests` | 通过 |
| 后端格式 | `.venv/bin/ruff format --check src tests` | 失败，1 文件 |
| 模块依赖 | `.venv/bin/lint-imports` | 2 contracts kept，0 broken；仅覆盖已配置的约束 |
| Python 编译 | `.venv/bin/python -m compileall -q src tests` | 通过 |
| 前端测试 | Node 24.21.0；`npm test -- --maxWorkers=1` | **10 文件 / 41 项通过**；有 jsdom 伪元素能力提示 |
| 前端生产构建 | Node 24.21.0；`npm run build` | TypeScript 与 Vite 构建通过 |
| 前端 lint | `npm run lint` | 通过，有 1 条 warning |
| 前端格式 | `npm run format:check` | 失败，7 文件 |
| 后端镜像 | `docker build --tag paylite-audit-backend:20261003 ./backend` | 失败，Docker Hub 元数据请求超时 |
| 接口/schema | `create_app().openapi()`、SQLAlchemy metadata、Alembic revisions | 76 个 HTTP 操作、28 张 ORM 表、迁移 head 为 `0010_supplement_batches`；用于更新 Obsidian 接口与数据文档 |

测试数据库位于本次临时创建的 PostgreSQL 16 容器 `paylite-audit-20261003`，未挂载开发数据卷；测试 teardown 已执行，容器已停止并自动删除。没有启动或修改现有开发后端、没有写入开发库 `paylite`。

本次没有重新运行真实浏览器全流程、九种视口视觉检查或 LibreOffice 文件打开检查；各导出票中的既有记录保留为历史证据。没有调用按 Git 差异双代理审查的 code-review 流程，本次为按完整需求清单核验当前实现。
