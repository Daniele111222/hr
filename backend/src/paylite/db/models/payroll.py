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
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from paylite.db.base import Base
from paylite.db.models.common import (
    Money,
    Ratio,
    created_at_column,
    empty_json_default,
    primary_key,
)


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
    attendance_input_revision: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    performance_input_revision: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
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


class PayrollTrialRun(Base):
    __tablename__ = "payroll_trial_run"
    __table_args__ = (Index("ix_payroll_trial_batch_id", "payroll_batch_id", "id"),)

    id: Mapped[int] = primary_key()
    payroll_batch_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_batch.id", ondelete="RESTRICT"), nullable=False
    )
    input_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    input_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    results: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
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


__all__ = [
    "CorrectionBatch",
    "PayrollBatch",
    "PayrollCalculationDetail",
    "PayrollItem",
    "PayrollPeriod",
    "PayrollRecord",
    "PayrollTrialRun",
]
