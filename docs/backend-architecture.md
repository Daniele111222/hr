# PayLite 后端架构

> 文档版本：v0.5（2026-10-04）
> 适用仓库：`/Users/hyperchain/Desktop/ai_lession/hr`  
> 架构基线：当前已落地健康检查、组织、员工、规则、三类导入、试算、激励、确认、锁定、台账、更正、独立补发与四类导出；功能缺口已补齐；人工验收与标准镜像网络验证见完成情况核查。

这份文档描述当前仓库可以被代码证明的事实、下一阶段要落地的代码接口，以及业务决策对后端的约束。规划中的目录和流程不代表已经存在的实现。

## 1. 事实基线

当前后端使用 Python 3.13、FastAPI、Uvicorn、Pydantic Settings、SQLAlchemy 2.x、Alembic 和 psycopg 3。服务入口在 `backend/src/paylite/main.py`，当前注册 `/health`、组织、员工、规则、导入、试算、确认、锁定、台账、更正、独立补发和导出路由。

当前已落地的应用与持久化部分包括：

- `application.py` 的 `create_app()` 工厂、`api/system.py` 的系统路由，以及由 `main.py` 暴露的 ASGI app；
- `db/base.py` 的 SQLAlchemy `Base`；
- `db/session.py` 的 engine、`SessionLocal` 和 `get_session` 生成器；
- 按组织、员工、月度输入、规则、工资和导出主题拆分的 ORM 模型包；
- `backend/sql/001_initial_schema.sql` 至 `012_company_monthly_import.sql` 及对应 Alembic `0001`—`0012`（head：`0012_company_monthly_import`）；
- PostgreSQL 约束、日期区间排斥约束、更新时间触发器、部门树防循环触发器和锁定工资结果不可变触发器；
- 模型约束测试、应用工厂/健康检查测试和 PostgreSQL 集成测试；
- `import-linter` 开发依赖，以及 CI 中对当前数据库层导入边界的检查。

当前业务模块均已落地：`services` 负责导入、工资工作台、试算、激励、确认、台账、更正、补发和导出；`domain/payroll.py` 使用不可变 dataclass 与 Decimal 纯计算；`excel` 包含三类输入模板和四类输出适配器、运行时 xlsx 模板。无需为了目录规划新增 Repository 或空包。

`openpyxl` 已是运行依赖。`import-linter` 当前两条 contract 只检查数据库层与 HTTP/应用装配层的边界及 ORM 对配置/Session 的禁令，不能解释成完整分层验证。组织、员工和规则路由仍直接使用 Session 并提交，下面 service 事务职责是目标约定，不代表全仓库已经完成该分层整改。

真实 CI 位于 `.github/workflows/backend-ci.yml`：在 Python 3.13 和 PostgreSQL 16 下安装 `.[dev]`，执行 Ruff 检查、Ruff 格式检查、`lint-imports`、`compileall` 和 pytest；测试通过后构建带 commit SHA 的 Docker 镜像。当前 workflow 没有发布镜像或部署生产环境。

## 2. 架构结论

PayLite 采用本地优先的分层单体。HTTP、数据库和文件系统属于外壳；算薪规则已位于不依赖 FastAPI、SQLAlchemy 或 Excel 的 `domain/payroll.py`。当前代码量很小，所以只建立真实需要的模块，不预先创建没有行为的 `services`、`domain` 或 `excel` 空目录。

目标依赖方向如下：

```text
HTTP 请求
   ↓
api（DTO、校验、错误和路由）
   ↓
services（用例编排、并发控制、事务边界）
   ├──────────────→ db（Session、ORM、查询适配器）
   └──────────────→ domain（纯规则和不可变结果）

services ──→ excel（文件格式适配器）
domain 不依赖 api、db、excel
```

这里的 `domain` 是一个具有小接口和深实现的模块：调用者只提供规范化输入，得到工资项目、汇总和计算步骤。数据库模型、HTTP DTO 和 Excel 行格式都在 seam 外转换，避免让任何一种外部表示渗入算薪规则。

第一阶段仍然是一个进程、一个 FastAPI 应用、一个本机 PostgreSQL。未来如果需要远程部署或多人访问，再单独评估账号、权限、备份和数据边界；不因为“未来可能拆分”而提前拆成微服务。

### 通用分页契约

分页接口复用 `api/pagination.py` 的 `PageParams` 与泛型 `Page[T]`，接收 `page_no`、`page_size`，返回 `items`、`total`、`page_no`、`page_size`。默认第 1 页、每页 10 条，单页最多 100 条；越界页返回空 `items` 并保留真实总数。

查询复用 `services/pagination.py` 的 `paginate()`：调用方选择 DTO 所需列，并提供包含唯一键的稳定排序；辅助函数在数据库中执行总数统计与 offset/limit，不加载全量记录再截取。组织分页与关联名称查询在 `services/organization.py` 中完成，父部门、主体与共用部门名称随当前页返回，不依赖它们恰好出现在其他列表的当前页。

组织维护四个列表使用原有 GET 路径的分页响应；对应 `/options` 路径提供完整表单选项，不能将列表第一页当作完整的主体、城市或部门选择范围。

## 3. 目录职责

当前实际目录如下，不建立规划中的空包：

```text
backend/src/paylite/
├── main.py / application.py / config.py
├── api/                 # system、organization、employees、rules、imports、payroll、exports
│   └── deps.py / errors.py / schemas.py
├── db/
│   └── models/          # organization、employees、imports、rules、payroll、exports
├── services/            # 导入、期间批次、试算、激励、确认、台账、更正、补发、导出
├── domain/
│   └── payroll.py       # Decimal 算薪与考勤激励纯计算
└── excel/               # employee/attendance/performance_template 与四类 export
    └── templates/       # payroll-v1、bank-v1、labor-cost-v1、tax-v1.xlsx
```

ORM 分包只改变实现文件位置，不改变调用方已经使用的公开符号。`from paylite.db.models import Employee`、`PayrollBatch` 等路径由 `models/__init__.py` 继续导出；迁移脚本和测试不应因为拆包而改用内部模块路径。

各层的接口约束是：

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| `api` | 解析请求、Pydantic 校验、调用用例、映射响应和 HTTP 状态码 | 算工资、拼 SQL、直接提交事务 |
| `services` | 一个业务动作的编排、加载输入、锁定资源、调用领域函数、持久化结果 | 把 SQL 细节和金额算术散落到路由 |
| `domain` | 纯规则、状态迁移合法性、Decimal 计算、结果与计算步骤 | FastAPI、SQLAlchemy、文件读写、全局可变状态 |
| `db` | ORM 映射、Session、必要的复杂查询适配器 | 对外 DTO、Excel 列名、业务流程状态机 |
| `excel` | 模板版本、列映射、工作簿样式和文件读写 | 计算工资或决定批次是否可确认 |

简单的单表 CRUD 可以在 service 中直接使用 Session；只有复杂、重复或需要隔离查询策略的查询才抽成 Repository。不要建立每张表一个 Repository 或通用 BaseRepository。

## 4. 三种数据形态

后端必须明确区分 API DTO、领域 dataclass 和 ORM model。API 负责 Pydantic DTO 的校验和 DTO ↔ 用例命令/响应的构建；service 负责 ORM → 领域输入和领域结果 → 持久化。service 不得反向依赖 `api.schemas`，API 负责把 service 返回的领域/应用结果映射成响应 DTO。

### API DTO

Pydantic DTO 是外部契约。金额用字符串接收和返回，API mapper 在进入 service 前转换为适合用例命令的值；日期使用 ISO 日期，时间使用带时区的 ISO 时间；身份证号和银行卡号始终是字符串。响应中不直接暴露 ORM 对象，也不把 `net_amount` 无说明地称为最终到账金额。

当前 DTO 定义在 `api/schemas.py`，包括 `EmployeeIn/Out/Patch`、`PayrollPeriodCreate/Out`、`PayrollBatchCreate/Out`、`PayrollTrialOut`、`PayrollConfirmationOut`、`PayrollLedgerOut`、更正/补发与激励响应；导出 `ExportCreate/ExportReport` 定义在 `api/exports.py`。`GET /health` 返回 `{"status": "ok"}`。准确路径和参数以 `create_app().openapi()` 为准。

### 领域 dataclass

`domain/payroll.py` 当前使用冻结的 `SalarySegment`、`Attendance`、`SocialItem`、`PayrollInput`、`PayrollItemResult`、`CalculationStep`、`PayrollResult`、`IncentiveCandidate`、`IncentiveAllocation` 和 `AttendanceIncentiveResult`。`calculate()` 计算普通工资，`calculate_attendance_incentive()` 计算合格名单分配和尾差；service 读取与规范化输入，并保存结果与计算步骤。

中间计算使用 Decimal，项目和最终金额四舍五入到两位；领域函数不查询 Session、不读写工作簿。

### ORM model

ORM model 只表达 PostgreSQL 表、外键、唯一约束、索引、日期区间和数据库不可变约束。当前 ORM 包含 28 张表，包括独立试算与公司期间激励记录；工资用例由 service 与 domain 承载，不能仅凭字段存在判断验收完成。

## 5. Session 与事务生命周期

当前 `get_session` 已经以 `SessionLocal()` 上下文创建并在请求结束时关闭；组织、员工和规则接口使用请求级 Session。后续业务接口继续沿用“一次请求一个 Session”，不共享全局 Session，也不把 Session 放进领域函数。

目标生命周期：

1. FastAPI 依赖创建一个 SQLAlchemy Session，并在 `finally` 中关闭；请求异常时回滚未完成的事务。
2. 查询请求只读 Session，不提交；需要分页和关联查询时在 service 内完成。
3. 每个写入用例由 service 明确拥有事务边界，使用 `session.begin()`，成功时一次提交，异常时整体回滚。API 不调用 `commit()`。
4. 领域函数在事务内读完快照后执行，但不执行 I/O；结果和工资明细、计算步骤、批次状态在同一个事务中写入。
5. 文件导出属于文件系统副作用。先在事务中确定可导出的稳定批次并记录 `export_batch`，文件生成完成后再用短事务写入路径、状态和 warning，避免把数据库事务长时间锁在 Excel 写入上。

“试算一个批次”的目标顺序是：锁定批次 → 读取并锁定本次计算依赖的输入/规则版本 → 形成领域 dataclass → 调用纯函数 → 写入 trial 结果和计算步骤 → 保存输入指纹/版本 → 更新批次 → 提交。确认和锁定也是独立的事务动作，必须再次锁定批次并校验状态，不能把上一次请求加载的 ORM 对象当作授权凭证。

## 6. 并发与幂等

即使产品当前只有一个使用者，也可能存在两个浏览器标签页、重复点击、请求重试或后台重启。并发控制属于数据正确性，不因单用户形态而省略。

目标做法包括：

- 对批次动作按 `payroll_batch.id` 使用 `SELECT ... FOR UPDATE`，使试算、确认、锁定、更正和导出串行化；跨主体的全公司激励动作需要按固定顺序锁定相关期间和批次，避免死锁。
- 依赖输入变化后递增输入版本或生成稳定指纹。确认必须验证 trial 使用的指纹仍等于当前输入；不一致时将试算视为失效，要求重新试算。
- 保留数据库的唯一索引作为最终防线：当前 schema 的有效正常批次主体+期间唯一、同一期间/员工输入唯一、公司/期间作用域+导入类型+文件哈希拒绝重复、工资记录批次内员工唯一。整批更正通过批次级 `is_effective` 标记允许历史版本保留；普通建批接口仍不接受仅改变 `batch_no` 的重复正常批次。
- 工资动作由 service 校验 `draft → trial → confirmed → locked`；schema 另保留 `exported/cancelled` 值，生成导出记录不代表批次必然改为 exported。更正取消和导出失败按各自用例处理。
- 当前数据库触发器保护 `confirmed`/`locked`/`superseded` 工资记录及其项目、计算步骤；更正创建新批次，不直接重写旧快照。批次级 `is_effective` 标记负责旧版本保留和新版本切换，不需要改写锁定记录状态。

当前已经保存输入修订号、试算与激励指纹、查看凭证及确认版本，并在相关 service 使用行锁与状态校验；确认后不可变及更正切换由新增迁移保护。

## 7. 业务用例与计算核心

### 导入与数据质量

Excel 列映射和解析由 `excel/*_template.py` 完成；导入 service 保存文件哈希、原始文件与行级规范化输入。正确行可以先导入，错误行保留 `raw_data`、列位置和错误码；导入用例返回批次摘要和行级结果，不把行级错误当成整个请求的未捕获异常。绩效缺失、城市规则缺失等会影响正式工资的错误必须在试算和确认门槛中体现。

员工导入在其他行校验及自动建部门前检查证件号码；同公司既有号码、文件内后续重复号码记为内部 `skipped`，接口统一过滤这些行，不返回重复提示或跳过计数，处理行总数只含实际校验的行。纠错同样检查重复号码，跳过后重试不重复写入。重复文件按公司与哈希返回原批次，数据库唯一约束仍保留。`0011_duplicate_employee_ids` 扩展导入行状态并按旧错误码迁移历史员工重复行，保留其原值、错误及修正历史；不改考勤/绩效重复策略。

导入历史详情的只读限制只在前端入口生效，员工、考勤、绩效逐行 `POST .../rows/.../correct` 路由及服务用例保留原有行为。本次上传后的纠错继续调用这些接口；GET 保留原始失败原因及历史修正字段。

`openpyxl` 已处理固定 `.xlsx` 导入与四类导出。税务原始 `.xls` 已真实转换为运行时 `.xlsx`，原件保留；系统不提供任意 `.xls` 上传转换流程。

员工模板通过 `excel/formulas.py` 统一计算允许的公式：openpyxl 分词后由 AST 白名单解释数值、单元格引用、四则运算、括号和 `ROUND`/`EDATE`，金额使用 Decimal，不执行 `eval`，不读取公式缓存。`employee_template.resolve_employee_formulas` 负责同一行日期/薪资列依赖、循环检测和单元格错误定位，上传和错误行纠正共用。原始公式保存于导入行，纠错时重算全部依赖；模板列顺序使用版本定义，不依赖 JSON 字段顺序。公式最多 1024 字符、128 个 AST 节点；ROUND 位数为 -16 至 16 的整数，EDATE 使用整数月数和合法日期。新增函数需在统一函数表中实现并补行为验证；未支持的函数、范围、跨行、跨表或外部引用明确报错。考勤/绩效导入继续使用各自已确认的公式拒绝策略。

### 试算、确认和失效

普通工资试算可以在各主体数据未齐时展示部分结果，但这类试算不能直接确认成最终工资。考勤激励必须等待本期全公司数据齐全后统一计算。确认前，批次内全体员工必须通过校验；缺绩效系数、缺城市规则或未包含最终激励时不能用“只确认正确员工”绕过门槛。

薪资、考勤、绩效、base 地或规则等计算输入发生变化后，旧 trial 必须失效。service 应比较 trial 输入指纹/版本和当前版本，而不是只看批次当前状态。

### 全公司考勤激励

考勤激励是跨主体期间用例，不能放进“计算单一主体工资”的浅层函数。service 负责加载上月所有主体锁定后的考勤扣款、本月各主体候选员工和规则快照；domain 只接收已规范化的期间输入，计算激励池、合格名单、两位小数分配和最后一名尾差，并返回每位员工的 `PayrollItemResult` 与步骤。

激励结果应明确记录来源期间、锁定批次和候选条件。没有合格员工时不生成项目，但要生成可追溯提示。激励计入应发和未扣个税前的系统工资金额，不计入社保或公积金基数。

### 整批更正

更正不是替换某一个员工的行。service 从已确认/锁定的原批次创建完整替换批次，以原确认试算快照作为历史输入基线，仅叠加带来源说明的考勤与绩效修正输入；薪酬和规则沿用原快照。替代批次重新试算、计算激励、确认和锁定全员，锁定时自动原子切换有效版本。期间汇总只取最新有效版本，原批次及其快照保留追溯；独立补发使用独立批次，不当作更正。已实际发薪后的差额由线下处理，系统不自动生成下月补发或扣回。

`correction_batch.input_overrides` 保存每次输入修正、来源说明和时间；`payroll_batch.is_effective` 与部分唯一索引限制主体期间的当前有效正常批次。锁定事务中 service 复核确认试算指纹、激励完整性、锁定状态及原批次全员覆盖，台账按有效标记筛选。

### 个税和导出

系统不计算个税，也不新增个税回填流程。系统导出的金额应标识为“未扣个税金额”，不是最终实际到账金额。没有外部税务来源的数据保持空值并写入导出 warning，不把未知税额解释为零。整批校验通过后可以导出供 Excel 线下扣税和核对；导出文件在人工核对前不称为最终发薪文件。

## 8. 最新业务决策的实现对应

| 业务约束 | 当前实现依据 |
| --- | --- |
| 固定薪资 80%/绩效基数 20%、试用期无绩效、转正固定薪资不变 | 员工 DTO/API 校验及 `domain/payroll.py` |
| 普通调薪整月、自然日折算、跨主体调动报错 | 员工生效日期校验、期间输入快照、普通试算 service/domain |
| 城市统一社保固定基数、公积金固定薪资 5%/5% | 0002、规则维护及纯计算；公司成本与个人扣缴分离 |
| 输入/规则变化后旧试算失效 | 期间输入修订号、试算 input_fingerprint、最新版本与 viewed_at 校验 |
| 全公司就绪和上月锁定激励来源 | 0007、attendance_incentive_run、激励 service 和确定性分配 |
| 全员通过才确认、确认后不可变 | 0008、确认 service、工资记录与子明细触发器 |
| 整批更正保留历史、不改锁定结果 | 0009、input_overrides、批次 is_effective 原子切换；仅改考勤/绩效 |
| 独立补发不重算社保公积金/激励 | 0010、supplement_inputs、独立试算确认锁定、有效台账合并 |
| 四类导出只取有效锁定结果 | 导出 service 短事务、生成/下载复核、模板与来源报告；更正/补发回归 |
| 个税未知留空、系统金额未扣税 | DTO/页面/Excel 明确未扣个税口径，external_tax_data/source 保留可空 |

历史解释使用工资快照，不读取当前员工资料覆盖旧事实。全套后端 73 项回归通过，但前端员工历史计算明细、首页进度和人工验收仍有缺口，详见 [需求完成情况核查](mvp-completion-2026-10-03.md)。

## 9. 最新八条业务约束（实现依据）

下面八条来自 `CONTEXT.md`、`docs/product.md` 及 Obsidian 的最新合并记录；和旧架构描述冲突时以本节为准。它们是业务约束，不表示当前代码已经实现。

1. **整批更正**：确认后发现错误时，生成整个原工资批次的新版本，重新确认批次内全体员工；不是只替换出错员工。新版本生效后，期间汇总取该批次最新有效版本，旧版本保留追溯。独立补发不等同于更正；已实际发薪后的更正差额在线下处理，系统不自动生成下月补发或扣回。
2. **薪酬结构与转正**：薪酬标准由固定薪资 80% 和绩效基数 20% 组成；试用期只有固定薪资、不考核绩效、不发绩效奖金，也无需绩效记录，同一员工转正前后固定薪资保持不变。转正当月绩效基数整月采用转正后标准，实际绩效金额为该基数乘以当月绩效系数。普通员工加减薪按适用工资期间整月处理，不按月中操作日拆段；入离职、主体和部门调动仍按生效日期处理。日折算使用当月自然日天数，变更当天按新标准；旧例中的 8,000/10,000 只说明折算方法，不代表转正必然涨薪。
3. **整批校验门槛**：导入允许正确行先导入、错误行保留待修；试算允许展示部分员工结果，但批次全体员工必须全部通过校验，才能确认和正式导出。需考核绩效的员工缺系数、缺城市规则等错误不能通过只确认其余员工绕过；影响输入修复后必须重新试算。
4. **全公司激励**：各主体数据未齐时可以先试算普通工资；考勤激励等待本期全公司数据齐全后统一计算。尚未包含最终激励的试算不是可直接确认的最终工资结果。当前不设计跨月修改上月工资或扣款并联动已确认激励的流程。
5. **个税暂由人工处理**：个税后续手工计算，当前不增加系统个税计算或专门回填流程。系统导出未扣个税的工资结果，用户在 Excel 中手工计算并扣税、核对后用于实际发薪，暂不回填系统。系统金额标识为“未扣个税金额”，不是最终实际到账金额；无来源税务字段留空并提示，不把未知税额解释为零。整批校验通过后允许导出供线下处理，但人工核对前不视为最终发薪文件。
6. **试算失效**：薪资、考勤等影响计算的输入变化后，旧试算失效；必须重新试算并查看结果后才能确认，不允许确认旧试算。
7. **社保基数**：采用城市配置的统一固定缴费基数，与员工薪资、试用期或转正无关；按员工 base 地匹配城市，不作员工薪资折算。统一的是缴费基数，不是直接固定每项缴费金额。
8. **公积金**：以员工固定薪资为基数，个人、公司单边比例各为 5%，合计 10%；个人部分作为工资扣款，公司部分计入公司成本，不从员工工资扣除。固定薪资为薪酬标准的 80%，绩效不计入公积金基数。

## 10. 验证与交付状态

核心工资用例与四类 Excel 已实现；2026-10-03 在隔离 PostgreSQL 16 `paylite_test` 上完整后端 73 项、前端 41 项及前端生产构建通过。Ruff lint、两条 import-linter contract 和编译检查通过；后端 1 文件与前端 7 文件格式检查失败。本次后端镜像因 Docker Hub 连接超时未构建成功。

04 用户页面验收、10 正式台账员工计算明细、首页月度工作台与真实工资人工对账尚未完成。不能据自动化通过宣称所有页面/业务实数验收完成。

## 11. 运行与数据边界

本地 Compose 使用 PostgreSQL 16，宿主机默认映射 `127.0.0.1:15432`，Backend 默认 `127.0.0.1:31000`（容器内仍为 8000）。Backend 容器先执行 `alembic upgrade head`，成功后才启动 Uvicorn。数据保留在本机，不上传云端；测试使用独立数据库并允许测试 teardown 执行 downgrade。

后续迁移必须新增 Alembic revision，并同步保留可审查 SQL。初始 SQL 和 ORM 是当前 schema 的实现资料，不是业务规则的唯一来源；业务规则仍由领域 dataclass、用例门槛和计算步骤共同表达。

相关资料（本机协作路径）：

- [领域上下文](</Users/hyperchain/Desktop/ai_lession/hr/CONTEXT.md>)
- [产品决策](</Users/hyperchain/Desktop/ai_lession/hr/docs/product.md>)
- [数据库设计](</Users/hyperchain/Desktop/ai_lession/hr/docs/database-design.md>)
- [当前接口文档](</Users/hyperchain/Documents/Obsidian Vault/PayLite/PayLite 接口文档.md>)
- [数据表设计](</Users/hyperchain/Documents/Obsidian Vault/PayLite/PayLite 数据表文档.md>)

## 2026-10-04 正式明细与本机托管

`GET /payroll/ledger/records/{record_id}` 读取正式工资快照、保存的 trial.input_snapshot 考勤、items/steps 和该员工历史版本；旧更正版本允许追溯，汇总仍只取有效正式结果。考勤扣款以 Decimal 累加 category=deduction 的 attendance_* 项，激励收入不混入。工作台返回只读 trial_summary，读取不修改 latest_trial_viewed_at。导入、试算、导出和正式详情响应已显式定义 DTO，供前端完整生成契约。

配置 `PAYLITE_FRONTEND_DIRECTORY` 后由 FastAPI 托管前端构建产物，所有业务 API 增加 `/api` 前缀，`/health` 保留兼容，未知 `/api/*` 返回404；SPA深链接返回 index.html。配置的构建目录缺少 index.html 时拒绝启动。未配置时保留原路径并提供隐藏于 OpenAPI 的 `/api` 别名。Compose 只读挂载 frontend/dist，因此启动前须先构建前端。

本轮未变更 schema 或迁移；完整 77 项测试通过（含隔离 PostgreSQL），静态检查与依赖检查通过。标准 Dockerfile 基础镜像获取失败，缓存依赖的最新源码运行镜像验证通过，二者明确分开记录，见 [当前验收](mvp-completion-2026-10-03.md)。
