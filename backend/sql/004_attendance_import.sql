ALTER TABLE attendance_record ADD COLUMN paid_leave_days NUMERIC(8, 2) NOT NULL DEFAULT 0;
ALTER TABLE attendance_record ADD COLUMN unpaid_leave_days NUMERIC(8, 2) NOT NULL DEFAULT 0;
ALTER TABLE attendance_record ADD COLUMN corrected_punch_count INTEGER NOT NULL DEFAULT 0;
UPDATE attendance_record SET paid_leave_days = leave_days WHERE leave_type = 'paid';
UPDATE attendance_record SET unpaid_leave_days = leave_days WHERE leave_type = 'unpaid';
UPDATE attendance_record SET corrected_punch_count = missed_punch_count WHERE punch_corrected;
ALTER TABLE attendance_record DROP CONSTRAINT ck_attendance_leave_type;
ALTER TABLE attendance_record ADD CONSTRAINT ck_attendance_leave_type
    CHECK (leave_type IN ('none', 'paid', 'unpaid', 'mixed'));
ALTER TABLE attendance_record ADD CONSTRAINT ck_attendance_paid_leave_nonnegative CHECK (paid_leave_days >= 0);
ALTER TABLE attendance_record ADD CONSTRAINT ck_attendance_unpaid_leave_nonnegative CHECK (unpaid_leave_days >= 0);
ALTER TABLE attendance_record ADD CONSTRAINT ck_attendance_corrected_punch_range
    CHECK (corrected_punch_count >= 0 AND corrected_punch_count <= missed_punch_count);
ALTER TABLE payroll_period ADD COLUMN attendance_input_revision INTEGER NOT NULL DEFAULT 0;
