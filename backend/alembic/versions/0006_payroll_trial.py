"""Persist versioned ordinary payroll trial snapshots separately from the ledger."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0006_payroll_trial"
down_revision: str | Sequence[str] | None = "0005_performance_import"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_FILE = Path(__file__).resolve().parents[2] / "sql" / "006_payroll_trial.sql"


def upgrade() -> None:
    op.execute(SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("DROP TABLE payroll_trial_run")
