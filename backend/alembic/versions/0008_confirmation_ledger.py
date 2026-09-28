"""Add confirmation, locking and ledger metadata."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0008_confirmation_ledger"
down_revision: str | Sequence[str] | None = "0007_attendance_incentive"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_FILE = Path(__file__).resolve().parents[2] / "sql" / "008_confirmation_ledger.sql"


def upgrade() -> None:
    op.execute(SQL_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_locked_payroll_record_mutation()
        RETURNS TRIGGER LANGUAGE plpgsql AS $$
        BEGIN
            IF OLD.calculation_status IN ('locked', 'superseded') THEN
                RAISE EXCEPTION 'Payroll record % is immutable after locking', OLD.id
                    USING ERRCODE = 'restrict_violation';
            END IF;
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END;
        $$;
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_locked_payroll_child_mutation()
        RETURNS TRIGGER LANGUAGE plpgsql AS $$
        DECLARE record_id BIGINT;
        BEGIN
            record_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.payroll_record_id ELSE NEW.payroll_record_id END;
            IF EXISTS (
                SELECT 1 FROM payroll_record
                WHERE id = record_id AND calculation_status IN ('locked', 'superseded')
            ) THEN
                RAISE EXCEPTION 'Payroll record % is immutable after locking', record_id
                    USING ERRCODE = 'restrict_violation';
            END IF;
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END;
        $$;
    """)
    op.execute("ALTER TABLE payroll_trial_run DROP COLUMN IF EXISTS viewed_at")
    op.execute("ALTER TABLE payroll_batch DROP COLUMN IF EXISTS locked_at")
    op.execute("ALTER TABLE payroll_batch DROP COLUMN IF EXISTS confirmed_at")
    op.execute("ALTER TABLE payroll_batch DROP COLUMN IF EXISTS confirmed_input_fingerprint")
    op.execute("ALTER TABLE payroll_batch DROP COLUMN IF EXISTS confirmed_trial_id")
