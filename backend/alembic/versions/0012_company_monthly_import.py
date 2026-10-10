"""Record company-wide monthly imports and each row's payroll destination."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0012_company_monthly_import"
down_revision: str | Sequence[str] | None = "0011_duplicate_employee_ids"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    sql = Path(__file__).resolve().parents[2] / "sql" / "012_company_monthly_import.sql"
    op.execute(sql.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM import_batch
                       WHERE company_id IS NOT NULL AND import_type IN ('attendance', 'performance')
                         AND payroll_batch_id IS NULL)
               OR EXISTS (SELECT 1 FROM import_batch WHERE company_id IS NOT NULL
                          GROUP BY company_id, import_type, file_sha256 HAVING count(*) > 1)
            THEN RAISE EXCEPTION '全公司月度导入数据无法回退为旧版单批次导入，回退已拒绝';
            END IF;
        END $$;
        DROP INDEX uq_import_batch_monthly_file;
        DROP INDEX uq_import_batch_employee_file;
        CREATE UNIQUE INDEX uq_import_batch_company_type_file
        ON import_batch(company_id, import_type, file_sha256) WHERE company_id IS NOT NULL;
        ALTER TABLE import_row DROP COLUMN payroll_batch_id;
        ALTER TABLE import_row DROP COLUMN subject_id;
    """)
