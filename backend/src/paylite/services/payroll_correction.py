"""整批更正及有效版本切换用例。"""

from copy import deepcopy
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from paylite.db.models import CorrectionBatch, PayrollBatch, PayrollRecord, PayrollTrialRun


class PayrollCorrectionError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _now() -> datetime:
    return datetime.now(UTC)


def _out(
    correction: CorrectionBatch, original: PayrollBatch, replacement: PayrollBatch
) -> dict[str, Any]:
    return {
        "id": correction.id,
        "original_batch_id": original.id,
        "replacement_batch_id": replacement.id,
        "reason": correction.reason,
        "input_history": (correction.input_overrides or {}).get("history", []),
        "status": correction.status,
        "created_at": correction.created_at,
        "original_status": original.status,
        "replacement_status": replacement.status,
        "replacement_is_effective": replacement.is_effective,
    }


def _load_relation(db: Session, correction_id: int, *, lock: bool = False):
    query = select(CorrectionBatch).where(CorrectionBatch.id == correction_id)
    if lock:
        query = query.with_for_update()
    correction = db.scalar(query)
    if correction is None:
        raise PayrollCorrectionError(404, "更正记录不存在")
    original = db.get(PayrollBatch, correction.original_batch_id)
    replacement = db.get(PayrollBatch, correction.replacement_batch_id)
    if original is None or replacement is None:
        raise PayrollCorrectionError(409, "更正关联的工资批次不存在")
    return correction, original, replacement


def request_correction(db: Session, batch_id: int, reason: str) -> dict[str, Any]:
    reason = reason.strip()
    if not reason:
        raise PayrollCorrectionError(422, "更正原因不能为空")

    original = db.scalar(select(PayrollBatch).where(PayrollBatch.id == batch_id).with_for_update())
    if original is None or original.batch_type != "normal":
        raise PayrollCorrectionError(404, "正常工资批次不存在")
    if original.status not in {"confirmed", "locked", "exported"}:
        raise PayrollCorrectionError(409, "只有已确认的正常工资批次才能发起更正")
    if not original.is_effective:
        raise PayrollCorrectionError(409, "该批次已被替代，请对最新有效版本发起更正")
    source_trial = (
        db.get(PayrollTrialRun, original.confirmed_trial_id)
        if original.confirmed_trial_id
        else None
    )
    if (
        source_trial is None
        or source_trial.payroll_batch_id != original.id
        or not source_trial.input_snapshot.get("employees")
    ):
        raise PayrollCorrectionError(409, "原批次缺少已确认的完整试算快照")

    pending = db.scalar(
        select(CorrectionBatch)
        .where(
            CorrectionBatch.original_batch_id == batch_id,
            CorrectionBatch.status == "requested",
        )
        .order_by(CorrectionBatch.id.desc())
    )
    if pending is not None:
        _, pending_original, pending_replacement = _load_relation(db, pending.id)
        return _out(pending, pending_original, pending_replacement)

    next_batch_no = db.scalar(
        select(func.coalesce(func.max(PayrollBatch.batch_no), 0) + 1).where(
            PayrollBatch.subject_id == original.subject_id,
            PayrollBatch.payroll_period_id == original.payroll_period_id,
            PayrollBatch.batch_type == "normal",
        )
    )
    replacement = PayrollBatch(
        subject_id=original.subject_id,
        payroll_period_id=original.payroll_period_id,
        batch_type="normal",
        batch_no=int(next_batch_no or 1),
        status="draft",
        is_effective=False,
        name=f"{original.name or '正常工资'}（更正）",
    )
    db.add(replacement)
    db.flush()
    correction = CorrectionBatch(
        original_batch_id=original.id,
        replacement_batch_id=replacement.id,
        reason=reason,
        status="requested",
        created_at=_now(),
    )
    db.add(correction)
    db.commit()
    db.refresh(correction)
    return _out(correction, original, replacement)


def get_correction_inputs(db: Session, correction_id: int) -> list[dict[str, Any]]:
    correction, original, _ = _load_relation(db, correction_id)
    source = db.get(PayrollTrialRun, original.confirmed_trial_id)
    snapshot = source.input_snapshot
    attendance = {row["employee_id"]: row for row in snapshot["attendance"]}
    performance = {row["employee_id"]: row for row in snapshot["performance"]}
    overrides = correction.input_overrides or {}
    result = []
    for employee in snapshot["employees"]:
        employee_id = employee["id"]
        key = str(employee_id)
        attendance_row = attendance.get(employee_id)
        performance_row = performance.get(employee_id)
        result.append(
            {
                "employee_id": employee_id,
                "employee_name": employee["name"],
                "attendance": (
                    {
                        **attendance_row,
                        **overrides.get("attendance", {}).get(key, {}).get("values", {}),
                    }
                    if attendance_row
                    else None
                ),
                "performance_coefficient": (
                    overrides.get("performance", {})
                    .get(key, {})
                    .get("values", {})
                    .get("coefficient", performance_row["coefficient"])
                    if performance_row
                    else None
                ),
                "source_note": overrides.get("attendance", {}).get(key, {}).get("source_note")
                or overrides.get("performance", {}).get(key, {}).get("source_note"),
            }
        )
    return result


def update_correction_inputs(
    db: Session,
    correction_id: int,
    employee_id: int,
    source_note: str,
    attendance: dict[str, Any] | None,
    performance_coefficient: Decimal | None,
) -> list[dict[str, Any]]:
    correction = db.get(CorrectionBatch, correction_id)
    if correction is None:
        raise PayrollCorrectionError(404, "更正记录不存在")
    replacement = db.get(PayrollBatch, correction.replacement_batch_id, with_for_update=True)
    correction = db.scalar(
        select(CorrectionBatch).where(CorrectionBatch.id == correction_id).with_for_update()
    )
    if correction.status != "requested" or replacement.status not in {"draft", "trial"}:
        raise PayrollCorrectionError(409, "只有未确认的替代版本可以修正输入")
    if not attendance and performance_coefficient is None:
        raise PayrollCorrectionError(422, "至少填写一项修正输入")
    source_note = source_note.strip()
    if not source_note:
        raise PayrollCorrectionError(422, "修正输入必须填写来源说明")
    original = db.get(PayrollBatch, correction.original_batch_id)
    source = db.get(PayrollTrialRun, original.confirmed_trial_id)
    snapshot = source.input_snapshot
    if employee_id not in {row["id"] for row in snapshot["employees"]}:
        raise PayrollCorrectionError(422, "员工不属于原批次")
    key = str(employee_id)
    overrides = deepcopy(correction.input_overrides or {})
    if attendance:
        base = next(
            (row for row in snapshot["attendance"] if row["employee_id"] == employee_id), None
        )
        if base is None:
            raise PayrollCorrectionError(422, "原批次没有该员工的考勤输入")
        old = overrides.get("attendance", {}).get(key, {}).get("values", {})
        values = {
            **old,
            **{
                name: str(value) if isinstance(value, Decimal) else value
                for name, value in attendance.items()
            },
        }
        merged = {**base, **values}
        work_days = Decimal(str(merged["expected_work_days"]))
        paid = Decimal(str(merged["paid_leave_days"]))
        unpaid = Decimal(str(merged["unpaid_leave_days"]))
        missed = int(merged["missed_punch_count"])
        corrected = int(merged["corrected_punch_count"])
        period_days = (
            datetime.fromisoformat(snapshot["period"]["period_end"])
            - datetime.fromisoformat(snapshot["period"]["period_start"])
        ).days + 1
        if (
            work_days <= 0
            or work_days > period_days
            or paid + unpaid > work_days
            or int(merged["late_minutes"]) > work_days * 480
            or int(merged["early_leave_minutes"]) > work_days * 480
            or missed > work_days * 2
            or corrected > missed
        ):
            raise PayrollCorrectionError(422, "考勤修正值超出本月允许范围")
        values.update(
            {
                "leave_days": str(paid + unpaid),
                "leave_type": "mixed"
                if paid and unpaid
                else "paid"
                if paid
                else "unpaid"
                if unpaid
                else "none",
                "punch_corrected": bool(missed and corrected == missed),
            }
        )
        overrides.setdefault("attendance", {})[key] = {"values": values, "source_note": source_note}
    if performance_coefficient is not None:
        if not any(row["employee_id"] == employee_id for row in snapshot["performance"]):
            raise PayrollCorrectionError(422, "原批次没有该员工的绩效输入")
        overrides.setdefault("performance", {})[key] = {
            "values": {"coefficient": str(performance_coefficient)},
            "source_note": source_note,
        }
    overrides["history"] = [
        *overrides.get("history", []),
        {
            "employee_id": employee_id,
            "source_note": source_note,
            "attendance": {
                name: str(value) if isinstance(value, Decimal) else value
                for name, value in (attendance or {}).items()
            },
            "performance_coefficient": (
                str(performance_coefficient) if performance_coefficient is not None else None
            ),
            "created_at": _now().isoformat(),
        },
    ]
    correction.input_overrides = overrides
    db.commit()
    return get_correction_inputs(db, correction_id)


def _lock_batches(db: Session, *batch_ids: int) -> dict[int, PayrollBatch]:
    rows = list(
        db.scalars(
            select(PayrollBatch)
            .where(PayrollBatch.id.in_(batch_ids))
            .order_by(PayrollBatch.id)
            .with_for_update()
        )
    )
    return {row.id: row for row in rows}


def activate_locked_correction(db: Session, replacement: PayrollBatch) -> None:
    correction = db.scalar(
        select(CorrectionBatch)
        .where(CorrectionBatch.replacement_batch_id == replacement.id)
        .with_for_update()
    )
    if correction is None or correction.status == "applied":
        return
    if correction.status != "requested":
        raise PayrollCorrectionError(409, "已取消的更正不能生效")
    original = db.get(PayrollBatch, correction.original_batch_id)
    if original is None:
        raise PayrollCorrectionError(409, "更正关联的原批次不存在")
    if replacement.status != "locked":
        raise PayrollCorrectionError(409, "替代版本必须锁定后才能生效")
    from paylite.services.payroll_trial import get_trial

    trial = get_trial(db, replacement.id)
    if (
        trial is None
        or trial["id"] != replacement.confirmed_trial_id
        or trial["input_fingerprint"] != replacement.confirmed_input_fingerprint
        or not trial["ready_for_confirmation"]
    ):
        raise PayrollCorrectionError(409, "替代版本试算已失效或未完成全员确认")
    if not original.is_effective:
        raise PayrollCorrectionError(409, "原批次已被其他更正替代")

    original_employee_ids = set(
        db.scalars(
            select(PayrollRecord.employee_id).where(PayrollRecord.payroll_batch_id == original.id)
        )
    )
    replacement_employee_ids = set(
        db.scalars(
            select(PayrollRecord.employee_id).where(
                PayrollRecord.payroll_batch_id == replacement.id
            )
        )
    )
    if not original_employee_ids or original_employee_ids != replacement_employee_ids:
        raise PayrollCorrectionError(409, "替代版本必须覆盖原批次全体员工")
    if (
        db.scalar(
            select(PayrollRecord.id).where(
                PayrollRecord.payroll_batch_id == replacement.id,
                PayrollRecord.calculation_status != "locked",
            )
        )
        is not None
    ):
        raise PayrollCorrectionError(409, "替代版本仍有未锁定的工资记录")

    original.is_effective = False
    db.flush()
    replacement.is_effective = True
    correction.status = "applied"


def cancel_correction(db: Session, correction_id: int) -> dict[str, Any]:
    correction = db.get(CorrectionBatch, correction_id)
    if correction is None:
        raise PayrollCorrectionError(404, "更正记录不存在")
    batches = _lock_batches(db, correction.original_batch_id, correction.replacement_batch_id)
    correction = db.scalar(
        select(CorrectionBatch).where(CorrectionBatch.id == correction_id).with_for_update()
    )
    original = batches.get(correction.original_batch_id)
    replacement = batches.get(correction.replacement_batch_id)
    if original is None or replacement is None:
        raise PayrollCorrectionError(409, "更正关联的工资批次不存在")
    if correction.status == "cancelled":
        return _out(correction, original, replacement)
    if correction.status != "requested":
        raise PayrollCorrectionError(409, "已生效的更正不能取消")
    replacement.status = "cancelled"
    correction.status = "cancelled"
    db.commit()
    return _out(correction, original, replacement)


def list_corrections(db: Session, batch_id: int) -> list[dict[str, Any]]:
    original = db.get(PayrollBatch, batch_id)
    if original is None:
        raise PayrollCorrectionError(404, "工资批次不存在")
    corrections = list(
        db.scalars(
            select(CorrectionBatch)
            .where(
                (CorrectionBatch.original_batch_id == batch_id)
                | (CorrectionBatch.replacement_batch_id == batch_id)
            )
            .order_by(CorrectionBatch.id.desc())
        )
    )
    result = []
    for correction in corrections:
        _, source, replacement = _load_relation(db, correction.id)
        result.append(_out(correction, source, replacement))
    return result
