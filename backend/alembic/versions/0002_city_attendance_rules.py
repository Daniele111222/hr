"""Add fixed city rule fields for the confirmed payroll policy."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0002_city_attendance_rules"
down_revision: str | Sequence[str] | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_FILE = Path(__file__).resolve().parents[2] / "sql" / "002_city_attendance_rules.sql"


def upgrade() -> None:
    op.execute(SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("ALTER TABLE attendance_rule DROP COLUMN IF EXISTS makeup_punch_exempt")
    op.execute("ALTER TABLE attendance_rule DROP COLUMN IF EXISTS source")
    op.execute("ALTER TABLE housing_fund_rule DROP COLUMN IF EXISTS base_source")
    op.execute("ALTER TABLE social_security_rule DROP COLUMN IF EXISTS fixed_base")
