ALTER TABLE payroll_batch
    ADD COLUMN is_effective BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE correction_batch
    ADD COLUMN input_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

DROP INDEX IF EXISTS uq_payroll_batch_normal;

CREATE UNIQUE INDEX uq_payroll_batch_normal
    ON payroll_batch (subject_id, payroll_period_id)
    WHERE batch_type = 'normal' AND is_effective;

COMMENT ON COLUMN payroll_batch.is_effective IS '正常工资批次是否为当前期间有效版本；历史更正版本保留但不参与汇总。';
