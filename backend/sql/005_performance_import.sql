ALTER TABLE performance_record ALTER COLUMN coefficient TYPE NUMERIC;
ALTER TABLE performance_record ALTER COLUMN source_value TYPE TEXT;
ALTER TABLE payroll_period ADD COLUMN performance_input_revision INTEGER NOT NULL DEFAULT 0;
