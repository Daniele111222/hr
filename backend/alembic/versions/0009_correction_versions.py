"""Allow normal correction versions and mark the effective batch."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0009_correction_versions"
down_revision: str | Sequence[str] | None = "0008_confirmation_ledger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_FILE = Path(__file__).resolve().parents[2] / "sql" / "009_correction_versions.sql"


def upgrade() -> None:
    op.execute(SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM payroll_batch
                WHERE batch_type = 'normal'
                GROUP BY subject_id, payroll_period_id
                HAVING COUNT(*) > 1
            ) THEN
                RAISE EXCEPTION 'Cannot downgrade with multiple normal batches';
            END IF;
        END $$;
        """
    )
    op.execute("DROP INDEX IF EXISTS uq_payroll_batch_normal")
    op.execute("ALTER TABLE correction_batch DROP COLUMN IF EXISTS input_overrides")
    op.execute("ALTER TABLE payroll_batch DROP COLUMN IF EXISTS is_effective")
    op.execute(
        "CREATE UNIQUE INDEX uq_payroll_batch_normal "
        "ON payroll_batch (subject_id, payroll_period_id) WHERE batch_type = 'normal'"
    )
