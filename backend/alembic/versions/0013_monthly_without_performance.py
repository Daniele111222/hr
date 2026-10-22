"""Allow monthly payroll without performance data; preserve historical values."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0013_monthly_without_performance"
down_revision: str | Sequence[str] | None = "0012_company_monthly_import"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    sql = Path(__file__).resolve().parents[2] / "sql" / "013_monthly_without_performance.sql"
    op.execute(sql.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM employee_salary WHERE performance_base IS NULL)
               OR EXISTS (SELECT 1 FROM payroll_record WHERE snapshot_performance_base IS NULL)
            THEN RAISE EXCEPTION '月度不含绩效数据无法回退为绩效必填，回退已拒绝';
            END IF;
        END $$;
        ALTER TABLE payroll_record ALTER COLUMN snapshot_performance_base SET NOT NULL;
        ALTER TABLE employee_salary ALTER COLUMN performance_base SET NOT NULL;
    """)
