from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from paylite.api.deps import get_db
from paylite.api.schemas import (
    PayrollBatchCreate,
    PayrollBatchOut,
    PayrollDataPreparationOut,
    PayrollPeriodCreate,
    PayrollPeriodOut,
    PayrollPreparationItemOut,
    PayrollScopeOut,
    PayrollSubjectOut,
    PayrollTrialOut,
    PayrollWorkbenchOut,
)
from paylite.db.models import PayrollBatch, PayrollPeriod
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


@router.get("/batches/{batch_id}/trial", response_model=PayrollTrialOut | None)
def get_batch_trial(batch_id: int, db: Session = Depends(get_db)):
    try:
        return get_trial(db, batch_id)
    except TrialError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.get("/batches/{batch_id}", response_model=PayrollBatchOut)
def get_batch(batch_id: int, db: Session = Depends(get_db)):
    batch = db.get(PayrollBatch, batch_id)
    if batch is None:
        raise HTTPException(404, "工资批次不存在")
    period = get_period(db, batch.payroll_period_id)
    return _batch_out(db, period, batch)


@router.post("/batches/{batch_id}/trial", response_model=PayrollTrialOut)
def post_batch_trial(batch_id: int, db: Session = Depends(get_db)):
    try:
        return run_trial(db, batch_id)
    except TrialError as exc:
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
    return PayrollScopeOut(
        source="employee_assignment_for_period",
        criteria={
            "period": f"{period.year:04d}-{period.month:02d}",
            "hire_date_at_or_before_period_end": True,
            "termination_date_after_or_equal_period_start": True,
            "assignment_effective_during_period": True,
        },
        employee_count=len(scope.employee_ids),
        employee_ids=scope.employee_ids,
        ambiguous_employee_ids=scope.ambiguous_employee_ids,
        status=scope.status,
    )


def _batch_out(db: Session, period: PayrollPeriod, batch: PayrollBatch) -> PayrollBatchOut:
    subject = get_batch_subject(db, batch)
    scope, preparation = batch_scope_and_preparation(db, period, batch)
    return PayrollBatchOut(
        id=batch.id,
        period_id=period.id,
        subject=PayrollSubjectOut(id=subject.id, code=subject.code, name=subject.name),
        batch_type=batch.batch_type,
        batch_no=batch.batch_no,
        name=batch.name,
        status=batch.status,
        scope=_scope_out(period, scope),
        data_preparation=_preparation_out(preparation),
        payment_date=period.actual_payment_date,
        payment_date_confirmed=period.actual_payment_date is not None,
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
