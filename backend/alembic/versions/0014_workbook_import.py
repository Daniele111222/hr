"""Link an original whole workbook to employee and attendance input batches."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0014_workbook_import"
down_revision: str | Sequence[str] | None = "0013_monthly_without_performance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    sql = Path(__file__).resolve().parents[2] / "sql" / "014_workbook_import.sql"
    op.execute(sql.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM workbook_import)
               OR EXISTS (SELECT 1 FROM import_batch WHERE import_type = 'workbook_employee')
            THEN RAISE EXCEPTION '整本导入来源无法无损回退，回退已拒绝';
            END IF;
        END $$;
        DROP TABLE workbook_import;
        ALTER TABLE import_batch DROP CONSTRAINT ck_import_batch_type;
        ALTER TABLE import_batch ADD CONSTRAINT ck_import_batch_type CHECK (
            import_type IN ('employee_master', 'attendance', 'performance')
        );
    """)
