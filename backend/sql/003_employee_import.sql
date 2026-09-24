ALTER TABLE import_batch ADD COLUMN company_id BIGINT REFERENCES company (id) ON DELETE RESTRICT;
ALTER TABLE import_batch ADD COLUMN original_file BYTEA;
ALTER TABLE import_row ADD COLUMN correction_values JSONB;
ALTER TABLE import_row ADD COLUMN correction_history JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX uq_import_batch_company_type_file
    ON import_batch (company_id, import_type, file_sha256)
    WHERE company_id IS NOT NULL;
