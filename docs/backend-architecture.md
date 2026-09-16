# PayLite 后端架构

> 文档版本：v0.2（2026-09-16）  
> 适用仓库：`/Users/hyperchain/Desktop/ai_lession/hr`  
> 架构基线：当前后端只有 `GET /health` 和初始 SQLAlchemy ORM；业务接口与算薪代码尚未实现。

这份文档描述当前仓库可以被代码证明的事实、下一阶段要落地的代码接口，以及业务决策对后端的约束。规划中的目录和流程不代表已经存在的实现。

## 1. 事实基线

当前后端使用 Python 3.13、FastAPI、Uvicorn、Pydantic Settings、SQLAlchemy 2.x、Alembic 和 psycopg 3。服务入口在 `backend/src/paylite/main.py`，当前只注册 `/health`；没有员工、导入、试算、确认、锁定、台账、更正或导出接口。

当前已落地的应用与持久化部分包括：

- `application.py` 的 `create_app()` 工厂、`api/system.py` 的系统路由，以及由 `main.py` 暴露的 ASGI app；
- `db/base.py` 的 SQLAlchemy `Base`；
- `db/session.py` 的 engine、`SessionLocal` 和 `get_session` 生成器；
- 按组织、员工、月度输入、规则、工资和导出主题拆分的 ORM 模型包；
- `backend/sql/001_initial_schema.sql` 和 Alembic `0001_initial_schema`；
- PostgreSQL 约束、日期区间排斥约束、更新时间触发器、部门树防循环触发器和锁定工资结果不可变触发器；
- 模型约束测试、应用工厂/健康检查测试和 PostgreSQL 集成测试；
- `import-linter` 开发依赖，以及 CI 中对当前数据库层导入边界的检查。

当前尚未落地：

- `api` 业务路由、Pydantic 请求/响应 DTO、统一业务错误映射；
- `services` 用例编排、状态流转和业务事务；
- `domain` 领域 dataclass、Decimal 计算函数和计算追溯；
- Excel 导入/导出适配器；
- 业务 Repository 或查询服务。

仓库当前的后端依赖中没有 `openpyxl`；Excel 适配器仍是后续实现。`import-linter` 已加入开发依赖并由 CI 执行，但当前 contract 只覆盖已存在的 `db`、`api`、`application` 和 `config` 之间的导入禁令，不能把它扩大解释成完整分层检查。

真实 CI 位于 `.github/workflows/backend-ci.yml`：在 Python 3.13 和 PostgreSQL 16 下安装 `.[dev]`，执行 Ruff 检查、Ruff 格式检查、`lint-imports`、`compileall` 和 pytest；测试通过后构建带 commit SHA 的 Docker 镜像。当前 workflow 没有发布镜像或部署生产环境。

## 2. 架构结论

PayLite 采用本地优先的分层单体。HTTP、数据库和文件系统属于外壳；算薪规则在后续实现中放进不依赖 FastAPI、SQLAlchemy 或 Excel 的纯计算核心。当前代码量很小，所以只建立真实需要的模块，不预先创建没有行为的 `services`、`domain` 或 `excel` 空目录。

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

## 3. 目录职责

本次重构已经落地应用工厂、系统路由和 ORM 分包；业务用例包仍在规划中，不预建空壳。目标形状如下：

```text
backend/src/paylite/
├── main.py                         # 暴露 create_app() 创建的 ASGI app
├── application.py                  # 应用工厂，组装路由和应用级配置
├── config.py                       # Settings 与 PAYLITE_* 环境变量
├── api/                            # HTTP 外部接口（当前已落地 system.py）
│   ├── system.py                   # /health
│   ├── deps.py                     # 规划：get_session 等请求依赖
│   ├── errors.py                   # 规划：领域/持久化错误到 HTTP 错误
│   ├── schemas/                    # 规划：Pydantic v2 请求和响应 DTO
│   └── routes/                     # 规划：按资源或用例拆分路由
├── db/
│   ├── base.py                     # Declarative Base
│   ├── session.py                  # engine、sessionmaker、会话生成器
│   └── models/                     # 已落地：ORM 按主题分包
│       ├── __init__.py             # 保留 paylite.db.models 的公开导入路径
│       ├── common.py               # 金额/比例类型和通用列辅助函数
│       ├── organization.py         # company、city、subject、department
│       ├── employees.py            # employee 及任职/薪酬/base/银行卡
│       ├── payroll.py              # period、batch、record、item、trace
│       ├── imports.py              # import_batch、import_row、月度输入
│       ├── rules.py                # 社保、公积金、考勤规则
│       └── exports.py              # export/warning；CorrectionBatch 在 payroll.py
├── services/                       # 规划：用例和事务编排，不预建空包
├── domain/                         # 规划：纯计算核心
│   ├── shared/                     # 金额、期间、枚举、状态迁移
│   └── payroll/                    # 薪酬、考勤、社保、激励计算
└── excel/                          # 规划：固定模板导入/导出适配器，不预建空包
    ├── importers/
    └── exporters/
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

DTO 按用例设计，例如：

- `ImportCreateRequest` / `ImportSummaryResponse`：文件元数据、模板版本和行级结果；
- `PayrollTrialRequest` / `PayrollTrialResponse`：试算结果、失败员工和是否已包含全公司激励；
- `PayrollRecordResponse` / `PayrollItemResponse` / `CalculationDetailResponse`：历史快照、工资项目和公式追溯；
- `CorrectionCreateRequest`：原批次和更正原因；
- `ExportCreateRequest` / `ExportResponse`：输出类型、模板版本、警告和文件状态。

这些类型在业务接口落地时创建；当前 `api/system.py` 的 `/health` 仍返回简单的 `{"status": "ok"}`。

### 领域 dataclass

领域输入应是不可变或不被调用方修改的 dataclass，至少包含：

- `EmployeeSnapshot`：员工标识、主体、部门、职位、职级、正式/转正状态、入离职和当期薪酬；
- `SalaryInput`：固定薪资、绩效基数、适用期间和转正/生效信息；
- `AttendanceFact`：应出勤天数、迟到/早退分钟、有薪/无薪假、忘打卡及补卡事实；
- `PerformanceFact`：非负绩效系数和原始来源；
- `SocialSecurityRule`、`HousingFundRule`、`AttendanceRule`：按期间解析后的规则快照；
- `PayrollCalculationInput`：一名员工的完整输入；全公司激励另接收跨主体的期间输入；
- `PayrollCalculationResult`：金额汇总、`PayrollItemResult` 项目、`CalculationStep` 步骤、警告和可确认性。

API mapper 先把请求 DTO 构建成不依赖 Pydantic 的用例命令；service 从 ORM 读取并组装领域 dataclass，再把领域结果持久化，最后由 API mapper 构建响应 DTO。领域函数只接收这些规范化值并返回结果，不从 Session 查数据。任何一条金额都应能沿着工资项目和计算步骤追溯到输入事实与规则版本。中间计算使用 `Decimal`，项目和最终金额按产品约定保留两位并四舍五入。

### ORM model

ORM model 只表达 PostgreSQL 表、外键、唯一约束、索引、日期区间和数据库不可变约束。当前模型仍是初始 schema 的持久化骨架，不能被当成已经完成的工资用例实现。

## 5. Session 与事务生命周期

当前 `get_session` 已经以 `SessionLocal()` 上下文创建并在请求结束时关闭；由于当前只有 health 路由，没有业务请求使用它。业务接口接入时沿用“一次请求一个 Session”，不共享全局 Session，也不把 Session 放进领域函数。

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
- 保留数据库的唯一索引作为最终防线：当前 schema 的正常批次主体+期间唯一、同一期间/员工输入唯一、同一期间+导入类型+文件哈希拒绝重复、工资记录批次内员工唯一。需要注意，当前正常批次 partial unique index 不允许同一主体+期间仅通过改变 `batch_no` 并存第二个 `normal` 批次；旧接口文档中“重复后改变 `batch_no` 重试”的示例不能视为已支持行为。
- 状态迁移通过显式合法迁移表校验：`draft → trial → confirmed → locked → exported`；取消、更正和导出失败按用例定义，不允许路由直接改字符串绕过校验。
- 当前数据库触发器保护 `locked`/`superseded` 工资记录及其项目、计算步骤；更正创建新批次，不直接重写旧快照。原锁定记录如何受控地转为 `superseded`，要等后续迁移解决触发器冲突。

当前 schema 已覆盖部分唯一约束、行锁可用的主键和锁定后不可变触发器，但没有输入版本/指纹、服务级动作锁或业务状态用例；这些属于业务接口落地时的必做项。

## 7. 业务用例与计算核心

### 导入与数据质量

Excel 导入应由 `excel.importers` 读取固定模板、计算文件哈希、保存原始文件信息和字段映射，再把每行转成规范化输入。正确行可以先导入，错误行保留 `raw_data`、列位置和错误码；导入层返回 `ImportResult`，不把行级错误当成整个请求的未捕获异常。绩效缺失、城市规则缺失等会影响正式工资的错误必须在试算和确认门槛中体现。

`openpyxl` 只在真正实现 `.xlsx` 适配器时加入后端依赖；固定模板和 `.xls` 转换策略是产品决策，当前代码尚未提供该能力。

### 试算、确认和失效

普通工资试算可以在各主体数据未齐时展示部分结果，但这类试算不能直接确认成最终工资。考勤激励必须等待本期全公司数据齐全后统一计算。确认前，批次内全体员工必须通过校验；缺绩效系数、缺城市规则或未包含最终激励时不能用“只确认正确员工”绕过门槛。

薪资、考勤、绩效、base 地或规则等计算输入发生变化后，旧 trial 必须失效。service 应比较 trial 输入指纹/版本和当前版本，而不是只看批次当前状态。

### 全公司考勤激励

考勤激励是跨主体期间用例，不能放进“计算单一主体工资”的浅层函数。service 负责加载上月所有主体锁定后的考勤扣款、本月各主体候选员工和规则快照；domain 只接收已规范化的期间输入，计算激励池、合格名单、两位小数分配和最后一名尾差，并返回每位员工的 `PayrollItemResult` 与步骤。

激励结果应明确记录来源期间、锁定批次和候选条件。没有合格员工时不生成项目，但要生成可追溯提示。激励计入应发和未扣个税前的系统工资金额，不计入社保或公积金基数。

### 整批更正

更正不是替换某一个员工的行。service 从已确认/锁定的原批次创建完整替换批次，重新加载并计算批次内全体员工，再通过确认/锁定流程使替换批次生效。期间汇总只取该批次最新有效版本，原批次及其快照保留追溯；独立补发使用独立批次，不当作更正。已实际发薪后的差额由线下处理，系统不自动生成下月补发或扣回。

当前 `correction_batch` 只有原批次到替换批次的关系和状态，数据库还没有强制“替换批次必须覆盖原批次全体员工”或“应用后期间只取最新有效版本”；这必须由 service 和后续迁移/约束补齐。

### 个税和导出

系统不计算个税，也不新增个税回填流程。系统导出的金额应标识为“未扣个税金额”，不是最终实际到账金额。没有外部税务来源的数据保持空值并写入导出 warning，不把未知税额解释为零。整批校验通过后可以导出供 Excel 线下扣税和核对；导出文件在人工核对前不称为最终发薪文件。

## 8. 当前 ORM 与最新决策的差距

初始模型为业务骨架，不能把字段存在误写成规则已经实现。以下差距在实现业务接口和迁移时显式处理：

| 最新口径 | 当前 schema/代码事实 | 后续处理 |
| --- | --- | --- |
| 整批更正、最新版本汇总 | 有 `correction_batch` 关系和工资记录状态，但没有复制全批、应用更正和最新有效版本的 service | 先由用例保证全批覆盖和汇总取值，再补必要约束/索引和集成测试 |
| 更正时原批次转为 `superseded` | 当前锁定工资记录触发器在 `OLD.calculation_status IN ('locked', 'superseded')` 时拒绝任何更新；因此它也会阻止把锁定记录更新为更正后的 `superseded` 状态 | 后续新增迁移调整为受控的替代关系/状态变更，或改用批次级有效性标记；不修改初始迁移文件 |
| 正常批次版本并存 | `uq_payroll_batch_normal` 对 `batch_type = 'normal'` 只允许同一主体+期间一条记录，改变 `batch_no` 仍会冲突 | 设计更正版本时新增迁移调整唯一性；旧接口文档的重复重试示例在此之前不可实现 |
| 固定薪资 80% + 绩效基数 20%，试用期无绩效；转正当月绩效基数整月采用转正后标准 | `employee_salary` 只有 `fixed_salary`、`performance_base` 字段，没有比例校验或算薪代码 | 领域输入明确固定薪资、绩效基数、转正状态；由计算函数执行口径并保存步骤 |
| 普通加减薪按适用期间整月；入离职、主体/部门变化按生效日期处理 | 任职、薪酬等表有生效日期区间，但没有读取区间和工资折算实现 | 在 service 形成期间快照，domain 实现生效日期和自然日折算；未决极端值单独配置 |
| 全体校验通过才确认/正式导出 | 批次和导入行有状态列，但没有确认/导出路由或门槛检查 | service 汇总全批错误和依赖完整性，失败时不改变确认状态 |
| 激励等待全公司数据齐全，跨主体统一分配 | 可用 `payroll_item` 存项目，但没有激励池实体、候选快照或计算流程 | 增加期间级用例和来源追溯；是否需要独立表由第一条竖切验证后决定 |
| 公司+期间的激励就绪协调 | 当前没有公司期间级“全主体数据是否齐全/激励是否已计算”的协调记录或 service；单个主体批次状态不足以表达全公司门槛 | 新增期间级协调用例/持久化版本，锁定顺序固定，并将激励结果来源写入追溯 |
| 试算输入变化后失效 | `payroll_batch` 有 status/updated_at，但没有计算输入版本或指纹字段 | 增加输入版本/哈希或等价的持久化快照，确认时强校验 |
| 社保采用员工 base 地对应城市的统一固定缴费基数，与员工薪资无关 | 社保明细只有 `base_min`/`base_max`；没有统一固定 base 字段和计算实现，旧文档曾把固定薪资当基数 | 新迁移明确城市固定基数的存储/来源；domain 禁止从员工薪资推导社保基数 |
| 公积金以员工固定薪资为基数，个人/公司各 5%，绩效不计入 | `housing_fund_rule` 要求 `base_min`/`base_max` 且比例可变；没有 5% 约束或工资计算。旧模型的必填上下限和可变比例不能未经确认地继续作为 `fixed_salary × rate` 的 clamp 规则 | 领域函数使用员工固定薪资快照，校验 5%/5% 配置；由后续迁移明确上下限是否仍有业务意义，保留公司成本与个人扣款分开 |
| 个税线下人工处理，系统金额未扣税 | `payroll_record.net_amount` 名称容易被理解为实发，另有可空 `external_tax_data/source` | DTO、页面和导出明确“未扣个税金额”；必要时新增语义字段/迁移，不把未知税额写成 0 |

此外，当前员工主表只保留最新资料，工资结果通过 `snapshot_*` 保存历史解释所需的信息；这符合已确认的“员工资料不建完整历史版本”决定。任何新接口都必须继续依赖工资快照解释历史，不回读当前员工资料覆盖旧结果。

当前 SQL 的锁定触发器只保护 `locked` 和 `superseded` 记录，并没有把 `confirmed` 记录声明为数据库级不可变；按已确认的产品要求，确认后的业务内容即不可直接修改。后续 migration 需补齐受控状态迁移，再由 service 统一执行。

## 9. 最新八条业务约束（实现依据）

下面八条来自 `CONTEXT.md`、`docs/product.md` 及 Obsidian 的最新合并记录；和旧架构描述冲突时以本节为准。它们是业务约束，不表示当前代码已经实现。

1. **整批更正**：确认后发现错误时，生成整个原工资批次的新版本，重新确认批次内全体员工；不是只替换出错员工。新版本生效后，期间汇总取该批次最新有效版本，旧版本保留追溯。独立补发不等同于更正；已实际发薪后的更正差额在线下处理，系统不自动生成下月补发或扣回。
2. **薪酬结构与转正**：薪酬标准由固定薪资 80% 和绩效基数 20% 组成；试用期只有固定薪资、没有绩效，同一员工转正前后固定薪资保持不变。转正当月绩效基数整月采用转正后标准，实际绩效金额为该基数乘以当月绩效系数。普通员工加减薪按适用工资期间整月处理，不按月中操作日拆段；入离职、主体和部门调动仍按生效日期处理。日折算使用当月自然日天数，变更当天按新标准；旧例中的 8,000/10,000 只说明折算方法，不代表转正必然涨薪。
3. **整批校验门槛**：导入允许正确行先导入、错误行保留待修；试算允许展示部分员工结果，但批次全体员工必须全部通过校验，才能确认和正式导出。缺绩效系数、缺城市规则等错误不能通过只确认其余员工绕过；影响输入修复后必须重新试算。
4. **全公司激励**：各主体数据未齐时可以先试算普通工资；考勤激励等待本期全公司数据齐全后统一计算。尚未包含最终激励的试算不是可直接确认的最终工资结果。当前不设计跨月修改上月工资或扣款并联动已确认激励的流程。
5. **个税暂由人工处理**：个税后续手工计算，当前不增加系统个税计算或专门回填流程。系统导出未扣个税的工资结果，用户在 Excel 中手工计算并扣税、核对后用于实际发薪，暂不回填系统。系统金额标识为“未扣个税金额”，不是最终实际到账金额；无来源税务字段留空并提示，不把未知税额解释为零。整批校验通过后允许导出供线下处理，但人工核对前不视为最终发薪文件。
6. **试算失效**：薪资、考勤等影响计算的输入变化后，旧试算失效；必须重新试算并查看结果后才能确认，不允许确认旧试算。
7. **社保基数**：采用城市配置的统一固定缴费基数，与员工薪资、试用期或转正无关；按员工 base 地匹配城市，不作员工薪资折算。统一的是缴费基数，不是直接固定每项缴费金额。
8. **公积金**：以员工固定薪资为基数，个人、公司单边比例各为 5%，合计 10%；个人部分作为工资扣款，公司部分计入公司成本，不从员工工资扣除。固定薪资为薪酬标准的 80%，绩效不计入公积金基数。

## 10. 落地顺序与验证

1. **已完成** ORM 分包、应用工厂、系统路由和公开模型导入路径兼容；后续保持迁移/测试可运行。
2. 接入 API 的 session dependency、统一错误映射和真实的状态迁移接口；先以一条业务竖切验证 service 的事务边界。
3. 先实现规范化导入和考勤扣款试算，再扩展绩效、社保、公积金与跨主体激励；领域函数用 fixture 测试，不依赖数据库。
4. 为确认、锁定、输入失效、整批更正和期间汇总增加 PostgreSQL 集成测试，特别覆盖重复请求和并发锁。
5. 真实需要 Excel 文件时再加入 `openpyxl` 及模板适配器，并为四个模板分别做结构/样式回归；不要先创建空的 Excel 框架。
6. 每次后端变更继续通过 Ruff、`lint-imports`、`compileall`、pytest、PostgreSQL 集成测试和 Docker 构建；新增层级 contract 时必须同步更新真实配置和开发依赖。

本次结构优化验证记录：pytest 结果为 `9 passed, 7 skipped`（7 项因本机没有 PostgreSQL 测试库而跳过）；Ruff check、`lint-imports`、`compileall` 通过；本次修改文件的 Ruff format check 通过，全仓格式检查仍受用户既有 `backend/src/paylite/__init__.py` 格式问题影响，未修改。Docker 构建未运行。ORM 拆分前后生成的 PostgreSQL DDL 均为 472 行且 SHA 相同，未引入 schema 漂移。

## 11. 运行与数据边界

本地 Compose 使用 PostgreSQL 16，宿主机默认映射 `127.0.0.1:55432`，Backend 默认 `127.0.0.1:8000`。Backend 容器先执行 `alembic upgrade head`，成功后才启动 Uvicorn。数据保留在本机，不上传云端；测试使用独立数据库并允许测试 teardown 执行 downgrade。

后续迁移必须新增 Alembic revision，并同步保留可审查 SQL。初始 SQL 和 ORM 是当前 schema 的实现资料，不是业务规则的唯一来源；业务规则仍由领域 dataclass、用例门槛和计算步骤共同表达。

相关资料（本机协作路径）：

- [领域上下文](</Users/hyperchain/Desktop/ai_lession/hr/CONTEXT.md>)
- [产品决策](</Users/hyperchain/Desktop/ai_lession/hr/docs/product.md>)
- [数据库设计](</Users/hyperchain/Desktop/ai_lession/hr/docs/database-design.md>)
- [接口设计（规划）](</Users/hyperchain/Documents/Obsidian Vault/PayLite/PayLite 接口文档.md>)
- [数据表设计](</Users/hyperchain/Documents/Obsidian Vault/PayLite/PayLite 数据表文档.md>)
