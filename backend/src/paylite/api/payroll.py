from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from paylite.api.deps import get_db
from paylite.api.schemas import (
    AttendanceIncentiveOut,
    PayrollBatchCreate,
    PayrollBatchOut,
    PayrollConfirmationOut,
    PayrollCorrectionCreate,
    PayrollCorrectionInputOut,
    PayrollCorrectionInputPatch,
    PayrollCorrectionOut,
    PayrollDataPreparationOut,
    PayrollLedgerOut,
    PayrollPeriodCreate,
    PayrollPeriodOut,
    PayrollPreparationItemOut,
    PayrollScopeOut,
    PayrollSubjectOut,
    PayrollSupplementInput,
    PayrollSupplementStatusOut,
    PayrollTrialOut,
    PayrollWorkbenchOut,
)
from paylite.db.models import PayrollBatch, PayrollPeriod
from paylite.services import payroll_supplement
from paylite.services.attendance_incentive import (
    AttendanceIncentiveError,
    calculate_incentive,
    get_incentive,
)
from paylite.services.payroll_confirmation import (
    PayrollConfirmationError,
    confirm_period,
    confirmation_state,
    lock_period,
    mark_latest_trial_viewed,
)
from paylite.services.payroll_correction import (
    PayrollCorrectionError,
    cancel_correction,
    get_correction_inputs,
    list_corrections,
    request_correction,
    update_correction_inputs,
)
from paylite.services.payroll_ledger import PayrollLedgerError, get_ledger
from paylite.services.payroll_trial import TrialError, get_trial, run_trial
from paylite.services.payroll_workbench import (
    BatchType,
    DataPreparation,
    EmployeeScope,
    PayrollWorkbenchError,
    batch_scope_and_preparation,
    create_batch,
    find_or_create_period,
    get_batch_subject,
    get_period,
    get_period_by_value,
    list_batches,
    list_periods,
    period_batch_counts,
)

router = APIRouter(prefix="/payroll", tags=["payroll"])


@router.get("/periods/{period_id}/attendance-incentive", response_model=AttendanceIncentiveOut)
def get_attendance_incentive(period_id: int, db: Session = Depends(get_db)):
    try:
        return get_incentive(db, period_id)
    except AttendanceIncentiveError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.post("/periods/{period_id}/attendance-incentive", response_model=AttendanceIncentiveOut)
def post_attendance_incentive(period_id: int, db: Session = Depends(get_db)):
    try:
        return calculate_incentive(db, period_id)
    except AttendanceIncentiveError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.get("/batches/{batch_id}/trial", response_model=PayrollTrialOut | None)
def get_batch_trial(batch_id: int, db: Session = Depends(get_db)):
    try:
        mark_latest_trial_viewed(db, batch_id)
        batch = db.get(PayrollBatch, batch_id)
        if batch and batch.batch_type == "supplement":
            return payroll_supplement.get_trial(db, batch_id)
        return get_trial(db, batch_id)
    except (TrialError, PayrollConfirmationError, payroll_supplement.SupplementError) as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.get("/periods/{period_id}/confirmation", response_model=PayrollConfirmationOut)
def get_confirmation(period_id: int, db: Session = Depends(get_db)):
    try:
        return confirmation_state(db, period_id)
    except PayrollConfirmationError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.post("/periods/{period_id}/confirmation", response_model=PayrollConfirmationOut)
def post_confirmation(period_id: int, db: Session = Depends(get_db)):
    try:
        return confirm_period(db, period_id)
    except PayrollConfirmationError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.post("/periods/{period_id}/lock", response_model=PayrollConfirmationOut)
def post_lock(period_id: int, db: Session = Depends(get_db)):
    try:
        return lock_period(db, period_id)
    except PayrollConfirmationError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.post(
    "/batches/{batch_id}/confirm",
    response_model=PayrollConfirmationOut | PayrollSupplementStatusOut,
)
def post_batch_confirmation(batch_id: int, db: Session = Depends(get_db)):
    batch = db.get(PayrollBatch, batch_id)
    if batch is None:
        raise HTTPException(404, "工资批次不存在")
    try:
        if batch.batch_type == "supplement":
            return payroll_supplement.confirm(db, batch_id)
        return confirm_period(db, batch.payroll_period_id)
    except (PayrollConfirmationError, payroll_supplement.SupplementError) as exc:
        db.rollback()
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.post(
    "/batches/{batch_id}/lock", response_model=PayrollConfirmationOut | PayrollSupplementStatusOut
)
def post_batch_lock(batch_id: int, db: Session = Depends(get_db)):
    batch = db.get(PayrollBatch, batch_id)
    if batch is None:
        raise HTTPException(404, "工资批次不存在")
    try:
        if batch.batch_type == "supplement":
            return payroll_supplement.lock(db, batch_id)
        return lock_period(db, batch.payroll_period_id)
    except (PayrollConfirmationError, payroll_supplement.SupplementError) as exc:
        db.rollback()
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.get("/batches/{batch_id}/corrections", response_model=list[PayrollCorrectionOut])
def get_batch_corrections(batch_id: int, db: Session = Depends(get_db)):
    try:
        return list_corrections(db, batch_id)
    except PayrollCorrectionError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.post(
    "/batches/{batch_id}/corrections",
    response_model=PayrollCorrectionOut,
    status_code=status.HTTP_201_CREATED,
)
def post_batch_correction(
    batch_id: int, payload: PayrollCorrectionCreate, db: Session = Depends(get_db)
):
    try:
        return request_correction(db, batch_id, payload.reason)
    except PayrollCorrectionError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.get("/corrections/{correction_id}/inputs", response_model=list[PayrollCorrectionInputOut])
def get_correction_input_rows(correction_id: int, db: Session = Depends(get_db)):
    try:
        return get_correction_inputs(db, correction_id)
    except PayrollCorrectionError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.put("/corrections/{correction_id}/inputs", response_model=list[PayrollCorrectionInputOut])
def put_correction_input_row(
    correction_id: int,
    payload: PayrollCorrectionInputPatch,
    db: Session = Depends(get_db),
):
    try:
        attendance = (
            payload.attendance.model_dump(exclude_unset=True, exclude_none=True)
            if payload.attendance
            else None
        )
        return update_correction_inputs(
            db,
            correction_id,
            payload.employee_id,
            payload.source_note,
            attendance,
            payload.performance_coefficient,
        )
    except PayrollCorrectionError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.post("/corrections/{correction_id}/cancel", response_model=PayrollCorrectionOut)
def post_correction_cancel(correction_id: int, db: Session = Depends(get_db)):
    try:
        return cancel_correction(db, correction_id)
    except PayrollCorrectionError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.get("/ledger", response_model=PayrollLedgerOut)
def get_payroll_ledger(
    period_id: int | None = Query(default=None),
    period: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    subject_id: int | None = Query(default=None),
    department: str | None = Query(default=None),
    employee_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    if period_id is None and period is None:
        raise HTTPException(422, "必须提供工资期间")
    try:
        resolved_period_id = period_id
        if resolved_period_id is None:
            resolved_period_id = get_period_by_value(db, period).id  # type: ignore[arg-type]
        return get_ledger(
            db,
            resolved_period_id,
            subject_id=subject_id,
            department=department,
            employee_id=employee_id,
        )
    except (PayrollLedgerError, PayrollWorkbenchError) as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.get("/batches/{batch_id}", response_model=PayrollBatchOut)
def get_batch(batch_id: int, db: Session = Depends(get_db)):
    batch = db.get(PayrollBatch, batch_id)
    if batch is None:
        raise HTTPException(404, "工资批次不存在")
    period = get_period(db, batch.payroll_period_id)
    return _batch_out(db, period, batch)


@router.get("/batches/{batch_id}/supplement-inputs", response_model=list[PayrollSupplementInput])
def get_supplement_inputs(batch_id: int, db: Session = Depends(get_db)):
    try:
        return payroll_supplement.list_inputs(db, batch_id)
    except payroll_supplement.SupplementError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.put("/batches/{batch_id}/supplement-inputs", response_model=list[PayrollSupplementInput])
def put_supplement_inputs(
    batch_id: int, payload: list[PayrollSupplementInput], db: Session = Depends(get_db)
):
    try:
        return payroll_supplement.replace_inputs(
            db, batch_id, [row.model_dump() for row in payload]
        )
    except payroll_supplement.SupplementError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.post("/batches/{batch_id}/trial", response_model=PayrollTrialOut)
def post_batch_trial(batch_id: int, db: Session = Depends(get_db)):
    try:
        batch = db.get(PayrollBatch, batch_id)
        if batch and batch.batch_type == "supplement":
            return payroll_supplement.run_trial(db, batch_id)
        return run_trial(db, batch_id)
    except (TrialError, payroll_supplement.SupplementError) as exc:
        db.rollback()
        raise HTTPException(exc.status_code, exc.detail) from exc


BatchStatus = Literal["draft", "trial", "confirmed", "locked", "exported", "cancelled"]


def _period_out(db: Session, period: PayrollPeriod) -> PayrollPeriodOut:
    batch_count, normal_batch_count = period_batch_counts(db, period.id)
    return PayrollPeriodOut(
        id=period.id,
        year=period.year,
        month=period.month,
        period=f"{period.year:04d}-{period.month:02d}",
        period_start=period.period_start,
        period_end=period.period_end,
        payment_date=period.actual_payment_date,
        payment_date_confirmed=period.actual_payment_date is not None,
        batch_count=batch_count,
        normal_batch_count=normal_batch_count,
    )


def _preparation_out(data: DataPreparation) -> PayrollDataPreparationOut:
    def item_out(item) -> PayrollPreparationItemOut:
        return PayrollPreparationItemOut(
            status=item.status,
            prepared_count=item.prepared_count,
            missing_count=item.missing_count,
            message=item.message,
        )

    return PayrollDataPreparationOut(
        attendance=item_out(data.attendance),
        performance=item_out(data.performance),
        city_rules=item_out(data.city_rules),
        overall_status=data.overall_status,
    )


def _scope_out(period: PayrollPeriod, scope: EmployeeScope) -> PayrollScopeOut:
    criteria: dict[str, object] = {"period": f"{period.year:04d}-{period.month:02d}"}
    if scope.source == "confirmed_trial_snapshot":
        criteria["confirmed_snapshot"] = True
    elif scope.source == "supplement_inputs":
        criteria["source"] = "supplement_inputs"
    else:
        criteria.update(
            hire_date_at_or_before_period_end=True,
            termination_date_after_or_equal_period_start=True,
            assignment_effective_during_period=True,
        )
    return PayrollScopeOut(
        source=scope.source,
        criteria=criteria,
        employee_count=len(scope.employee_ids),
        employee_ids=scope.employee_ids,
        ambiguous_employee_ids=scope.ambiguous_employee_ids,
        status=scope.status,
    )


def _batch_out(db: Session, period: PayrollPeriod, batch: PayrollBatch) -> PayrollBatchOut:
    subject = get_batch_subject(db, batch)
    scope, preparation = batch_scope_and_preparation(db, period, batch)
    payment_date = (
        batch.payment_date if batch.batch_type == "supplement" else period.actual_payment_date
    )
    return PayrollBatchOut(
        id=batch.id,
        period_id=period.id,
        subject=PayrollSubjectOut(id=subject.id, code=subject.code, name=subject.name),
        batch_type=batch.batch_type,
        batch_no=batch.batch_no,
        name=batch.name,
        status=batch.status,
        is_effective=batch.is_effective,
        scope=_scope_out(period, scope),
        data_preparation=_preparation_out(preparation),
        payment_date=payment_date,
        payment_date_confirmed=payment_date is not None,
    )


def _raise_service_error(exc: PayrollWorkbenchError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/periods", response_model=list[PayrollPeriodOut])
def get_periods(db: Session = Depends(get_db)):
    return [_period_out(db, period) for period in list_periods(db)]


@router.post("/periods", response_model=PayrollPeriodOut)
def post_period(payload: PayrollPeriodCreate, db: Session = Depends(get_db)):
    try:
        period, _ = find_or_create_period(db, payload.period)
    except PayrollWorkbenchError as exc:
        db.rollback()
        _raise_service_error(exc)
    return _period_out(db, period)


@router.get("/periods/{period_id}/batches", response_model=list[PayrollBatchOut])
def get_period_batches(
    period_id: int,
    subject_id: int | None = Query(default=None),
    batch_type: BatchType | None = Query(default=None),
    batch_status: BatchStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
):
    try:
        period = get_period(db, period_id)
        batches = list_batches(
            db,
            period,
            subject_id=subject_id,
            batch_type=batch_type,
            status=batch_status,
        )
    except PayrollWorkbenchError as exc:
        _raise_service_error(exc)
    return [_batch_out(db, period, batch) for batch in batches]


@router.post(
    "/periods/{period_id}/batches",
    response_model=PayrollBatchOut,
    status_code=status.HTTP_201_CREATED,
)
def post_batch(
    period_id: int,
    payload: PayrollBatchCreate,
    db: Session = Depends(get_db),
):
    try:
        batch = create_batch(
            db,
            period_id,
            payload.subject_id,
            payload.batch_type,
            payload.name,
            payload.payment_date,
        )
        period = get_period(db, period_id)
    except PayrollWorkbenchError as exc:
        db.rollback()
        _raise_service_error(exc)
    return _batch_out(db, period, batch)


@router.get("/workbench", response_model=PayrollWorkbenchOut)
def get_workbench(
    period: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    subject_id: int | None = Query(default=None),
    batch_type: BatchType | None = Query(default=None),
    batch_status: BatchStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
):
    try:
        periods = list_periods(db)
        selected = get_period_by_value(db, period) if period else (periods[0] if periods else None)
        selected_out = _period_out(db, selected) if selected else None
        batches = []
        if selected:
            batches = [
                _batch_out(db, selected, batch)
                for batch in list_batches(
                    db,
                    selected,
                    subject_id=subject_id,
                    batch_type=batch_type,
                    status=batch_status,
                )
            ]
    except PayrollWorkbenchError as exc:
        _raise_service_error(exc)
    return PayrollWorkbenchOut(
        period=selected_out,
        periods=[_period_out(db, item) for item in periods],
        batches=batches,
    )
