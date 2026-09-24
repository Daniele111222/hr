"""Store distinct leave and punch facts plus attendance input revision."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0004_attendance_import"
down_revision: str | Sequence[str] | None = "0003_employee_import"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_FILE = Path(__file__).resolve().parents[2] / "sql" / "004_attendance_import.sql"


def upgrade() -> None:
    op.execute(SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("UPDATE attendance_record SET leave_type = 'unpaid' WHERE leave_type = 'mixed'")
    op.execute("ALTER TABLE payroll_period DROP COLUMN attendance_input_revision")
    op.execute("ALTER TABLE attendance_record DROP CONSTRAINT ck_attendance_corrected_punch_range")
    op.execute(
        "ALTER TABLE attendance_record DROP CONSTRAINT ck_attendance_unpaid_leave_nonnegative"
    )
    op.execute("ALTER TABLE attendance_record DROP CONSTRAINT ck_attendance_paid_leave_nonnegative")
    op.execute("ALTER TABLE attendance_record DROP CONSTRAINT ck_attendance_leave_type")
    op.execute(
        "ALTER TABLE attendance_record ADD CONSTRAINT ck_attendance_leave_type "
        "CHECK (leave_type IN ('none', 'paid', 'unpaid'))"
    )
    op.execute("ALTER TABLE attendance_record DROP COLUMN corrected_punch_count")
    op.execute("ALTER TABLE attendance_record DROP COLUMN unpaid_leave_days")
    op.execute("ALTER TABLE attendance_record DROP COLUMN paid_leave_days")
