"""Read-only formal payroll ledger queries."""

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from paylite.db.models import (
    PayrollBatch,
    PayrollCalculationDetail,
    PayrollItem,
    PayrollPeriod,
    PayrollRecord,
    Subject,
)


class PayrollLedgerError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _money(value: Decimal) -> str:
    return f"{value:.2f}"


def get_ledger(
    db: Session,
    period_id: int,
    *,
    subject_id: int | None = None,
    department: str | None = None,
    employee_id: int | None = None,
) -> dict[str, Any]:
    period = db.get(PayrollPeriod, period_id)
    if period is None:
        raise PayrollLedgerError(404, "工资期间不存在")
    query = (
        select(PayrollRecord, Subject.name)
        .join(Subject, Subject.id == PayrollRecord.subject_id)
        .join(PayrollBatch, PayrollBatch.id == PayrollRecord.payroll_batch_id)
        .where(
            PayrollRecord.payroll_period_id == period_id,
            PayrollRecord.calculation_status.in_(["confirmed", "locked"]),
            PayrollBatch.is_effective.is_(True),
        )
        .order_by(
            PayrollRecord.subject_id,
            PayrollRecord.snapshot_department_name,
            PayrollRecord.id,
        )
    )
    if subject_id is not None:
        query = query.where(PayrollRecord.subject_id == subject_id)
    if department:
        query = query.where(PayrollRecord.snapshot_department_name == department)
    if employee_id is not None:
        query = query.where(PayrollRecord.employee_id == employee_id)
    rows = list(db.execute(query))
    record_ids = [record.id for record, _ in rows]
    items = list(
        db.scalars(
            select(PayrollItem)
            .where(PayrollItem.payroll_record_id.in_(record_ids or [-1]))
            .order_by(PayrollItem.payroll_record_id, PayrollItem.sort_order, PayrollItem.id)
        )
    )
    steps = list(
        db.scalars(
            select(PayrollCalculationDetail)
            .where(PayrollCalculationDetail.payroll_record_id.in_(record_ids or [-1]))
            .order_by(PayrollCalculationDetail.payroll_record_id, PayrollCalculationDetail.id)
        )
    )
    items_by_record: dict[int, list[dict[str, Any]]] = {}
    for item in items:
        items_by_record.setdefault(item.payroll_record_id, []).append(
            {
                "code": item.item_code,
                "name": item.item_name,
                "category": item.item_category,
                "amount": _money(item.amount),
                "source_type": item.source_type,
                "source_reference": item.source_reference,
            }
        )
    steps_by_record: dict[int, list[dict[str, Any]]] = {}
    for step in steps:
        steps_by_record.setdefault(step.payroll_record_id, []).append(
            {
                "code": step.step_code,
                "formula": step.formula_text,
                "inputs": step.inputs,
                "amount": _money(step.amount) if step.amount is not None else None,
            }
        )
    totals = {
        "gross": Decimal("0"),
        "deduction": Decimal("0"),
        "untaxed_amount": Decimal("0"),
        "employer_cost": Decimal("0"),
    }
    records: list[dict[str, Any]] = []
    for record, subject_name in rows:
        values = {
            "gross": record.gross_amount,
            "deduction": record.deduction_amount,
            "untaxed_amount": record.net_amount,
            "employer_cost": record.employer_cost_amount,
        }
        for key, value in values.items():
            totals[key] += value
        records.append(
            {
                "id": record.id,
                "payroll_batch_id": record.payroll_batch_id,
                "subject_id": record.subject_id,
                "subject_name": subject_name,
                "employee_id": record.employee_id,
                "snapshot": {
                    "id_number": record.snapshot_id_number,
                    "employee_no": record.snapshot_employee_no,
                    "name": record.snapshot_employee_name,
                    "department_name": record.snapshot_department_name,
                    "position_title": record.snapshot_position_title,
                    "level_code": record.snapshot_level_code,
                    "level_number": record.snapshot_level_number,
                    "fixed_salary": _money(record.snapshot_fixed_salary),
                    "performance_base": _money(record.snapshot_performance_base),
                    "base_city_name": record.snapshot_base_city_name,
                    "bank_account": record.snapshot_bank_account,
                },
                "amounts": {key: _money(value) for key, value in values.items()},
                "items": items_by_record.get(record.id, []),
                "steps": steps_by_record.get(record.id, []),
                "calculation_status": record.calculation_status,
            }
        )
    return {
        "period_id": period.id,
        "period": f"{period.year:04d}-{period.month:02d}",
        "filters": {
            "subject_id": subject_id,
            "department": department,
            "employee_id": employee_id,
        },
        "record_count": len(records),
        "records": records,
        "totals": {key: _money(value) for key, value in totals.items()},
        "untaxed_tax_notice": "金额为未扣个税金额；系统未计算个税。",
    }
