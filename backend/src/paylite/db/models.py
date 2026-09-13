from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    FetchedValue,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    column,
    func,
    literal_column,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column

from paylite.db.base import Base

Money = Numeric(18, 2)
Ratio = Numeric(12, 8)
Coefficient = Numeric(14, 6)


def primary_key() -> Any:
    return mapped_column(BigInteger, Identity(), primary_key=True)


def created_at_column() -> Any:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def empty_json_default() -> Any:
    return text("'{}'::jsonb")


def effective_date_range() -> Any:
    return func.daterange(
        column("effective_from"),
        func.coalesce(column("effective_to"), literal_column("'infinity'::date")),
        literal_column("'[)'"),
    )


class Company(Base):
    __tablename__ = "company"
    __table_args__ = (UniqueConstraint("code", name="uq_company_code"),)

    id: Mapped[int] = primary_key()
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = created_at_column()


class City(Base):
    __tablename__ = "city"
    __table_args__ = (UniqueConstraint("code", name="uq_city_code"),)

    id: Mapped[int] = primary_key()
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = created_at_column()


class Subject(Base):
    __tablename__ = "subject"

    id: Mapped[int] = primary_key()
    company_id: Mapped[int] = mapped_column(
        ForeignKey("company.id", ondelete="RESTRICT"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = created_at_column()

    __table_args__ = (
        UniqueConstraint("company_id", "code", name="uq_subject_company_code"),
        UniqueConstraint("id", "company_id", name="uq_subject_id_company"),
        Index("ix_subject_company_id", "company_id"),
    )


class Department(Base):
    __tablename__ = "department"
    __table_args__ = (
        UniqueConstraint("company_id", "code", name="uq_department_company_code"),
        UniqueConstraint("id", "company_id", name="uq_department_id_company"),
        ForeignKeyConstraint(
            ["parent_id", "company_id"],
            ["department.id", "department.company_id"],
            name="fk_department_parent_company",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "parent_id IS NULL OR parent_id <> id", name="ck_department_not_self_parent"
        ),
        Index("ix_department_parent_id", "parent_id"),
        Index("ix_department_company_id", "company_id"),
    )

    id: Mapped[int] = primary_key()
    company_id: Mapped[int] = mapped_column(
        ForeignKey("company.id", ondelete="RESTRICT"), nullable=False
    )
    parent_id: Mapped[int | None] = mapped_column(BigInteger)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = created_at_column()


class SubjectDepartment(Base):
    __tablename__ = "subject_department"
    __table_args__ = (
        ForeignKeyConstraint(
            ["subject_id", "company_id"],
            ["subject.id", "subject.company_id"],
            name="fk_subject_department_subject_company",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["department_id", "company_id"],
            ["department.id", "department.company_id"],
            name="fk_subject_department_department_company",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("subject_id", "department_id", name="uq_subject_department"),
        UniqueConstraint("subject_id", "code", name="uq_subject_department_code"),
        Index("ix_subject_department_subject_id", "subject_id"),
        Index("ix_subject_department_department_id", "department_id"),
    )

    id: Mapped[int] = primary_key()
    company_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    subject_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    department_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = created_at_column()


class Employee(Base):
    __tablename__ = "employee"
    __table_args__ = (
        UniqueConstraint("company_id", "id_number", name="uq_employee_company_id_number"),
        UniqueConstraint("company_id", "employee_no", name="uq_employee_company_employee_no"),
        CheckConstraint(
            "level_number IS NULL OR level_number >= 0", name="ck_employee_level_number"
        ),
        CheckConstraint(
            "probation_status IN ('not_applicable', 'in_probation', 'confirmed')",
            name="ck_employee_probation_status",
        ),
        Index("ix_employee_company_active", "company_id", "active"),
    )

    id: Mapped[int] = primary_key()
    company_id: Mapped[int] = mapped_column(
        ForeignKey("company.id", ondelete="RESTRICT"), nullable=False
    )
    id_number: Mapped[str] = mapped_column(
        Text, nullable=False, comment="身份证号码，按文本保存，保留末位 X。"
    )
    employee_no: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    employee_type: Mapped[str] = mapped_column(String(50), nullable=False)
    level_code: Mapped[str | None] = mapped_column(String(30))
    level_number: Mapped[int | None] = mapped_column(Integer)
    formal_status: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    probation_status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="not_applicable"
    )
    probation_date: Mapped[date | None] = mapped_column(Date)
    hire_date: Mapped[date] = mapped_column(Date, nullable=False)
    termination_date: Mapped[date | None] = mapped_column(Date)
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        server_onupdate=FetchedValue(),
        onupdate=func.now(),
        nullable=False,
    )


class EmployeeAssignment(Base):
    __tablename__ = "employee_assignment"
    __table_args__ = (
        UniqueConstraint("employee_id", "effective_from", name="uq_employee_assignment_start"),
        ExcludeConstraint(
            ("employee_id", "="),
            (effective_date_range(), "&&"),
            name="ex_employee_assignment_dates",
        ),
        CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_employee_assignment_dates",
        ),
        CheckConstraint(
            "level_number IS NULL OR level_number >= 0", name="ck_assignment_level_number"
        ),
        Index("ix_employee_assignment_lookup", "employee_id", "effective_from", "effective_to"),
        Index("ix_employee_assignment_subject_id", "subject_id"),
        Index("ix_employee_assignment_subject_department_id", "subject_department_id"),
    )

    id: Mapped[int] = primary_key()
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id", ondelete="RESTRICT"), nullable=False
    )
    subject_id: Mapped[int] = mapped_column(
        ForeignKey("subject.id", ondelete="RESTRICT"), nullable=False
    )
    subject_department_id: Mapped[int] = mapped_column(
        ForeignKey("subject_department.id", ondelete="RESTRICT"), nullable=False
    )
    position_title: Mapped[str] = mapped_column(String(100), nullable=False)
    level_code: Mapped[str | None] = mapped_column(String(30))
    level_number: Mapped[int | None] = mapped_column(Integer)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = created_at_column()


class EmployeeSalary(Base):
    __tablename__ = "employee_salary"
    __table_args__ = (
        UniqueConstraint("employee_id", "effective_from", name="uq_employee_salary_start"),
        ExcludeConstraint(
            ("employee_id", "="),
            (effective_date_range(), "&&"),
            name="ex_employee_salary_dates",
        ),
        CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_employee_salary_dates",
        ),
        CheckConstraint("fixed_salary >= 0", name="ck_employee_salary_fixed_nonnegative"),
        CheckConstraint("performance_base >= 0", name="ck_employee_salary_performance_nonnegative"),
        Index("ix_employee_salary_lookup", "employee_id", "effective_from", "effective_to"),
    )

    id: Mapped[int] = primary_key()
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id", ondelete="RESTRICT"), nullable=False
    )
    fixed_salary: Mapped[Decimal] = mapped_column(Money, nullable=False)
    performance_base: Mapped[Decimal] = mapped_column(Money, nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)
    source: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime] = created_at_column()


class EmployeeBankAccount(Base):
    __tablename__ = "employee_bank_account"
    __table_args__ = (
        UniqueConstraint("employee_id", "account_number", name="uq_employee_bank_account"),
        ExcludeConstraint(
            ("employee_id", "="),
            (effective_date_range(), "&&"),
            name="ex_employee_bank_dates",
        ),
        CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_employee_bank_dates",
        ),
        Index("ix_employee_bank_primary", "employee_id", "is_primary"),
    )

    id: Mapped[int] = primary_key()
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id", ondelete="RESTRICT"), nullable=False
    )
    account_number: Mapped[str] = mapped_column(Text, nullable=False)
    account_name: Mapped[str] = mapped_column(String(100), nullable=False)
    bank_name: Mapped[str | None] = mapped_column(String(100))
    branch_name: Mapped[str | None] = mapped_column(String(100))
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = created_at_column()


class EmployeeBase(Base):
    __tablename__ = "employee_base"
    __table_args__ = (
        UniqueConstraint("employee_id", "effective_from", name="uq_employee_base_start"),
        ExcludeConstraint(
            ("employee_id", "="),
            (effective_date_range(), "&&"),
            name="ex_employee_base_dates",
        ),
        CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_employee_base_dates",
        ),
        Index("ix_employee_base_lookup", "employee_id", "effective_from", "effective_to"),
    )

    id: Mapped[int] = primary_key()
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id", ondelete="RESTRICT"), nullable=False
    )
    city_id: Mapped[int] = mapped_column(ForeignKey("city.id", ondelete="RESTRICT"), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = created_at_column()


class PayrollPeriod(Base):
    __tablename__ = "payroll_period"
    __table_args__ = (
        UniqueConstraint("period_start", name="uq_payroll_period_start"),
        UniqueConstraint("year", "month", name="uq_payroll_period_year_month"),
        CheckConstraint(
            "year = EXTRACT(YEAR FROM period_start)::integer", name="ck_payroll_period_year"
        ),
        CheckConstraint(
            "month = EXTRACT(MONTH FROM period_start)::integer",
            name="ck_payroll_period_month_match",
        ),
        CheckConstraint("EXTRACT(DAY FROM period_start) = 1", name="ck_payroll_period_first_day"),
        CheckConstraint(
            "period_end = (date_trunc('month', period_start) + INTERVAL '1 month - 1 day')::date",
            name="ck_payroll_period_last_day",
        ),
        CheckConstraint("period_end >= period_start", name="ck_payroll_period_dates"),
        CheckConstraint("month BETWEEN 1 AND 12", name="ck_payroll_period_month_range"),
    )

    id: Mapped[int] = primary_key()
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    actual_payment_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = created_at_column()


class PayrollBatch(Base):
    __tablename__ = "payroll_batch"
    __table_args__ = (
        UniqueConstraint(
            "subject_id",
            "payroll_period_id",
            "batch_type",
            "batch_no",
            name="uq_payroll_batch_identity",
        ),
        UniqueConstraint(
            "id", "subject_id", "payroll_period_id", name="uq_payroll_batch_id_subject_period"
        ),
        CheckConstraint(
            "batch_type IN ('normal', 'supplement', 'performance_supplement', 'other')",
            name="ck_payroll_batch_type",
        ),
        CheckConstraint(
            "status IN ('draft', 'trial', 'confirmed', 'locked', 'exported', 'cancelled')",
            name="ck_payroll_batch_status",
        ),
        CheckConstraint("batch_no > 0", name="ck_payroll_batch_number_positive"),
        Index("ix_payroll_batch_period_status", "payroll_period_id", "status"),
        Index(
            "uq_payroll_batch_normal",
            "subject_id",
            "payroll_period_id",
            unique=True,
            postgresql_where=text("batch_type = 'normal'"),
        ),
    )

    id: Mapped[int] = primary_key()
    subject_id: Mapped[int] = mapped_column(
        ForeignKey("subject.id", ondelete="RESTRICT"), nullable=False
    )
    payroll_period_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_period.id", ondelete="RESTRICT"), nullable=False
    )
    batch_type: Mapped[str] = mapped_column(String(30), nullable=False)
    batch_no: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="draft")
    name: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        server_onupdate=FetchedValue(),
        onupdate=func.now(),
        nullable=False,
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
        Index("ix_import_batch_period_type", "payroll_period_id", "import_type"),
    )

    id: Mapped[int] = primary_key()
    payroll_period_id: Mapped[int | None] = mapped_column(
        ForeignKey("payroll_period.id", ondelete="RESTRICT")
    )
    payroll_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("payroll_batch.id", ondelete="RESTRICT")
    )
    import_type: Mapped[str] = mapped_column(String(30), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
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
        CheckConstraint("missed_punch_count >= 0", name="ck_attendance_missed_nonnegative"),
        CheckConstraint(
            "leave_type IN ('none', 'paid', 'unpaid')",
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
    missed_punch_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
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


class SocialSecurityRule(Base):
    __tablename__ = "social_security_rule"
    __table_args__ = (
        UniqueConstraint("city_id", "effective_from", name="uq_social_security_city_start"),
        ExcludeConstraint(
            ("city_id", "="),
            (effective_date_range(), "&&"),
            name="ex_social_security_rule_dates",
        ),
        CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_social_security_rule_dates",
        ),
        Index("ix_social_security_rule_lookup", "city_id", "effective_from", "effective_to"),
    )

    id: Mapped[int] = primary_key()
    city_id: Mapped[int] = mapped_column(ForeignKey("city.id", ondelete="RESTRICT"), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)
    version: Mapped[str] = mapped_column(String(50), nullable=False)
    source: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_column()


class SocialSecurityItemRule(Base):
    __tablename__ = "social_security_item_rule"
    __table_args__ = (
        UniqueConstraint("social_security_rule_id", "item_code", name="uq_social_security_item"),
        CheckConstraint(
            "company_rate >= 0 AND employee_rate >= 0", name="ck_social_security_rates"
        ),
        CheckConstraint("base_min >= 0 AND base_max >= base_min", name="ck_social_security_bases"),
        Index("ix_social_security_item_rule_rule_id", "social_security_rule_id"),
    )

    id: Mapped[int] = primary_key()
    social_security_rule_id: Mapped[int] = mapped_column(
        ForeignKey("social_security_rule.id", ondelete="CASCADE"), nullable=False
    )
    item_code: Mapped[str] = mapped_column(String(30), nullable=False)
    item_name: Mapped[str] = mapped_column(String(100), nullable=False)
    company_rate: Mapped[Decimal] = mapped_column(Ratio, nullable=False)
    employee_rate: Mapped[Decimal] = mapped_column(Ratio, nullable=False)
    base_min: Mapped[Decimal] = mapped_column(Money, nullable=False)
    base_max: Mapped[Decimal] = mapped_column(Money, nullable=False)
    created_at: Mapped[datetime] = created_at_column()


class HousingFundRule(Base):
    __tablename__ = "housing_fund_rule"
    __table_args__ = (
        UniqueConstraint("city_id", "effective_from", name="uq_housing_fund_city_start"),
        ExcludeConstraint(
            ("city_id", "="),
            (effective_date_range(), "&&"),
            name="ex_housing_fund_rule_dates",
        ),
        CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_housing_fund_rule_dates",
        ),
        CheckConstraint("company_rate >= 0 AND employee_rate >= 0", name="ck_housing_fund_rates"),
        CheckConstraint("base_min >= 0 AND base_max >= base_min", name="ck_housing_fund_bases"),
        Index("ix_housing_fund_rule_lookup", "city_id", "effective_from", "effective_to"),
    )

    id: Mapped[int] = primary_key()
    city_id: Mapped[int] = mapped_column(ForeignKey("city.id", ondelete="RESTRICT"), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)
    company_rate: Mapped[Decimal] = mapped_column(Ratio, nullable=False)
    employee_rate: Mapped[Decimal] = mapped_column(Ratio, nullable=False)
    base_min: Mapped[Decimal] = mapped_column(Money, nullable=False)
    base_max: Mapped[Decimal] = mapped_column(Money, nullable=False)
    version: Mapped[str] = mapped_column(String(50), nullable=False)
    source: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_column()


class AttendanceRule(Base):
    __tablename__ = "attendance_rule"
    __table_args__ = (
        UniqueConstraint("effective_from", name="uq_attendance_rule_start"),
        ExcludeConstraint(
            (effective_date_range(), "&&"),
            name="ex_attendance_rule_dates",
        ),
        CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_attendance_rule_dates",
        ),
        CheckConstraint("standard_hours > 0", name="ck_attendance_standard_hours"),
        CheckConstraint("missed_punch_amount >= 0", name="ck_attendance_missed_punch_amount"),
        CheckConstraint("exempt_level_number >= 0", name="ck_attendance_exempt_level"),
    )

    id: Mapped[int] = primary_key()
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)
    standard_hours: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, server_default="8"
    )
    missed_punch_amount: Mapped[Decimal] = mapped_column(Money, nullable=False, server_default="30")
    exempt_level_number: Mapped[int] = mapped_column(Integer, nullable=False, server_default="7")
    version: Mapped[str] = mapped_column(String(50), nullable=False)
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
    created_at: Mapped[datetime] = created_at_column()


class PayrollRecord(Base):
    __tablename__ = "payroll_record"
    __table_args__ = (
        ForeignKeyConstraint(
            ["payroll_batch_id", "subject_id", "payroll_period_id"],
            ["payroll_batch.id", "payroll_batch.subject_id", "payroll_batch.payroll_period_id"],
            name="fk_payroll_record_batch_scope",
            ondelete="RESTRICT",
        ),
        UniqueConstraint(
            "payroll_batch_id", "employee_id", name="uq_payroll_record_batch_employee"
        ),
        CheckConstraint(
            "calculation_status IN ('trial', 'confirmed', 'locked', 'superseded')",
            name="ck_payroll_record_status",
        ),
        CheckConstraint(
            "gross_amount >= 0 AND deduction_amount >= 0 "
            "AND net_amount >= 0 AND employer_cost_amount >= 0",
            name="ck_payroll_record_amounts_nonnegative",
        ),
        Index("ix_payroll_record_period_subject", "payroll_period_id", "subject_id"),
        Index("ix_payroll_record_employee_id", "employee_id"),
    )

    id: Mapped[int] = primary_key()
    payroll_batch_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    payroll_period_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    subject_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id", ondelete="RESTRICT"), nullable=False
    )

    snapshot_id_number: Mapped[str] = mapped_column(Text, nullable=False)
    snapshot_employee_no: Mapped[str] = mapped_column(String(50), nullable=False)
    snapshot_employee_name: Mapped[str] = mapped_column(String(100), nullable=False)
    snapshot_department_name: Mapped[str | None] = mapped_column(String(200))
    snapshot_position_title: Mapped[str | None] = mapped_column(String(100))
    snapshot_level_code: Mapped[str | None] = mapped_column(String(30))
    snapshot_level_number: Mapped[int | None] = mapped_column(Integer)
    snapshot_fixed_salary: Mapped[Decimal] = mapped_column(Money, nullable=False)
    snapshot_performance_base: Mapped[Decimal] = mapped_column(Money, nullable=False)
    snapshot_base_city_name: Mapped[str | None] = mapped_column(String(100))
    snapshot_bank_account: Mapped[str | None] = mapped_column(Text)

    gross_amount: Mapped[Decimal] = mapped_column(Money, nullable=False, server_default="0")
    deduction_amount: Mapped[Decimal] = mapped_column(Money, nullable=False, server_default="0")
    net_amount: Mapped[Decimal] = mapped_column(Money, nullable=False, server_default="0")
    employer_cost_amount: Mapped[Decimal] = mapped_column(Money, nullable=False, server_default="0")
    calculation_status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="trial"
    )
    external_tax_data: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, comment="外部提供的税务字段；系统不计算个税。"
    )
    external_tax_source: Mapped[str | None] = mapped_column(Text)
    calculated_at: Mapped[datetime] = created_at_column()


class PayrollItem(Base):
    __tablename__ = "payroll_item"
    __table_args__ = (
        UniqueConstraint("payroll_record_id", "item_code", name="uq_payroll_item_code"),
        CheckConstraint(
            "item_category IN ('income', 'deduction', 'employer_cost', 'external_tax')",
            name="ck_payroll_item_category",
        ),
        CheckConstraint("amount >= 0", name="ck_payroll_item_amount_nonnegative"),
        Index("ix_payroll_item_record_category", "payroll_record_id", "item_category"),
    )

    id: Mapped[int] = primary_key()
    payroll_record_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_record.id", ondelete="CASCADE"), nullable=False
    )
    item_code: Mapped[str] = mapped_column(String(50), nullable=False)
    item_name: Mapped[str] = mapped_column(String(100), nullable=False)
    item_category: Mapped[str] = mapped_column(String(20), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Money, nullable=False)
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 6))
    rate: Mapped[Decimal | None] = mapped_column(Ratio)
    source_type: Mapped[str | None] = mapped_column(String(50))
    source_reference: Mapped[str | None] = mapped_column(Text)
    in_social_security_base: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    in_housing_fund_base: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = created_at_column()


class PayrollCalculationDetail(Base):
    __tablename__ = "payroll_calculation_detail"
    __table_args__ = (
        UniqueConstraint("payroll_record_id", "step_code", name="uq_payroll_calculation_step"),
        Index("ix_payroll_calculation_record", "payroll_record_id"),
    )

    id: Mapped[int] = primary_key()
    payroll_record_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_record.id", ondelete="CASCADE"), nullable=False
    )
    step_code: Mapped[str] = mapped_column(String(50), nullable=False)
    formula_text: Mapped[str] = mapped_column(Text, nullable=False)
    inputs: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=empty_json_default()
    )
    amount: Mapped[Decimal | None] = mapped_column(Money)
    rule_reference: Mapped[str | None] = mapped_column(String(100))
    source_type: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime] = created_at_column()


class CorrectionBatch(Base):
    __tablename__ = "correction_batch"
    __table_args__ = (
        UniqueConstraint("replacement_batch_id", name="uq_correction_replacement_batch"),
        CheckConstraint(
            "original_batch_id <> replacement_batch_id", name="ck_correction_distinct_batches"
        ),
        CheckConstraint(
            "status IN ('requested', 'applied', 'cancelled')",
            name="ck_correction_status",
        ),
        Index("ix_correction_original_batch_id", "original_batch_id"),
    )

    id: Mapped[int] = primary_key()
    original_batch_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_batch.id", ondelete="RESTRICT"), nullable=False
    )
    replacement_batch_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_batch.id", ondelete="RESTRICT"), nullable=False
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="requested")
    created_at: Mapped[datetime] = created_at_column()


class ExportBatch(Base):
    __tablename__ = "export_batch"
    __table_args__ = (
        CheckConstraint(
            "output_type IN ('labor_cost', 'bank_payment', 'payroll_sheet', 'tax_assistance')",
            name="ck_export_output_type",
        ),
        CheckConstraint(
            "status IN ('started', 'completed', 'failed')",
            name="ck_export_status",
        ),
        Index("ix_export_batch_period_type", "payroll_period_id", "output_type"),
        Index("ix_export_batch_payroll_batch_id", "payroll_batch_id"),
    )

    id: Mapped[int] = primary_key()
    payroll_period_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_period.id", ondelete="RESTRICT"), nullable=False
    )
    payroll_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("payroll_batch.id", ondelete="RESTRICT")
    )
    output_type: Mapped[str] = mapped_column(String(30), nullable=False)
    template_version: Mapped[str] = mapped_column(String(50), nullable=False)
    output_path: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="started")
    parameters: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=empty_json_default()
    )
    created_at: Mapped[datetime] = created_at_column()
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ExportWarning(Base):
    __tablename__ = "export_warning"
    __table_args__ = (
        CheckConstraint(
            "severity IN ('info', 'warning', 'error')", name="ck_export_warning_severity"
        ),
        Index("ix_export_warning_batch_severity", "export_batch_id", "severity"),
        Index("ix_export_warning_employee_id", "employee_id"),
    )

    id: Mapped[int] = primary_key()
    export_batch_id: Mapped[int] = mapped_column(
        ForeignKey("export_batch.id", ondelete="CASCADE"), nullable=False
    )
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employee.id", ondelete="RESTRICT"))
    field_name: Mapped[str | None] = mapped_column(String(100))
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created_at_column()
