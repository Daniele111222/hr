from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column

from paylite.db.base import Base
from paylite.db.models.common import (
    Money,
    Ratio,
    created_at_column,
    effective_date_range,
    primary_key,
)


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
    fixed_base: Mapped[Decimal | None] = mapped_column(Money)
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
    base_source: Mapped[str | None] = mapped_column(String(30))
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
    makeup_punch_exempt: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    version: Mapped[str] = mapped_column(String(50), nullable=False)
    source: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at_column()


__all__ = ["AttendanceRule", "HousingFundRule", "SocialSecurityItemRule", "SocialSecurityRule"]
