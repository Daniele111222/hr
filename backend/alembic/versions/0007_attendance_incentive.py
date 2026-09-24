"""Add company-period attendance incentive runs and final trial links."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0007_attendance_incentive"
down_revision: str | Sequence[str] | None = "0006_payroll_trial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_FILE = Path(__file__).resolve().parents[2] / "sql" / "007_attendance_incentive.sql"


def upgrade() -> None:
    op.execute(SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute(
        "ALTER TABLE payroll_trial_run DROP CONSTRAINT IF EXISTS fk_payroll_trial_incentive_run"
    )
    op.execute("ALTER TABLE payroll_trial_run DROP COLUMN IF EXISTS includes_final_incentive")
    op.execute("ALTER TABLE payroll_trial_run DROP COLUMN IF EXISTS incentive_run_id")
    op.execute("ALTER TABLE payroll_trial_run DROP COLUMN IF EXISTS ordinary_input_fingerprint")
    op.execute("DROP TABLE attendance_incentive_run")
