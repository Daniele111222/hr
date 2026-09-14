"""Create the initial PayLite PostgreSQL schema.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-09-13
"""

from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa
import sqlparse
from alembic import op

revision: str = "0001_initial_schema"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


SQL_FILE = Path(__file__).resolve().parents[2] / "sql" / "001_initial_schema.sql"

DROP_TRIGGERS = (
    "DROP TRIGGER IF EXISTS trg_payroll_calculation_immutable_after_lock "
    "ON payroll_calculation_detail",
    "DROP TRIGGER IF EXISTS trg_payroll_item_immutable_after_lock ON payroll_item",
    "DROP TRIGGER IF EXISTS trg_payroll_record_immutable_after_lock ON payroll_record",
    "DROP TRIGGER IF EXISTS trg_department_no_cycle ON department",
    "DROP TRIGGER IF EXISTS trg_payroll_batch_updated_at ON payroll_batch",
    "DROP TRIGGER IF EXISTS trg_employee_updated_at ON employee",
)

DROP_FUNCTIONS = (
    "DROP FUNCTION IF EXISTS prevent_locked_payroll_child_mutation()",
    "DROP FUNCTION IF EXISTS prevent_locked_payroll_record_mutation()",
    "DROP FUNCTION IF EXISTS prevent_department_cycle()",
    "DROP FUNCTION IF EXISTS set_updated_at()",
)

DROP_TABLES = (
    "export_warning",
    "export_batch",
    "correction_batch",
    "payroll_calculation_detail",
    "payroll_item",
    "payroll_record",
    "import_row",
    "attendance_rule",
    "housing_fund_rule",
    "social_security_item_rule",
    "social_security_rule",
    "performance_record",
    "attendance_record",
    "import_batch",
    "payroll_batch",
    "payroll_period",
    "employee_base",
    "employee_bank_account",
    "employee_salary",
    "employee_assignment",
    "subject_department",
    "employee",
    "department",
    "subject",
    "city",
    "company",
)


def load_initial_schema_statements() -> list[str]:
    return [
        statement.strip()
        for statement in sqlparse.split(SQL_FILE.read_text(encoding="utf-8"))
        if statement.strip()
    ]


def upgrade() -> None:
    connection = op.get_bind()
    for statement in load_initial_schema_statements():
        connection.exec_driver_sql(statement.replace("Payroll record %", "Payroll record %%"))


def downgrade() -> None:
    for statement in DROP_TRIGGERS:
        op.execute(sa.text(statement))
    for statement in DROP_FUNCTIONS:
        op.execute(sa.text(statement))
    for table_name in DROP_TABLES:
        op.execute(sa.text(f"DROP TABLE IF EXISTS {table_name} CASCADE"))
    op.execute(sa.text("DROP EXTENSION IF EXISTS btree_gist"))
