# PostgreSQL 数据层说明

## 目标

PayLite 当前使用本机 PostgreSQL 保存单一目标公司的工资数据。后端通过 SQLAlchemy 2.x 访问数据库，Alembic 管理迁移，驱动为 psycopg 3。

## 目录

- `backend/src/paylite/db/models/`：按主题拆分的规范化 SQLAlchemy 模型；`models/__init__.py` 保持公开导入路径。
- `backend/alembic/versions/0001_initial_schema.py`：应用迁移入口。
- `backend/sql/001_initial_schema.sql`：可独立审查和执行的 PostgreSQL DDL，保留具体 SQL 语句。

## 实体关系

- `company` → `subject`、`department`、`employee`。
- `department` 通过 `subject_department` 映射到工资归属主体。
- `employee` 的生效关系拆为 `employee_assignment`、`employee_salary`、`employee_base` 和 `employee_bank_account`，支持月中变化。
- `payroll_period` → `payroll_batch`；批次属于主体和工资期间。
- `import_batch` / `import_row` 保存原始文件和逐行校验；`attendance_record`、`performance_record` 保存规范化月度输入。
- `payroll_record` 保存员工工资结果和计算时快照；`payroll_item`、`payroll_calculation_detail` 保存项目和计算依据。
- `correction_batch` 关联原批次与替代批次；`export_batch` / `export_warning` 保存输出和留空提示。

## 关键约束

- 身份证号码使用 `TEXT`，并在公司范围内唯一。
- 正常工资批次通过 PostgreSQL partial unique index 保证同一主体同一期间只有一个；补发和其他批次使用独立批次类型/批次号。
- 导入文件哈希按工资期间和导入类型唯一：同期间同类型重复文件被拒绝，跨期间可以保存为新批次。
- 导入工作表/行号、规则城市/生效起始日均有唯一约束。
- 金额使用 `NUMERIC(18, 2)`；绩效系数、比例和中间数量使用更高精度 `NUMERIC`。
- 生效区间使用 PostgreSQL `EXCLUDE USING gist` 防止同一员工、城市或全局规则的有效日期重叠，并通过 `btree_gist` 扩展支持。
- 工资期间强制要求 `year`、`month`、期间起止日期互相一致，起始日为月初、结束日为月末。
- 工资记录通过复合外键保证其主体和期间与所属批次一致；主体部门实例通过公司复合外键防止跨公司混用。
- PostgreSQL trigger 自动刷新员工和工资批次的 `updated_at`，并禁止锁定或已替代工资结果及其项目、计算明细被直接更新、删除或追加；修正必须创建新批次。
- `external_tax_data` 只表达外部税务字段，系统不计算个税。

## SQL 与 Alembic

`backend/sql/001_initial_schema.sql` 是初始 schema 的可审查 SQL 真源。Alembic 初始迁移逐条读取并执行同一文件，因此不会再出现手写 DDL 和 ORM 建表之间的双真源漂移。

日常优先使用 Alembic：

```bash
cd backend
alembic upgrade head
```

如果确实直接执行 SQL 文件：

```bash
psql "$PAYLITE_DATABASE_URL" -f backend/sql/001_initial_schema.sql
cd backend
alembic stamp 0001_initial_schema
```

直接执行 SQL 不会自动写入 `alembic_version`；必须执行 `alembic stamp` 后才能继续使用后续迁移。

## 测试数据库安全

PostgreSQL 集成测试会执行 downgrade 并删除测试表。`PAYLITE_TEST_DATABASE_URL` 必须指向名称包含 `test` 的专用数据库，且必须显式设置 `PAYLITE_ALLOW_TEST_DATABASE_RESET=1`。禁止指向默认开发库 `paylite`、系统库或未命名数据库。

## 本地开发数据库

仓库根目录提供 `docker-compose.yml`。启动 PostgreSQL 后，将 `PAYLITE_DATABASE_URL` 指向本地数据库，再执行 Alembic 迁移。
