from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from paylite.db.base import Base
from paylite.db.models.common import created_at_column, empty_json_default, primary_key


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


__all__ = ["ExportBatch", "ExportWarning"]
