"""Store independent supplement inputs and optional batch payment date."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0010_supplement_batches"
down_revision: str | Sequence[str] | None = "0009_correction_versions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_FILE = Path(__file__).resolve().parents[2] / "sql" / "010_supplement_batches.sql"


def upgrade() -> None:
    op.execute(SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("ALTER TABLE payroll_batch DROP COLUMN supplement_inputs, DROP COLUMN payment_date")
