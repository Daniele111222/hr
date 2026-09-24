"""Store employee import scope, original files and correction history."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0003_employee_import"
down_revision: str | Sequence[str] | None = "0002_city_attendance_rules"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_FILE = Path(__file__).resolve().parents[2] / "sql" / "003_employee_import.sql"


def upgrade() -> None:
    op.execute(SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_import_batch_company_type_file")
    op.execute("ALTER TABLE import_row DROP COLUMN IF EXISTS correction_history")
    op.execute("ALTER TABLE import_row DROP COLUMN IF EXISTS correction_values")
    op.execute("ALTER TABLE import_batch DROP COLUMN IF EXISTS original_file")
    op.execute("ALTER TABLE import_batch DROP COLUMN IF EXISTS company_id")
