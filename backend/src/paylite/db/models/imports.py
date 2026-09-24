from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from paylite.db.base import Base
from paylite.db.models.common import (
    Coefficient,
    created_at_column,
    empty_json_default,
    primary_key,
)


class ImportBatch(Base):
    __tablename__ = "import_batch"
    __table_args__ = (
        CheckConstraint(
            "import_type IN ('employee_master', 'attendance', 'performance')",
            name="ck_import_batch_type",
        ),
        CheckConstraint(
            "status IN ('uploaded', 'validated', 'partially_imported', 'imported', 'rejected')",
            name="ck_import_batch_status",
        ),
        UniqueConstraint(
            "payroll_period_id",
            "import_type",
            "file_sha256",
            name="uq_import_batch_period_type_file",
        ),
        Index(
            "uq_import_batch_company_type_file",
            "company_id",
            "import_type",
            "file_sha256",
            unique=True,
            postgresql_where=text("company_id IS NOT NULL"),
        ),
        Index("ix_import_batch_period_type", "payroll_period_id", "import_type"),
    )

    id: Mapped[int] = primary_key()
    company_id: Mapped[int | None] = mapped_column(ForeignKey("company.id", ondelete="RESTRICT"))
    payroll_period_id: Mapped[int | None] = mapped_column(
        ForeignKey("payroll_period.id", ondelete="RESTRICT")
    )
    payroll_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("payroll_batch.id", ondelete="RESTRICT")
    )
    import_type: Mapped[str] = mapped_column(String(30), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    original_file: Mapped[bytes | None] = mapped_column(LargeBinary)
    template_version: Mapped[str] = mapped_column(String(50), nullable=False)
    field_mapping: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=empty_json_default()
    )
    status: Mapped[str] = mapped_column(String(30), nullable=False, server_default="uploaded")
    uploaded_at: Mapped[datetime] = created_at_column()


class AttendanceRecord(Base):
    __tablename__ = "attendance_record"
    __table_args__ = (
        UniqueConstraint("import_batch_id", "employee_id", name="uq_attendance_import_employee"),
        UniqueConstraint("payroll_period_id", "employee_id", name="uq_attendance_period_employee"),
        CheckConstraint("expected_work_days >= 0", name="ck_attendance_work_days_nonnegative"),
        CheckConstraint("late_minutes >= 0", name="ck_attendance_late_nonnegative"),
        CheckConstraint("early_leave_minutes >= 0", name="ck_attendance_early_nonnegative"),
        CheckConstraint("leave_days >= 0", name="ck_attendance_leave_nonnegative"),
        CheckConstraint("paid_leave_days >= 0", name="ck_attendance_paid_leave_nonnegative"),
        CheckConstraint("unpaid_leave_days >= 0", name="ck_attendance_unpaid_leave_nonnegative"),
        CheckConstraint("missed_punch_count >= 0", name="ck_attendance_missed_nonnegative"),
        CheckConstraint(
            "corrected_punch_count >= 0 AND corrected_punch_count <= missed_punch_count",
            name="ck_attendance_corrected_punch_range",
        ),
        CheckConstraint(
            "leave_type IN ('none', 'paid', 'unpaid', 'mixed')",
            name="ck_attendance_leave_type",
        ),
        Index("ix_attendance_period_employee", "payroll_period_id", "employee_id"),
        Index("ix_attendance_import_batch_id", "import_batch_id"),
    )

    id: Mapped[int] = primary_key()
    import_batch_id: Mapped[int] = mapped_column(
        ForeignKey("import_batch.id", ondelete="RESTRICT"), nullable=False
    )
    payroll_period_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_period.id", ondelete="RESTRICT"), nullable=False
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id", ondelete="RESTRICT"), nullable=False
    )
    expected_work_days: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    late_minutes: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    early_leave_minutes: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    leave_days: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False, server_default="0")
    leave_type: Mapped[str] = mapped_column(String(20), nullable=False, server_default="none")
    paid_leave_days: Mapped[Decimal] = mapped_column(
        Numeric(8, 2), nullable=False, server_default="0"
    )
    unpaid_leave_days: Mapped[Decimal] = mapped_column(
        Numeric(8, 2), nullable=False, server_default="0"
    )
    missed_punch_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    corrected_punch_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    punch_corrected: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    exception_note: Mapped[str | None] = mapped_column(Text)
    raw_values: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=empty_json_default()
    )
    created_at: Mapped[datetime] = created_at_column()


class PerformanceRecord(Base):
    __tablename__ = "performance_record"
    __table_args__ = (
        UniqueConstraint("import_batch_id", "employee_id", name="uq_performance_import_employee"),
        UniqueConstraint("payroll_period_id", "employee_id", name="uq_performance_period_employee"),
        CheckConstraint("coefficient >= 0", name="ck_performance_coefficient_nonnegative"),
        Index("ix_performance_period_employee", "payroll_period_id", "employee_id"),
        Index("ix_performance_import_batch_id", "import_batch_id"),
    )

    id: Mapped[int] = primary_key()
    import_batch_id: Mapped[int] = mapped_column(
        ForeignKey("import_batch.id", ondelete="RESTRICT"), nullable=False
    )
    payroll_period_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_period.id", ondelete="RESTRICT"), nullable=False
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id", ondelete="RESTRICT"), nullable=False
    )
    coefficient: Mapped[Decimal] = mapped_column(Coefficient, nullable=False)
    source_value: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = created_at_column()


class ImportRow(Base):
    __tablename__ = "import_row"
    __table_args__ = (
        UniqueConstraint(
            "import_batch_id", "sheet_name", "source_row_number", name="uq_import_row_location"
        ),
        CheckConstraint(
            "validation_status IN ('valid', 'invalid', 'corrected', 'imported')",
            name="ck_import_row_status",
        ),
        Index("ix_import_row_batch_status", "import_batch_id", "validation_status"),
    )

    id: Mapped[int] = primary_key()
    import_batch_id: Mapped[int] = mapped_column(
        ForeignKey("import_batch.id", ondelete="CASCADE"), nullable=False
    )
    sheet_name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_row_number: Mapped[int] = mapped_column(Integer, nullable=False)
    validation_status: Mapped[str] = mapped_column(String(20), nullable=False)
    raw_data: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=empty_json_default()
    )
    normalized_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    errors: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    correction_values: Mapped[dict[str, str] | None] = mapped_column(JSONB)
    correction_history: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    created_at: Mapped[datetime] = created_at_column()


__all__ = ["AttendanceRecord", "ImportBatch", "ImportRow", "PerformanceRecord"]
