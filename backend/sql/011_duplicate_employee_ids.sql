ALTER TABLE import_row DROP CONSTRAINT ck_import_row_status;
ALTER TABLE import_row ADD CONSTRAINT ck_import_row_status
    CHECK (validation_status IN ('valid', 'invalid', 'corrected', 'imported', 'skipped'));

-- 历史员工重复行仅改变处理状态，保留原值、错误与修正历史以供追溯。
UPDATE import_row AS r
SET validation_status = 'skipped'
FROM import_batch AS b
WHERE r.import_batch_id = b.id
  AND b.import_type = 'employee_master'
  AND r.validation_status = 'invalid'
  AND UPPER(BTRIM(COALESCE(
      r.correction_values->>'证件号码', r.correction_values->>'身份证号',
      r.raw_data->>'证件号码', r.raw_data->>'身份证号', ''
  ))) ~ '^[0-9]{17}[0-9X]$'
  AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(
          COALESCE(NULLIF(r.errors, 'null'::jsonb), '[]'::jsonb)
      ) AS issue(value)
      WHERE issue.value->>'code' IN ('EMPLOYEE_EXISTS', 'DUPLICATE_ID')
         OR (issue.value->>'code' = 'DUPLICATE_IN_FILE'
             AND issue.value->>'field' IN ('身份证号', '证件号码'))
  );

UPDATE import_batch AS b
SET status = CASE
    WHEN EXISTS (SELECT 1 FROM import_row r WHERE r.import_batch_id = b.id AND r.validation_status = 'invalid')
        THEN CASE WHEN EXISTS (SELECT 1 FROM import_row r WHERE r.import_batch_id = b.id AND r.validation_status = 'imported')
             THEN 'partially_imported' ELSE 'rejected' END
    ELSE 'imported'
END
WHERE b.import_type = 'employee_master'
  AND b.status IN ('imported', 'partially_imported', 'rejected');
