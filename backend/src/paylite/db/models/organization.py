from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from paylite.db.base import Base
from paylite.db.models.common import created_at_column, primary_key


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


__all__ = ["City", "Company", "Department", "Subject", "SubjectDepartment"]
