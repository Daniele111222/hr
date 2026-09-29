ALTER TABLE payroll_batch
    ADD COLUMN payment_date DATE,
    ADD COLUMN supplement_inputs JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN payroll_batch.payment_date IS '独立补发批次可选的实际发放日期；正常工资沿用期间日期。';
COMMENT ON COLUMN payroll_batch.supplement_inputs IS '独立补发草稿输入；确认后以试算与台账快照追溯。';
