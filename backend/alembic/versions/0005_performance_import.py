"""Allow nonnegative coefficients without an application-defined upper bound."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0005_performance_import"
down_revision: str | Sequence[str] | None = "0004_attendance_import"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_FILE = Path(__file__).resolve().parents[2] / "sql" / "005_performance_import.sql"


def upgrade() -> None:
    op.execute(SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("ALTER TABLE payroll_period DROP COLUMN performance_input_revision")
    op.execute("ALTER TABLE performance_record ALTER COLUMN source_value TYPE VARCHAR(100)")
    op.execute("ALTER TABLE performance_record ALTER COLUMN coefficient TYPE NUMERIC(14, 6)")
