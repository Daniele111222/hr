from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    FetchedValue,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column

from paylite.db.base import Base
from paylite.db.models.common import (
    Money,
    created_at_column,
    effective_date_range,
    primary_key,
)


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


__all__ = [
    "Employee",
    "EmployeeAssignment",
    "EmployeeBankAccount",
    "EmployeeBase",
    "EmployeeSalary",
]
