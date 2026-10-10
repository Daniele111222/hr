ALTER TABLE import_row ADD COLUMN subject_id BIGINT REFERENCES subject(id) ON DELETE RESTRICT;
ALTER TABLE import_row ADD COLUMN payroll_batch_id BIGINT REFERENCES payroll_batch(id) ON DELETE RESTRICT;

-- 历史行仅沿用原导入批次的真实关联，不根据当前员工资料猜测历史归属。
UPDATE import_row r
SET subject_id = p.subject_id, payroll_batch_id = p.id
FROM import_batch b JOIN payroll_batch p ON p.id = b.payroll_batch_id
WHERE r.import_batch_id = b.id;

DROP INDEX uq_import_batch_company_type_file;
CREATE UNIQUE INDEX uq_import_batch_employee_file
ON import_batch(company_id, import_type, file_sha256)
WHERE company_id IS NOT NULL AND import_type = 'employee_master';
CREATE UNIQUE INDEX uq_import_batch_monthly_file
ON import_batch(company_id, payroll_period_id, import_type, file_sha256)
WHERE company_id IS NOT NULL AND import_type IN ('attendance', 'performance');
