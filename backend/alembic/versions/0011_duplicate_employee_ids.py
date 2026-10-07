"""Silently skip duplicate identities in employee master imports."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0011_duplicate_employee_ids"
down_revision: str | Sequence[str] | None = "0010_supplement_batches"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_FILE = Path(__file__).resolve().parents[2] / "sql" / "011_duplicate_employee_ids.sql"


def upgrade() -> None:
    op.execute(SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    # 旧版本不能表达 skipped，恢复为重复错误；已有错误内容保留。
    op.execute("""
        UPDATE import_row SET validation_status = 'invalid',
            errors = COALESCE(NULLIF(errors, 'null'::jsonb), jsonb_build_array(jsonb_build_object(
                'code', 'DUPLICATE_ID',
                'field', CASE WHEN raw_data ? '证件号码' THEN '证件号码' ELSE '身份证号' END,
                'column', 'A', 'message', '该行证件号码重复，回滚前已跳过'
            )))
        WHERE validation_status = 'skipped'
    """)
    op.execute("ALTER TABLE import_row DROP CONSTRAINT ck_import_row_status")
    op.execute("""
        ALTER TABLE import_row ADD CONSTRAINT ck_import_row_status
        CHECK (validation_status IN ('valid', 'invalid', 'corrected', 'imported'))
    """)
    op.execute("""
        UPDATE import_batch b SET status = CASE
            WHEN EXISTS (SELECT 1 FROM import_row r
                         WHERE r.import_batch_id = b.id AND r.validation_status = 'invalid')
                THEN CASE WHEN EXISTS (SELECT 1 FROM import_row r
                          WHERE r.import_batch_id = b.id AND r.validation_status = 'imported')
                     THEN 'partially_imported' ELSE 'rejected' END
            ELSE 'imported' END
        WHERE b.import_type = 'employee_master'
          AND b.status IN ('imported', 'partially_imported', 'rejected')
    """)
