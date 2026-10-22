-- Preserve existing performance data; absence is no longer a monthly payroll prerequisite.
ALTER TABLE employee_salary ALTER COLUMN performance_base DROP NOT NULL;
ALTER TABLE payroll_record ALTER COLUMN snapshot_performance_base DROP NOT NULL;
