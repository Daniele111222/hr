"""Independent supplement inputs, trial, confirmation and locking."""

import hashlib
import json
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from paylite.db.models import (
    City,
    Employee,
    EmployeeAssignment,
    EmployeeBankAccount,
    EmployeeBase,
    EmployeeSalary,
    PayrollBatch,
    PayrollPeriod,
    PayrollRecord,
    PayrollTrialRun,
    SubjectDepartment,
)
from paylite.services.payroll_confirmation import _create_records
from paylite.services.payroll_workbench import employee_scope


class SupplementError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _batch(db: Session, batch_id: int, *, lock: bool = False) -> PayrollBatch:
    query = select(PayrollBatch).where(
        PayrollBatch.id == batch_id, PayrollBatch.batch_type == "supplement"
    )
    if lock:
        query = query.with_for_update()
    batch = db.scalar(query)
    if batch is None:
        raise SupplementError(404, "独立补发批次不存在")
    return batch


def _latest(db: Session, batch_id: int) -> PayrollTrialRun | None:
    return db.scalar(
        select(PayrollTrialRun)
        .where(PayrollTrialRun.payroll_batch_id == batch_id)
        .order_by(PayrollTrialRun.id.desc())
        .limit(1)
    )


def _effective(db: Session, model: Any, employee_id: int, period: PayrollPeriod) -> Any | None:
    return db.scalar(
        select(model)
        .where(
            model.employee_id == employee_id,
            model.effective_from <= period.period_end,
            (model.effective_to.is_(None)) | (model.effective_to > period.period_start),
        )
        .order_by(model.effective_from.desc(), model.id.desc())
        .limit(1)
    )


def _employee_snapshot(
    db: Session, batch: PayrollBatch, period: PayrollPeriod, employee_id: int
) -> dict[str, Any]:
    normal = db.scalar(
        select(PayrollRecord)
        .join(PayrollBatch, PayrollBatch.id == PayrollRecord.payroll_batch_id)
        .where(
            PayrollRecord.employee_id == employee_id,
            PayrollRecord.payroll_period_id == period.id,
            PayrollRecord.subject_id == batch.subject_id,
            PayrollBatch.batch_type == "normal",
            PayrollBatch.is_effective.is_(True),
            PayrollRecord.calculation_status.in_(["confirmed", "locked"]),
        )
        .order_by(PayrollRecord.id.desc())
        .limit(1)
    )
    if normal is not None:
        return {
            "id_number": normal.snapshot_id_number,
            "employee_no": normal.snapshot_employee_no,
            "name": normal.snapshot_employee_name,
            "department_name": normal.snapshot_department_name,
            "position_title": normal.snapshot_position_title,
            "level_code": normal.snapshot_level_code,
            "level_number": normal.snapshot_level_number,
            "fixed_salary": str(normal.snapshot_fixed_salary),
            "performance_base": str(normal.snapshot_performance_base),
            "base_city_name": normal.snapshot_base_city_name,
            "bank_account": normal.snapshot_bank_account,
        }
    employee = db.get(Employee, employee_id)
    assignment = _effective(db, EmployeeAssignment, employee_id, period)
    salary = _effective(db, EmployeeSalary, employee_id, period)
    if (
        employee is None
        or assignment is None
        or assignment.subject_id != batch.subject_id
        or salary is None
    ):
        raise SupplementError(409, f"员工 {employee_id} 缺少本主体期间任职或薪酬快照")
    department = db.get(SubjectDepartment, assignment.subject_department_id)
    base = _effective(db, EmployeeBase, employee_id, period)
    city = db.get(City, base.city_id) if base else None
    bank = _effective(db, EmployeeBankAccount, employee_id, period)
    return {
        "id_number": employee.id_number,
        "employee_no": employee.employee_no,
        "name": employee.name,
        "department_name": department.name if department else None,
        "position_title": assignment.position_title,
        "level_code": assignment.level_code,
        "level_number": assignment.level_number,
        "fixed_salary": str(salary.fixed_salary),
        "performance_base": str(salary.performance_base),
        "base_city_name": city.name if city else None,
        "bank_account": bank.account_number if bank else None,
    }


def list_inputs(db: Session, batch_id: int) -> list[dict[str, Any]]:
    batch = _batch(db, batch_id)
    return batch.supplement_inputs


def replace_inputs(
    db: Session, batch_id: int, entries: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    batch = _batch(db, batch_id, lock=True)
    if batch.status not in {"draft", "trial"}:
        raise SupplementError(409, "已确认或锁定的补发批次不可修改")
    ids = [entry["employee_id"] for entry in entries]
    if len(ids) != len(set(ids)):
        raise SupplementError(422, "同一补发批次中员工只能出现一次")
    period = db.get(PayrollPeriod, batch.payroll_period_id)
    scope = employee_scope(db, period, batch.subject_id)
    if any(
        employee_id not in scope.employee_ids or employee_id in scope.ambiguous_employee_ids
        for employee_id in ids
    ):
        raise SupplementError(422, "补发员工不属于本主体工资期间或存在跨主体归属歧义")
    batch.supplement_inputs = [
        {"employee_id": entry["employee_id"], "amount": f"{entry['amount']:.2f}"}
        for entry in sorted(entries, key=lambda row: row["employee_id"])
    ]
    db.commit()
    return batch.supplement_inputs


def _snapshot(db: Session, batch: PayrollBatch) -> dict[str, Any]:
    period = db.get(PayrollPeriod, batch.payroll_period_id)
    return {
        "batch_id": batch.id,
        "reason": batch.name,
        "payment_date": batch.payment_date.isoformat() if batch.payment_date else None,
        "entries": [
            {
                **entry,
                "snapshot": _employee_snapshot(db, batch, period, entry["employee_id"]),
            }
            for entry in batch.supplement_inputs
        ],
    }


def _fingerprint(snapshot: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(snapshot, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()


def _result(run: PayrollTrialRun, stale: bool) -> dict[str, Any]:
    total = sum((Decimal(row["amounts"]["gross"]) for row in run.results), Decimal("0"))
    blockers = []
    if stale:
        blockers.append("补发输入或员工快照已变化，请重新试算")
    if not run.results:
        blockers.append("补发批次没有员工金额")
    amount = f"{total:.2f}"
    return {
        "id": run.id,
        "payroll_batch_id": run.payroll_batch_id,
        "input_fingerprint": run.input_fingerprint,
        "created_at": run.created_at,
        "stale": stale,
        "success_count": len(run.results),
        "error_count": 0,
        "total_count": len(run.results),
        "totals": {"gross": amount, "untaxed_amount": amount, "employer_cost": amount},
        "results": run.results,
        "includes_final_incentive": False,
        "ready_for_confirmation": not blockers,
        "confirmation_blockers": blockers,
    }


def get_trial(db: Session, batch_id: int) -> dict[str, Any] | None:
    batch = _batch(db, batch_id)
    run = _latest(db, batch_id)
    if run is None:
        return None
    if batch.status in {"confirmed", "locked", "exported"}:
        return _result(run, False)
    return _result(run, _fingerprint(_snapshot(db, batch)) != run.input_fingerprint)


def run_trial(db: Session, batch_id: int) -> dict[str, Any]:
    batch = _batch(db, batch_id, lock=True)
    if batch.status not in {"draft", "trial"}:
        raise SupplementError(409, "已确认或锁定的补发批次不能重新试算")
    if not batch.supplement_inputs:
        raise SupplementError(409, "请先录入补发员工金额")
    snapshot = _snapshot(db, batch)
    fingerprint = _fingerprint(snapshot)
    previous = _latest(db, batch_id)
    if previous and previous.input_fingerprint == fingerprint:
        return _result(previous, False)
    results = []
    for entry in snapshot["entries"]:
        amount = entry["amount"]
        results.append(
            {
                "employee_id": entry["employee_id"],
                "employee_name": entry["snapshot"]["name"],
                "snapshot": entry["snapshot"],
                "errors": [],
                "warnings": [],
                "amounts": {
                    "gross": amount,
                    "employee_social": "0.00",
                    "employee_housing": "0.00",
                    "untaxed_amount": amount,
                    "employer_cost": amount,
                },
                "items": [
                    {
                        "code": "supplement",
                        "name": "独立补发",
                        "category": "income",
                        "amount": amount,
                    }
                ],
                "steps": [
                    {
                        "code": "supplement",
                        "formula": "人工录入补发金额，不重算社保、公积金或考勤激励",
                        "inputs": {"reason": batch.name},
                        "amount": amount,
                    }
                ],
            }
        )
    run = PayrollTrialRun(
        payroll_batch_id=batch.id,
        input_fingerprint=fingerprint,
        input_snapshot=snapshot,
        results=results,
    )
    db.add(run)
    batch.status = "trial"
    db.commit()
    db.refresh(run)
    return _result(run, False)


def confirm(db: Session, batch_id: int) -> dict[str, Any]:
    batch = _batch(db, batch_id, lock=True)
    if batch.status in {"confirmed", "locked", "exported"}:
        return {"id": batch.id, "status": batch.status}
    if batch.status != "trial":
        raise SupplementError(409, "请先完成补发试算")
    run = _latest(db, batch_id)
    if run is None or run.viewed_at is None:
        raise SupplementError(409, "最新补发试算尚未查看")
    result = get_trial(db, batch_id)
    if not result["ready_for_confirmation"]:
        raise SupplementError(409, "；".join(result["confirmation_blockers"]))
    _create_records(db, batch, run)
    batch.status = "confirmed"
    batch.confirmed_trial_id = run.id
    batch.confirmed_input_fingerprint = run.input_fingerprint
    batch.confirmed_at = datetime.now(UTC)
    db.commit()
    return {"id": batch.id, "status": batch.status}


def lock(db: Session, batch_id: int) -> dict[str, Any]:
    batch = _batch(db, batch_id, lock=True)
    if batch.status in {"locked", "exported"}:
        return {"id": batch.id, "status": batch.status}
    if batch.status != "confirmed":
        raise SupplementError(409, "补发批次必须先确认才能锁定")
    records = list(
        db.scalars(
            select(PayrollRecord)
            .where(PayrollRecord.payroll_batch_id == batch.id)
            .with_for_update()
        )
    )
    if not records:
        raise SupplementError(409, "补发批次缺少已确认的工资记录")
    for record in records:
        if record.calculation_status != "confirmed":
            raise SupplementError(409, "补发工资记录状态不允许锁定")
        record.calculation_status = "locked"
    batch.status = "locked"
    batch.locked_at = datetime.now(UTC)
    db.commit()
    return {"id": batch.id, "status": batch.status}
