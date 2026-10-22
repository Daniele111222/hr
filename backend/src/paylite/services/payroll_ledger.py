"""Read-only formal payroll ledger queries."""

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from paylite.db.models import (
    CorrectionBatch,
    PayrollBatch,
    PayrollCalculationDetail,
    PayrollItem,
    PayrollPeriod,
    PayrollRecord,
    PayrollTrialRun,
    Subject,
)


class PayrollLedgerError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _money(value: Decimal | None) -> str | None:
    return f"{value:.2f}" if value is not None else None


def get_record_detail(db: Session, record_id: int) -> dict[str, Any]:
    record = db.get(PayrollRecord, record_id)
    if record is None:
        raise PayrollLedgerError(404, "正式工资记录不存在")
    ledger = get_ledger(
        db, record.payroll_period_id, employee_id=record.employee_id, include_superseded=True
    )
    selected = next((row for row in ledger["records"] if row["id"] == record_id), None)
    if selected is None:
        raise PayrollLedgerError(404, "记录尚未确认，不能作为正式工资明细查询")
    batch = db.get(PayrollBatch, record.payroll_batch_id)
    trial = db.get(PayrollTrialRun, batch.confirmed_trial_id) if batch else None
    attendance = next(
        (
            row
            for row in (trial.input_snapshot.get("attendance", []) if trial else [])
            if row.get("employee_id") == record.employee_id
        ),
        None,
    )
    attendance_items = [
        item
        for item in selected["items"]
        if item["code"].startswith("attendance_") and item["category"] == "deduction"
    ]
    if attendance_items:
        selected["amounts"]["attendance_deduction"] = _money(
            sum((Decimal(item["amount"]) for item in attendance_items), Decimal("0"))
        )
    elif selected["batch_type"] == "supplement":
        selected["amounts"]["attendance_deduction"] = "0.00"
    history = db.execute(
        select(PayrollRecord, PayrollPeriod, PayrollBatch, Subject.name)
        .join(PayrollPeriod, PayrollPeriod.id == PayrollRecord.payroll_period_id)
        .join(PayrollBatch, PayrollBatch.id == PayrollRecord.payroll_batch_id)
        .join(Subject, Subject.id == PayrollRecord.subject_id)
        .where(
            PayrollRecord.employee_id == record.employee_id,
            PayrollRecord.calculation_status.in_(["confirmed", "locked"]),
        )
        .order_by(PayrollPeriod.year.desc(), PayrollPeriod.month.desc(), PayrollRecord.id.desc())
    )
    return {
        "period_id": ledger["period_id"],
        "period": ledger["period"],
        "record": selected,
        "attendance": attendance,
        "history": [
            {
                "id": row.id,
                "period": f"{period.year:04d}-{period.month:02d}",
                "subject_name": subject_name,
                "batch_type": batch.batch_type,
                "batch_no": batch.batch_no,
                "gross": _money(row.gross_amount),
                "untaxed_amount": _money(row.net_amount),
                "calculation_status": row.calculation_status,
                "is_effective": batch.is_effective,
            }
            for row, period, batch, subject_name in history
        ],
        "untaxed_tax_notice": ledger["untaxed_tax_notice"],
    }


def get_ledger(
    db: Session,
    period_id: int,
    *,
    subject_id: int | None = None,
    department: str | None = None,
    employee_id: int | None = None,
    include_superseded: bool = False,
) -> dict[str, Any]:
    period = db.get(PayrollPeriod, period_id)
    if period is None:
        raise PayrollLedgerError(404, "工资期间不存在")
    query = (
        select(PayrollRecord, Subject.name, PayrollBatch)
        .join(Subject, Subject.id == PayrollRecord.subject_id)
        .join(PayrollBatch, PayrollBatch.id == PayrollRecord.payroll_batch_id)
        .where(
            PayrollRecord.payroll_period_id == period_id,
            PayrollRecord.calculation_status.in_(["confirmed", "locked"]),
        )
        .order_by(
            PayrollRecord.subject_id,
            PayrollRecord.snapshot_department_name,
            PayrollRecord.id,
        )
    )
    if not include_superseded:
        query = query.where(PayrollBatch.is_effective.is_(True))
    if subject_id is not None:
        query = query.where(PayrollRecord.subject_id == subject_id)
    if department:
        query = query.where(PayrollRecord.snapshot_department_name == department)
    if employee_id is not None:
        query = query.where(PayrollRecord.employee_id == employee_id)
    rows = list(db.execute(query))
    trial_ids = {batch.confirmed_trial_id for _, _, batch in rows if batch.confirmed_trial_id}
    modes = {
        trial.id: trial.input_snapshot.get("calculation_mode")
        for trial in db.scalars(
            select(PayrollTrialRun).where(PayrollTrialRun.id.in_(trial_ids or {-1}))
        )
    }
    record_ids = [record.id for record, _, _ in rows]
    batch_ids = {batch.id for _, _, batch in rows}
    correction_of = dict(
        db.execute(
            select(CorrectionBatch.replacement_batch_id, CorrectionBatch.original_batch_id).where(
                CorrectionBatch.replacement_batch_id.in_(batch_ids or {-1})
            )
        ).all()
    )
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
    for record, subject_name, batch in rows:
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
                "batch_type": batch.batch_type,
                "batch_no": batch.batch_no,
                "batch_name": batch.name,
                "correction_of_batch_id": correction_of.get(batch.id),
                "payment_date": batch.payment_date
                if batch.batch_type == "supplement"
                else period.actual_payment_date,
                "subject_id": record.subject_id,
                "subject_name": subject_name,
                "employee_id": record.employee_id,
                "snapshot": {
                    "calculation_mode": modes.get(batch.confirmed_trial_id),
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
                "is_effective": batch.is_effective,
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
        "employee_count": len({record["employee_id"] for record in records}),
        "records": records,
        "totals": {key: _money(value) for key, value in totals.items()},
        "untaxed_tax_notice": "金额为未扣个税金额；系统未计算个税。",
    }
