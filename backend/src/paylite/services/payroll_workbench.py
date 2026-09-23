from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date
from typing import Literal

from sqlalchemy import Select, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from paylite.db.models import (
    AttendanceRecord,
    Employee,
    EmployeeAssignment,
    EmployeeBase,
    HousingFundRule,
    PayrollBatch,
    PayrollPeriod,
    PerformanceRecord,
    SocialSecurityRule,
    Subject,
)

BatchType = Literal["normal", "supplement", "performance_supplement", "other"]


class PayrollWorkbenchError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


@dataclass(frozen=True)
class PeriodWindow:
    year: int
    month: int
    start: date
    end: date


@dataclass
class EmployeeScope:
    employee_ids: list[int]
    ambiguous_employee_ids: list[int]

    @property
    def status(self) -> str:
        if self.ambiguous_employee_ids:
            return "blocked"
        if not self.employee_ids:
            return "empty"
        return "ready"


@dataclass(frozen=True)
class PreparationItem:
    status: str
    prepared_count: int
    missing_count: int
    message: str | None = None


@dataclass(frozen=True)
class DataPreparation:
    attendance: PreparationItem
    performance: PreparationItem
    city_rules: PreparationItem
    overall_status: str


def parse_period(value: str) -> PeriodWindow:
    try:
        year, month = (int(part) for part in value.split("-"))
    except (TypeError, ValueError) as exc:
        raise PayrollWorkbenchError(422, "工资期间必须使用 YYYY-MM 格式") from exc
    if not 1 <= month <= 12 or year < 1:
        raise PayrollWorkbenchError(422, "工资期间不是有效的自然月")
    return PeriodWindow(
        year=year,
        month=month,
        start=date(year, month, 1),
        end=date(year, month, calendar.monthrange(year, month)[1]),
    )


def find_or_create_period(db: Session, period: str) -> tuple[PayrollPeriod, bool]:
    window = parse_period(period)
    try:
        with db.begin():
            existing = db.scalar(
                select(PayrollPeriod).where(
                    PayrollPeriod.year == window.year,
                    PayrollPeriod.month == window.month,
                )
            )
            if existing:
                return existing, False
            created = PayrollPeriod(
                year=window.year,
                month=window.month,
                period_start=window.start,
                period_end=window.end,
            )
            db.add(created)
            db.flush()
            return created, True
    except IntegrityError as exc:
        db.rollback()
        existing = db.scalar(
            select(PayrollPeriod).where(
                PayrollPeriod.year == window.year,
                PayrollPeriod.month == window.month,
            )
        )
        if existing:
            return existing, False
        raise exc


def get_period(db: Session, period_id: int) -> PayrollPeriod:
    period = db.get(PayrollPeriod, period_id)
    if not period:
        raise PayrollWorkbenchError(404, "工资期间不存在")
    return period


def get_period_by_value(db: Session, period: str) -> PayrollPeriod:
    window = parse_period(period)
    result = db.scalar(
        select(PayrollPeriod).where(
            PayrollPeriod.year == window.year,
            PayrollPeriod.month == window.month,
        )
    )
    if not result:
        raise PayrollWorkbenchError(404, "工资期间不存在")
    return result


def period_batch_counts(db: Session, period_id: int) -> tuple[int, int]:
    return db.execute(
        select(
            func.count(PayrollBatch.id),
            func.count(PayrollBatch.id).filter(PayrollBatch.batch_type == "normal"),
        ).where(PayrollBatch.payroll_period_id == period_id)
    ).one()


def get_subject(db: Session, subject_id: int) -> Subject:
    subject = db.get(Subject, subject_id)
    if not subject:
        raise PayrollWorkbenchError(404, "工资主体不存在")
    return subject


def get_batch_subject(db: Session, batch: PayrollBatch) -> Subject:
    subject = db.get(Subject, batch.subject_id)
    if not subject:
        raise PayrollWorkbenchError(500, "批次关联的工资主体不存在")
    return subject


def list_periods(db: Session) -> list[PayrollPeriod]:
    return list(
        db.scalars(
            select(PayrollPeriod).order_by(
                PayrollPeriod.period_start.desc(), PayrollPeriod.id.desc()
            )
        )
    )


def _active_assignment_query(period: PayrollPeriod, subject_id: int | None = None) -> Select:
    query = (
        select(Employee.id)
        .join(EmployeeAssignment, EmployeeAssignment.employee_id == Employee.id)
        .where(
            Employee.hire_date <= period.period_end,
            or_(
                Employee.termination_date.is_(None),
                Employee.termination_date >= period.period_start,
            ),
            EmployeeAssignment.effective_from <= period.period_end,
            or_(
                EmployeeAssignment.effective_to.is_(None),
                EmployeeAssignment.effective_to >= period.period_start,
            ),
        )
    )
    if subject_id is not None:
        query = query.where(EmployeeAssignment.subject_id == subject_id)
    return query


def employee_scope(db: Session, period: PayrollPeriod, subject_id: int) -> EmployeeScope:
    rows = list(db.scalars(_active_assignment_query(period, subject_id)))
    employee_ids = sorted(set(rows))
    ambiguous = [
        employee_id
        for employee_id in employee_ids
        if db.scalar(
            select(func.count(func.distinct(EmployeeAssignment.subject_id)))
            .join(Employee, Employee.id == EmployeeAssignment.employee_id)
            .where(
                EmployeeAssignment.employee_id == employee_id,
                EmployeeAssignment.effective_from <= period.period_end,
                or_(
                    EmployeeAssignment.effective_to.is_(None),
                    EmployeeAssignment.effective_to >= period.period_start,
                ),
            )
        )
        > 1
    ]
    return EmployeeScope(employee_ids=employee_ids, ambiguous_employee_ids=sorted(ambiguous))


def _preparation_item(
    *,
    employee_ids: list[int],
    prepared_ids: set[int],
    message: str | None = None,
    blocked: bool = False,
) -> PreparationItem:
    total = len(employee_ids)
    prepared = len(set(employee_ids) & prepared_ids)
    missing = total - prepared
    if total == 0:
        item_status = "not_required"
    elif blocked:
        item_status = "blocked"
    elif missing == 0:
        item_status = "ready"
    elif prepared == 0:
        item_status = "missing"
    else:
        item_status = "partial"
    return PreparationItem(item_status, prepared, missing, message)


def data_preparation(db: Session, period: PayrollPeriod, scope: EmployeeScope) -> DataPreparation:
    employee_ids = scope.employee_ids
    if not employee_ids:
        item = PreparationItem("not_required", 0, 0)
        return DataPreparation(item, item, item, "ready")
    attendance_ids = set(
        db.scalars(
            select(AttendanceRecord.employee_id).where(
                AttendanceRecord.payroll_period_id == period.id,
                AttendanceRecord.employee_id.in_(employee_ids or [-1]),
            )
        )
    )
    performance_ids = set(
        db.scalars(
            select(PerformanceRecord.employee_id).where(
                PerformanceRecord.payroll_period_id == period.id,
                PerformanceRecord.employee_id.in_(employee_ids or [-1]),
            )
        )
    )
    city_rule_exists = exists(
        select(SocialSecurityRule.id)
        .join(EmployeeBase, EmployeeBase.city_id == SocialSecurityRule.city_id)
        .where(
            EmployeeBase.employee_id == Employee.id,
            EmployeeBase.effective_from <= period.period_end,
            or_(
                EmployeeBase.effective_to.is_(None),
                EmployeeBase.effective_to >= period.period_start,
            ),
            SocialSecurityRule.effective_from <= period.period_end,
            or_(
                SocialSecurityRule.effective_to.is_(None),
                SocialSecurityRule.effective_to >= period.period_start,
            ),
            exists(
                select(HousingFundRule.id).where(
                    HousingFundRule.city_id == SocialSecurityRule.city_id,
                    HousingFundRule.effective_from == SocialSecurityRule.effective_from,
                    HousingFundRule.effective_from <= period.period_end,
                    or_(
                        HousingFundRule.effective_to.is_(None),
                        HousingFundRule.effective_to >= period.period_start,
                    ),
                )
            ),
        )
    )
    city_rule_ids = set(
        db.scalars(
            select(Employee.id).where(Employee.id.in_(employee_ids or [-1]), city_rule_exists)
        )
    )
    scope_blocked = bool(scope.ambiguous_employee_ids)
    attendance = _preparation_item(
        employee_ids=employee_ids,
        prepared_ids=attendance_ids,
        message="存在期间内跨主体任职员工" if scope_blocked else None,
        blocked=scope_blocked,
    )
    performance = _preparation_item(
        employee_ids=employee_ids,
        prepared_ids=performance_ids,
        message="存在期间内跨主体任职员工" if scope_blocked else None,
        blocked=scope_blocked,
    )
    city_rules = _preparation_item(
        employee_ids=employee_ids,
        prepared_ids=city_rule_ids,
        message="存在期间内跨主体任职员工" if scope_blocked else None,
        blocked=scope_blocked,
    )
    statuses = {attendance.status, performance.status, city_rules.status}
    overall = "blocked" if scope_blocked or "blocked" in statuses else (
        "ready" if statuses <= {"ready", "not_required"} else "partial"
    )
    return DataPreparation(attendance, performance, city_rules, overall)


def list_batches(
    db: Session,
    period: PayrollPeriod,
    *,
    subject_id: int | None = None,
    batch_type: BatchType | None = None,
    status: str | None = None,
) -> list[PayrollBatch]:
    query = select(PayrollBatch).where(PayrollBatch.payroll_period_id == period.id)
    if subject_id is not None:
        query = query.where(PayrollBatch.subject_id == subject_id)
    if batch_type is not None:
        query = query.where(PayrollBatch.batch_type == batch_type)
    if status is not None:
        query = query.where(PayrollBatch.status == status)
    return list(
        db.scalars(
            query.order_by(
                PayrollBatch.subject_id,
                PayrollBatch.batch_type,
                PayrollBatch.batch_no,
            )
        )
    )


def create_batch(
    db: Session,
    period_id: int,
    subject_id: int,
    batch_type: BatchType,
    name: str | None,
) -> PayrollBatch:
    try:
        with db.begin():
            period = get_period(db, period_id)
            db.scalar(
                select(PayrollPeriod)
                .where(PayrollPeriod.id == period.id)
                .with_for_update()
            )
            subject = get_subject(db, subject_id)
            if batch_type == "normal":
                existing = db.scalar(
                    select(PayrollBatch).where(
                        PayrollBatch.payroll_period_id == period.id,
                        PayrollBatch.subject_id == subject.id,
                        PayrollBatch.batch_type == "normal",
                    )
                )
                if existing:
                    raise PayrollWorkbenchError(409, "该主体在此工资期间已有正常批次")
            batch = PayrollBatch(
                subject_id=subject.id,
                payroll_period_id=period.id,
                batch_type=batch_type,
                batch_no=1,
                name=name,
                status="draft",
            )
            db.add(batch)
            db.flush()
            return batch
    except IntegrityError as exc:
        db.rollback()
        if "uq_payroll_batch_normal" in str(exc.orig).lower():
            raise PayrollWorkbenchError(409, "该主体在此工资期间已有正常批次") from exc
        raise


def batch_scope_and_preparation(
    db: Session, period: PayrollPeriod, batch: PayrollBatch
) -> tuple[EmployeeScope, DataPreparation]:
    scope = employee_scope(db, period, batch.subject_id)
    return scope, data_preparation(db, period, scope)
