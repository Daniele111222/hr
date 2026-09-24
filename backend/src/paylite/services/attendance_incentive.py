"""Company-period attendance incentive calculation and traceable allocation."""

import hashlib
import json
from collections import defaultdict
from copy import deepcopy
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from paylite.db.models import (
    AttendanceIncentiveRun,
    AttendanceRecord,
    Employee,
    EmployeeAssignment,
    PayrollBatch,
    PayrollPeriod,
    PayrollTrialRun,
    Subject,
)
from paylite.domain.payroll import (
    IncentiveCandidate,
    calculate_attendance_incentive,
    money,
)
from paylite.services.payroll_trial import _fingerprint, _load_snapshot


class AttendanceIncentiveError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _previous_period(db: Session, period: PayrollPeriod) -> PayrollPeriod | None:
    year, month = period.year, period.month - 1
    if month == 0:
        year, month = year - 1, 12
    return db.scalar(
        select(PayrollPeriod).where(PayrollPeriod.year == year, PayrollPeriod.month == month)
    )


def _latest_trial(db: Session, batch_id: int) -> PayrollTrialRun | None:
    return db.scalar(
        select(PayrollTrialRun)
        .where(PayrollTrialRun.payroll_batch_id == batch_id)
        .order_by(PayrollTrialRun.id.desc())
        .limit(1)
    )


def _period_text(period: PayrollPeriod) -> str:
    return f"{period.year:04d}-{period.month:02d}"


def _money_text(value: Decimal | str | int | float) -> str:
    return str(money(Decimal(str(value))))


def _source_data(
    db: Session, source_period: PayrollPeriod, subjects: list[Subject]
) -> tuple[list[dict[str, Any]], Decimal, list[str]]:
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    pool = Decimal("0")
    for subject in subjects:
        batch = db.scalar(
            select(PayrollBatch).where(
                PayrollBatch.subject_id == subject.id,
                PayrollBatch.payroll_period_id == source_period.id,
                PayrollBatch.batch_type == "normal",
            )
        )
        if batch is None or batch.status not in {"locked", "exported"}:
            errors.append(f"{subject.name}缺少{_period_text(source_period)}锁定正常批次")
            continue
        trial = _latest_trial(db, batch.id)
        if trial is None:
            errors.append(f"{subject.name}的锁定批次缺少试算快照")
            continue
        total = Decimal("0")
        failed = False
        for result in trial.results:
            if result.get("errors"):
                failed = True
                break
            amounts = result.get("amounts") or {}
            total += Decimal(str(amounts.get("attendance_deduction", "0")))
        if failed:
            errors.append(f"{subject.name}的锁定批次存在试算错误")
            continue
        total = money(total)
        pool += total
        rows.append(
            {
                "subject_id": subject.id,
                "subject_code": subject.code,
                "subject_name": subject.name,
                "batch_id": batch.id,
                "batch_status": batch.status,
                "trial_id": trial.id,
                "trial_fingerprint": trial.input_fingerprint,
                "attendance_deduction": str(total),
            }
        )
    return rows, money(pool), errors


def _current_data(
    db: Session, period: PayrollPeriod, subjects: list[Subject]
) -> tuple[list[dict[str, Any]], list[str]]:
    subject_ids = [subject.id for subject in subjects]
    assignments = list(
        db.scalars(
            select(EmployeeAssignment)
            .where(
                EmployeeAssignment.subject_id.in_(subject_ids or [-1]),
                EmployeeAssignment.effective_from <= period.period_end,
                (EmployeeAssignment.effective_to.is_(None))
                | (EmployeeAssignment.effective_to >= period.period_start),
            )
            .order_by(
                EmployeeAssignment.employee_id,
                EmployeeAssignment.effective_from,
                EmployeeAssignment.id,
            )
        )
    )
    grouped: dict[int, list[EmployeeAssignment]] = defaultdict(list)
    for assignment in assignments:
        grouped[assignment.employee_id].append(assignment)
    employees = list(
        db.scalars(
            select(Employee)
            .where(
                Employee.hire_date <= period.period_end,
                (Employee.termination_date.is_(None))
                | (Employee.termination_date >= period.period_start),
            )
            .order_by(Employee.id)
        )
    )
    attendance = {
        row.employee_id: row
        for row in db.scalars(
            select(AttendanceRecord).where(AttendanceRecord.payroll_period_id == period.id)
        )
    }
    candidates: list[dict[str, Any]] = []
    for employee in employees:
        rows = grouped.get(employee.id, [])
        subjects_for_employee = sorted({row.subject_id for row in rows})
        assignment = rows[-1] if rows else None
        level = (
            assignment.level_number
            if assignment and assignment.level_number is not None
            else employee.level_number
        )
        record = attendance.get(employee.id)
        reason: str | None = None
        if len(subjects_for_employee) > 1:
            reason = "本期跨主体调动暂不计算"
        elif assignment is None:
            reason = "本期无有效任职关系"
        elif not employee.active:
            reason = "当前非在职"
        elif not employee.formal_status or employee.probation_status != "confirmed":
            reason = "未正式转正"
        elif level is None:
            reason = "缺职级"
        elif level >= 7:
            reason = "P7及以上不参与"
        elif record is None:
            reason = "本期无考勤记录"
        elif record.late_minutes or record.early_leave_minutes:
            reason = "存在迟到或早退"
        elif record.missed_punch_count:
            reason = "存在忘打卡"
        elif record.leave_days:
            reason = "存在请假"
        candidates.append(
            {
                "employee_id": employee.id,
                "employee_no": employee.employee_no,
                "employee_name": employee.name,
                "subject_id": assignment.subject_id if assignment else None,
                "formal_status": employee.formal_status,
                "probation_status": employee.probation_status,
                "level_number": level,
                "eligible": reason is None,
                "reason": reason,
                "attendance": (
                    {
                        "record_id": record.id,
                        "late_minutes": record.late_minutes,
                        "early_leave_minutes": record.early_leave_minutes,
                        "missed_punch_count": record.missed_punch_count,
                        "leave_days": str(record.leave_days),
                    }
                    if record
                    else None
                ),
            }
        )
    candidates.sort(
        key=lambda row: (
            row["subject_id"] is None,
            row["subject_id"] or 0,
            row["employee_no"],
            row["employee_id"],
        )
    )
    return candidates, []


def _current_batch_data(
    db: Session, period: PayrollPeriod, subjects: list[Subject]
) -> tuple[list[dict[str, Any]], list[str]]:
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    for subject in subjects:
        batch = db.scalar(
            select(PayrollBatch).where(
                PayrollBatch.subject_id == subject.id,
                PayrollBatch.payroll_period_id == period.id,
                PayrollBatch.batch_type == "normal",
            )
        )
        if batch is None:
            errors.append(f"{subject.name}缺少{_period_text(period)}正常工资批次")
            continue
        trial = _latest_trial(db, batch.id)
        if trial is None:
            errors.append(f"{subject.name}尚未完成普通工资试算")
            continue
        current_snapshot, _ = _load_snapshot(db, batch, period)
        ordinary_fingerprint = trial.ordinary_input_fingerprint or trial.input_fingerprint
        if _fingerprint(current_snapshot) != ordinary_fingerprint:
            errors.append(f"{subject.name}普通工资试算已失效")
        if any(result.get("errors") for result in trial.results):
            errors.append(f"{subject.name}存在员工试算错误")
        rows.append(
            {
                "subject_id": subject.id,
                "subject_code": subject.code,
                "subject_name": subject.name,
                "batch_id": batch.id,
                "batch_status": batch.status,
                "trial_id": trial.id,
                "trial_fingerprint": ordinary_fingerprint,
                "ordinary_input_fingerprint": ordinary_fingerprint,
            }
        )
    return rows, errors


def _fingerprint_payload(
    source: list[dict[str, Any]], current: list[dict[str, Any]], candidates: list[dict[str, Any]]
) -> str:
    stable_current = [
        {key: value for key, value in row.items() if key != "trial_id"} for row in current
    ]
    payload = json.dumps(
        {"source": source, "current": stable_current, "candidates": candidates},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _context(db: Session, period: PayrollPeriod) -> dict[str, Any]:
    subjects = list(db.scalars(select(Subject).order_by(Subject.id)))
    company_ids = sorted({subject.company_id for subject in subjects})
    if len(company_ids) != 1:
        raise AttendanceIncentiveError(409, "当前系统只能为一个目标公司计算考勤激励")
    company_id = company_ids[0]
    previous = _previous_period(db, period)
    source_rows, pool, source_errors = (
        _source_data(db, previous, subjects)
        if previous
        else ([], Decimal("0.00"), ["上月工资期间不存在"])
    )
    current_rows, current_errors = _current_batch_data(db, period, subjects)
    candidates, candidate_errors = _current_data(db, period, subjects)
    fingerprint = _fingerprint_payload(source_rows, current_rows, candidates)
    return {
        "company_id": company_id,
        "subjects": subjects,
        "source_period": previous,
        "source_rows": source_rows,
        "pool": pool,
        "source_errors": source_errors,
        "current_rows": current_rows,
        "current_errors": current_errors,
        "candidates": candidates,
        "candidate_errors": candidate_errors,
        "fingerprint": fingerprint,
    }


def _run_out(
    run: AttendanceIncentiveRun, context: dict[str, Any], *, stale: bool
) -> dict[str, Any]:
    return {
        "id": run.id,
        "company_id": run.company_id,
        "payroll_period_id": run.payroll_period_id,
        "source_period_id": run.source_period_id,
        "status": "stale" if stale else run.status,
        "input_fingerprint": run.input_fingerprint,
        "pool_amount": str(run.pool_amount),
        "allocated_amount": str(run.allocated_amount),
        "average_amount": str(run.average_amount),
        "remainder_amount": str(run.remainder_amount),
        "source_snapshot": run.source_snapshot,
        "candidate_snapshot": run.candidate_snapshot,
        "allocations": run.allocations,
        "message": run.message,
        "created_at": run.created_at,
        "stale": stale,
        "ready": not stale and not context["source_errors"] and not context["current_errors"],
    }


def get_incentive(db: Session, period_id: int) -> dict[str, Any]:
    period = db.get(PayrollPeriod, period_id)
    if period is None:
        raise AttendanceIncentiveError(404, "工资期间不存在")
    context = _context(db, period)
    latest = db.scalar(
        select(AttendanceIncentiveRun)
        .where(
            AttendanceIncentiveRun.company_id == context["company_id"],
            AttendanceIncentiveRun.payroll_period_id == period_id,
        )
        .order_by(AttendanceIncentiveRun.id.desc())
        .limit(1)
    )
    result = (
        _run_out(
            latest,
            context,
            stale=latest is not None and latest.input_fingerprint != context["fingerprint"],
        )
        if latest
        else None
    )
    return {
        "period_id": period.id,
        "period": _period_text(period),
        "source_period": _period_text(context["source_period"])
        if context["source_period"]
        else None,
        "company_id": context["company_id"],
        "status": (
            result["status"]
            if result and not result["stale"]
            else (
                "stale"
                if result
                else (
                    "blocked" if context["source_errors"] or context["current_errors"] else "ready"
                )
            )
        ),
        "can_calculate": not context["source_errors"] and not context["current_errors"],
        "message": "；".join(context["source_errors"] + context["current_errors"])
        or (result["message"] if result else None),
        "source_rows": context["source_rows"],
        "current_rows": context["current_rows"],
        "pool_amount": str(context["pool"]),
        "candidate_snapshot": context["candidates"],
        "run": result,
        "input_fingerprint": context["fingerprint"],
    }


def _apply_to_trial(
    db: Session, trial: PayrollTrialRun, run: AttendanceIncentiveRun, amounts: dict[int, Decimal]
) -> PayrollTrialRun:
    results = deepcopy(trial.results)
    for row in results:
        amount = money(amounts.get(row["employee_id"], Decimal("0")))
        row.setdefault("amounts", None)
        if amount and not row.get("errors") and row["amounts"]:
            row["amounts"]["gross"] = _money_text(Decimal(row["amounts"]["gross"]) + amount)
            row["amounts"]["untaxed_amount"] = _money_text(
                Decimal(row["amounts"]["untaxed_amount"]) + amount
            )
            row["amounts"]["employer_cost"] = _money_text(
                Decimal(row["amounts"]["employer_cost"]) + amount
            )
            row.setdefault("items", []).append(
                {
                    "code": "attendance_incentive",
                    "name": "考勤激励",
                    "category": "income",
                    "amount": str(amount),
                }
            )
            row.setdefault("steps", []).append(
                {
                    "code": "attendance_incentive",
                    "formula": "全公司上月锁定考勤扣款池按符合条件人数平均分配",
                    "inputs": {"incentive_run_id": str(run.id)},
                    "amount": str(amount),
                }
            )
        row["incentive_amount"] = str(amount)
    snapshot = deepcopy(trial.input_snapshot)
    snapshot["attendance_incentive"] = {"run_id": run.id, "fingerprint": run.input_fingerprint}
    combined = hashlib.sha256(
        json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
            "utf-8"
        )
    ).hexdigest()
    final = PayrollTrialRun(
        payroll_batch_id=trial.payroll_batch_id,
        input_fingerprint=combined,
        ordinary_input_fingerprint=trial.ordinary_input_fingerprint or trial.input_fingerprint,
        input_snapshot=snapshot,
        results=results,
        incentive_run_id=run.id,
        includes_final_incentive=True,
    )
    db.add(final)
    return final


def calculate_incentive(db: Session, period_id: int) -> dict[str, Any]:
    period = db.get(PayrollPeriod, period_id)
    if period is None:
        raise AttendanceIncentiveError(404, "工资期间不存在")
    source_period = _previous_period(db, period)
    period_ids = [period.id, source_period.id] if source_period else [period.id]
    locked_periods = list(
        db.scalars(
            select(PayrollPeriod)
            .where(PayrollPeriod.id.in_(period_ids))
            .order_by(PayrollPeriod.id)
            .with_for_update()
        )
    )
    period = next(item for item in locked_periods if item.id == period_id)
    context = _context(db, period)
    if context["source_errors"] or context["current_errors"]:
        raise AttendanceIncentiveError(
            409, "；".join(context["source_errors"] + context["current_errors"])
        )
    source_period = context["source_period"]
    assert source_period is not None
    db.execute(
        select(PayrollBatch)
        .where(PayrollBatch.payroll_period_id.in_([source_period.id, period.id]))
        .order_by(PayrollBatch.id)
        .with_for_update()
    ).all()
    latest = db.scalar(
        select(AttendanceIncentiveRun)
        .where(
            AttendanceIncentiveRun.company_id == context["company_id"],
            AttendanceIncentiveRun.payroll_period_id == period.id,
            AttendanceIncentiveRun.input_fingerprint == context["fingerprint"],
        )
        .order_by(AttendanceIncentiveRun.id.desc())
        .limit(1)
    )
    if latest is not None:
        return get_incentive(db, period_id)
    eligible = tuple(
        IncentiveCandidate(row["employee_id"], row["subject_id"], row["employee_no"])
        for row in context["candidates"]
        if row["eligible"]
    )
    result = calculate_attendance_incentive(context["pool"], eligible)
    allocation_map = {
        allocation.employee_id: allocation.amount for allocation in result.allocations
    }
    candidate_snapshot = context["candidates"]
    allocations = [
        {
            "employee_id": allocation.employee_id,
            "subject_id": allocation.subject_id,
            "employee_no": allocation.employee_no,
            "amount": str(allocation.amount),
            "sort_order": index + 1,
        }
        for index, allocation in enumerate(result.allocations)
    ]
    run = AttendanceIncentiveRun(
        company_id=context["company_id"],
        payroll_period_id=period.id,
        source_period_id=source_period.id,
        status="empty" if not result.allocations else "calculated",
        input_fingerprint=context["fingerprint"],
        pool_amount=result.pool,
        allocated_amount=money(sum((item.amount for item in result.allocations), Decimal("0"))),
        average_amount=result.average,
        remainder_amount=result.remainder,
        source_snapshot=context["source_rows"],
        candidate_snapshot=candidate_snapshot,
        allocations=allocations,
        message="本期无合格员工，未生成激励金额" if not result.allocations else None,
    )
    db.add(run)
    db.flush()
    for current in context["current_rows"]:
        trial = db.get(PayrollTrialRun, current["trial_id"], with_for_update=True)
        if trial is None or trial.includes_final_incentive:
            continue
        _apply_to_trial(db, trial, run, allocation_map)
    db.commit()
    db.refresh(run)
    return get_incentive(db, period_id)
