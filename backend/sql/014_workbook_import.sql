ALTER TABLE import_batch DROP CONSTRAINT ck_import_batch_type;
ALTER TABLE import_batch ADD CONSTRAINT ck_import_batch_type CHECK (
    import_type IN ('employee_master', 'attendance', 'performance', 'workbook_employee')
);

CREATE TABLE workbook_import (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL REFERENCES company(id) ON DELETE RESTRICT,
    payroll_period_id BIGINT NOT NULL REFERENCES payroll_period(id) ON DELETE RESTRICT,
    employee_import_id BIGINT NOT NULL UNIQUE REFERENCES import_batch(id) ON DELETE RESTRICT,
    attendance_import_id BIGINT NOT NULL UNIQUE REFERENCES import_batch(id) ON DELETE RESTRICT,
    original_filename VARCHAR(255) NOT NULL,
    file_sha256 VARCHAR(64) NOT NULL,
    original_file BYTEA NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    evaluation JSONB NOT NULL DEFAULT '{}'::jsonb,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_workbook_file UNIQUE (company_id, payroll_period_id, file_sha256),
    CONSTRAINT ck_workbook_revision CHECK (revision > 0)
);
