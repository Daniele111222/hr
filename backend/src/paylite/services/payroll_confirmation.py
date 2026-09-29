"""Company-period confirmation and locking use cases."""

from datetime import UTC, datetime
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
    PayrollTrialRun,
    Subject,
)
from paylite.services.payroll_correction import PayrollCorrectionError, activate_locked_correction
from paylite.services.payroll_trial import get_trial


class PayrollConfirmationError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _now() -> datetime:
    return datetime.now(UTC)


def _period(db: Session, period_id: int, *, lock: bool = False) -> PayrollPeriod:
    query = select(PayrollPeriod).where(PayrollPeriod.id == period_id)
    if lock:
        query = query.with_for_update()
    period = db.scalar(query)
    if period is None:
        raise PayrollConfirmationError(404, "工资期间不存在")
    return period


def _batches(db: Session, period_id: int, *, lock: bool = False) -> list[PayrollBatch]:
    query = (
        select(PayrollBatch)
        .join(Subject, Subject.id == PayrollBatch.subject_id)
        .where(
            PayrollBatch.payroll_period_id == period_id,
            PayrollBatch.batch_type == "normal",
            PayrollBatch.status != "cancelled",
        )
        .order_by(PayrollBatch.subject_id, PayrollBatch.id)
    )
    if lock:
        query = query.with_for_update()
    batches = list(db.scalars(query))
    selected: dict[int, PayrollBatch] = {}
    for batch in batches:
        if batch.is_effective or batch.status in {
            "draft",
            "trial",
            "confirmed",
            "locked",
            "exported",
        }:
            selected[batch.subject_id] = batch
    return list(selected.values())


def _company_subjects(db: Session, period_id: int) -> list[Subject]:
    batch_company_ids = set(
        db.scalars(
            select(Subject.company_id)
            .join(PayrollBatch, PayrollBatch.subject_id == Subject.id)
            .where(
                PayrollBatch.payroll_period_id == period_id,
                PayrollBatch.batch_type == "normal",
            )
        )
    )
    if len(batch_company_ids) > 1:
        raise PayrollConfirmationError(409, "工资期间包含多个目标公司，不能整批确认")
    query = select(Subject)
    if batch_company_ids:
        query = query.where(Subject.company_id == next(iter(batch_company_ids)))
    subjects = list(db.scalars(query.order_by(Subject.id)))
    if not subjects:
        raise PayrollConfirmationError(409, "尚未维护工资归属主体")
    if len({subject.company_id for subject in subjects}) != 1:
        raise PayrollConfirmationError(409, "当前系统只能为一个目标公司确认工资")
    return subjects


def _latest_trial(db: Session, batch_id: int, *, lock: bool = False) -> PayrollTrialRun | None:
    query = (
        select(PayrollTrialRun)
        .where(PayrollTrialRun.payroll_batch_id == batch_id)
        .order_by(PayrollTrialRun.id.desc())
        .limit(1)
    )
    if lock:
        query = query.with_for_update()
    return db.scalar(query)


def mark_trial_viewed(db: Session, batch_id: int, trial_id: int) -> None:
    trial = db.scalar(
        select(PayrollTrialRun)
        .where(
            PayrollTrialRun.id == trial_id,
            PayrollTrialRun.payroll_batch_id == batch_id,
        )
        .with_for_update()
    )
    if trial is None:
        return
    if trial.viewed_at is None:
        trial.viewed_at = _now()
        db.commit()


def mark_latest_trial_viewed(db: Session, batch_id: int) -> None:
    trial = _latest_trial(db, batch_id, lock=True)
    if trial is None:
        return
    if trial.viewed_at is None:
        trial.viewed_at = _now()
        db.commit()


def _batch_blockers(db: Session, batch: PayrollBatch) -> list[str]:
    blockers: list[str] = []
    if batch.status in {"confirmed", "locked", "exported"}:
        return blockers
    if batch.status not in {"draft", "trial"}:
        return [f"{batch.subject_id}批次当前状态为{batch.status}，不能重复确认"]
    trial = _latest_trial(db, batch.id)
    if trial is None:
        return blockers + ["尚未生成试算"]
    if trial.viewed_at is None:
        blockers.append("最新试算尚未查看")
    result = get_trial(db, batch.id)
    if result is None:
        blockers.append("尚未生成试算")
    else:
        blockers.extend(result["confirmation_blockers"])
        if result["total_count"] == 0:
            blockers.append("批次没有可确认的员工结果")
    return blockers


def _context(
    db: Session, period_id: int, *, lock: bool = False
) -> tuple[PayrollPeriod, list[Subject], list[PayrollBatch], list[str]]:
    period = _period(db, period_id, lock=lock)
    subjects = _company_subjects(db, period_id)
    batches = _batches(db, period_id, lock=lock)
    by_subject = {batch.subject_id: batch for batch in batches}
    blockers = [
        f"{subject.name}缺少正常工资批次" for subject in subjects if subject.id not in by_subject
    ]
    for batch in batches:
        blockers.extend(_batch_blockers(db, batch))
    return period, subjects, batches, blockers


def confirmation_state(db: Session, period_id: int) -> dict[str, Any]:
    period, subjects, batches, blockers = _context(db, period_id)
    statuses = [batch.status for batch in batches]
    confirmed = (
        len(statuses) == len(subjects)
        and bool(statuses)
        and all(status in {"confirmed", "locked", "exported"} for status in statuses)
    )
    locked = (
        len(statuses) == len(subjects)
        and bool(statuses)
        and all(status in {"locked", "exported"} for status in statuses)
    )
    return {
        "period_id": period.id,
        "period": f"{period.year:04d}-{period.month:02d}",
        "subject_count": len(subjects),
        "batch_count": len(batches),
        "batches": [
            {
                "id": batch.id,
                "subject_id": batch.subject_id,
                "status": batch.status,
                "confirmed_trial_id": batch.confirmed_trial_id,
                "confirmed_at": batch.confirmed_at,
                "locked_at": batch.locked_at,
            }
            for batch in batches
        ],
        "confirmed": confirmed,
        "locked": locked,
        "can_confirm": not blockers and not confirmed,
        "can_lock": confirmed and not locked,
        "blockers": [] if confirmed else blockers,
    }


def _decimal(value: Any) -> Decimal:
    return Decimal(str(value or "0"))


def _create_records(db: Session, batch: PayrollBatch, trial: PayrollTrialRun) -> None:
    if db.scalar(select(PayrollRecord.id).where(PayrollRecord.payroll_batch_id == batch.id)):
        raise PayrollConfirmationError(409, "该批次已经生成工资台账，不能重复确认")
    for result in trial.results:
        amounts = result.get("amounts") or {}
        snapshot = result.get("snapshot") or {}
        gross = _decimal(amounts["gross"])
        employee_social = _decimal(amounts.get("employee_social"))
        employee_housing = _decimal(amounts.get("employee_housing"))
        record = PayrollRecord(
            payroll_batch_id=batch.id,
            payroll_period_id=batch.payroll_period_id,
            subject_id=batch.subject_id,
            employee_id=result["employee_id"],
            snapshot_id_number=str(snapshot.get("id_number") or ""),
            snapshot_employee_no=str(snapshot.get("employee_no") or ""),
            snapshot_employee_name=str(snapshot.get("name") or result.get("employee_name") or ""),
            snapshot_department_name=snapshot.get("department_name"),
            snapshot_position_title=snapshot.get("position_title"),
            snapshot_level_code=snapshot.get("level_code"),
            snapshot_level_number=snapshot.get("level_number"),
            snapshot_fixed_salary=_decimal(snapshot.get("fixed_salary")),
            snapshot_performance_base=_decimal(snapshot.get("performance_base")),
            snapshot_base_city_name=snapshot.get("base_city_name"),
            snapshot_bank_account=snapshot.get("bank_account"),
            gross_amount=gross,
            deduction_amount=employee_social + employee_housing,
            net_amount=_decimal(amounts["untaxed_amount"]),
            employer_cost_amount=_decimal(amounts["employer_cost"]),
            calculation_status="trial",
        )
        db.add(record)
        db.flush()
        for index, item in enumerate(result.get("items") or []):
            db.add(
                PayrollItem(
                    payroll_record_id=record.id,
                    item_code=item["code"],
                    item_name=item["name"],
                    item_category=item["category"],
                    amount=_decimal(item["amount"]),
                    source_type="supplement" if batch.batch_type == "supplement" else "trial",
                    source_reference=(
                        f"{batch.id}:{batch.name}"
                        if batch.batch_type == "supplement"
                        else str(trial.id)
                    ),
                    in_housing_fund_base=item["code"] == "fixed_salary",
                    sort_order=index,
                )
            )
        seen_steps: set[str] = set()
        for index, step in enumerate(result.get("steps") or []):
            code = str(step["code"])
            if code in seen_steps:
                code = f"{code}_{index}"
            seen_steps.add(code)
            db.add(
                PayrollCalculationDetail(
                    payroll_record_id=record.id,
                    step_code=code,
                    formula_text=step["formula"],
                    inputs=step.get("inputs") or {},
                    amount=_decimal(step["amount"]),
                    source_type="supplement" if batch.batch_type == "supplement" else "trial",
                )
            )
        db.flush()
        record.calculation_status = "confirmed"
        db.flush()


def confirm_period(db: Session, period_id: int) -> dict[str, Any]:
    period, subjects, batches, blockers = _context(db, period_id, lock=True)
    if (
        len(batches) == len(subjects)
        and batches
        and all(batch.status in {"confirmed", "locked", "exported"} for batch in batches)
    ):
        return confirmation_state(db, period_id)
    if blockers:
        raise PayrollConfirmationError(409, "；".join(blockers))
    now = _now()
    for batch in batches:
        if batch.status in {"confirmed", "locked", "exported"}:
            continue
        trial = _latest_trial(db, batch.id, lock=True)
        assert trial is not None
        _create_records(db, batch, trial)
        batch.status = "confirmed"
        batch.confirmed_trial_id = trial.id
        batch.confirmed_input_fingerprint = trial.input_fingerprint
        batch.confirmed_at = now
    db.commit()
    return confirmation_state(db, period.id)


def lock_period(db: Session, period_id: int) -> dict[str, Any]:
    period, subjects, batches, _ = _context(db, period_id, lock=True)
    if len(batches) != len(subjects):
        raise PayrollConfirmationError(409, "本期主体正常工资批次尚未齐全")
    if not all(batch.status in {"confirmed", "locked", "exported"} for batch in batches):
        raise PayrollConfirmationError(409, "必须先整批确认后才能锁定")
    now = _now()
    for batch in batches:
        records = list(
            db.scalars(
                select(PayrollRecord)
                .where(PayrollRecord.payroll_batch_id == batch.id)
                .order_by(PayrollRecord.id)
                .with_for_update()
            )
        )
        if not records:
            raise PayrollConfirmationError(409, "确认批次缺少工资台账记录")
        for record in records:
            if record.calculation_status == "confirmed":
                record.calculation_status = "locked"
            elif record.calculation_status not in {"locked"}:
                raise PayrollConfirmationError(409, "工资台账状态不允许锁定")
        if batch.status == "confirmed":
            batch.status = "locked"
            batch.locked_at = now
    db.flush()
    try:
        for batch in batches:
            activate_locked_correction(db, batch)
    except PayrollCorrectionError as exc:
        raise PayrollConfirmationError(exc.status_code, exc.detail) from exc
    db.commit()
    return confirmation_state(db, period.id)
