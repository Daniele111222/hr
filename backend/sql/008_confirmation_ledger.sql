ALTER TABLE payroll_batch
    ADD COLUMN confirmed_trial_id BIGINT REFERENCES payroll_trial_run(id) ON DELETE RESTRICT,
    ADD COLUMN confirmed_input_fingerprint VARCHAR(64),
    ADD COLUMN confirmed_at TIMESTAMPTZ,
    ADD COLUMN locked_at TIMESTAMPTZ;

ALTER TABLE payroll_trial_run ADD COLUMN viewed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION prevent_locked_payroll_record_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.calculation_status IN ('locked', 'superseded') THEN
        RAISE EXCEPTION 'Payroll record % is immutable after locking', OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.calculation_status = 'confirmed' AND (
        TG_OP <> 'UPDATE'
        OR NEW.calculation_status <> 'locked'
        OR NEW.payroll_batch_id IS DISTINCT FROM OLD.payroll_batch_id
        OR NEW.payroll_period_id IS DISTINCT FROM OLD.payroll_period_id
        OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
        OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
        OR NEW.snapshot_id_number IS DISTINCT FROM OLD.snapshot_id_number
        OR NEW.snapshot_employee_no IS DISTINCT FROM OLD.snapshot_employee_no
        OR NEW.snapshot_employee_name IS DISTINCT FROM OLD.snapshot_employee_name
        OR NEW.snapshot_department_name IS DISTINCT FROM OLD.snapshot_department_name
        OR NEW.snapshot_position_title IS DISTINCT FROM OLD.snapshot_position_title
        OR NEW.snapshot_level_code IS DISTINCT FROM OLD.snapshot_level_code
        OR NEW.snapshot_level_number IS DISTINCT FROM OLD.snapshot_level_number
        OR NEW.snapshot_fixed_salary IS DISTINCT FROM OLD.snapshot_fixed_salary
        OR NEW.snapshot_performance_base IS DISTINCT FROM OLD.snapshot_performance_base
        OR NEW.snapshot_base_city_name IS DISTINCT FROM OLD.snapshot_base_city_name
        OR NEW.snapshot_bank_account IS DISTINCT FROM OLD.snapshot_bank_account
        OR NEW.gross_amount IS DISTINCT FROM OLD.gross_amount
        OR NEW.deduction_amount IS DISTINCT FROM OLD.deduction_amount
        OR NEW.net_amount IS DISTINCT FROM OLD.net_amount
        OR NEW.employer_cost_amount IS DISTINCT FROM OLD.employer_cost_amount
        OR NEW.external_tax_data IS DISTINCT FROM OLD.external_tax_data
        OR NEW.external_tax_source IS DISTINCT FROM OLD.external_tax_source
        OR NEW.calculated_at IS DISTINCT FROM OLD.calculated_at
    ) THEN
        RAISE EXCEPTION 'Payroll record % is immutable after confirmation', OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_locked_payroll_child_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    record_id BIGINT;
    previous_record_id BIGINT;
BEGIN
    record_id := CASE
        WHEN TG_OP = 'DELETE' THEN OLD.payroll_record_id
        ELSE NEW.payroll_record_id
    END;
    IF TG_OP = 'UPDATE' THEN
        previous_record_id := OLD.payroll_record_id;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM payroll_record
        WHERE id IN (record_id, previous_record_id)
          AND calculation_status IN ('confirmed', 'locked', 'superseded')
    ) THEN
        RAISE EXCEPTION 'Payroll record % is immutable after confirmation', record_id
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
