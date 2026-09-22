ALTER TABLE social_security_rule
    ADD COLUMN fixed_base NUMERIC(18, 2),
    ADD CONSTRAINT ck_social_security_fixed_base
        CHECK (fixed_base IS NULL OR fixed_base >= 0);

ALTER TABLE housing_fund_rule
    ADD COLUMN base_source VARCHAR(30),
    ADD CONSTRAINT ck_housing_fund_confirmed_rates
        CHECK (base_source IS NULL OR (company_rate = 0.05 AND employee_rate = 0.05));

ALTER TABLE attendance_rule
    ADD COLUMN makeup_punch_exempt BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN source TEXT;
