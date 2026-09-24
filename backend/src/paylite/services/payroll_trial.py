"""Versioned ordinary payroll trial, independent of the confirmed wage ledger."""

import hashlib
import json
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, localcontext
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from paylite.db.models import (
    AttendanceRecord,
    AttendanceRule,
    City,
    Department,
    Employee,
    EmployeeAssignment,
    EmployeeBankAccount,
    EmployeeBase,
    EmployeeSalary,
    HousingFundRule,
    ImportBatch,
    ImportRow,
    PayrollBatch,
    PayrollPeriod,
    PayrollTrialRun,
    PerformanceRecord,
    SocialSecurityItemRule,
    SocialSecurityRule,
    Subject,
    SubjectDepartment,
)
from paylite.domain.payroll import Attendance, PayrollInput, SalarySegment, SocialItem, calculate
from paylite.services.payroll_workbench import employee_scope, requires_performance


class TrialError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _plain(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def _record(row: Any, *, exclude: set[str] | None = None) -> dict[str, Any]:
    return _plain(
        {
            column.name: getattr(row, column.name)
            for column in row.__table__.columns
            if column.name not in (exclude or set())
        }
    )


def _period_rows(db: Session, model: Any, ids: list[int], period: PayrollPeriod) -> list[Any]:
    if not ids:
        return []
    return list(
        db.scalars(
            select(model)
            .where(
                model.employee_id.in_(ids),
                model.effective_from <= period.period_end,
                (model.effective_to.is_(None)) | (model.effective_to > period.period_start),
            )
            .order_by(model.employee_id, model.effective_from, model.id)
        )
    )


def _during(row: Any, day: date) -> bool:
    return row.effective_from <= day and (row.effective_to is None or day < row.effective_to)


def _days(start: date, end: date) -> list[date]:
    if end < start:
        return []
    return [start + timedelta(days=n) for n in range((end - start).days + 1)]


def _index(rows: list[Any]) -> dict[int, list[Any]]:
    grouped: dict[int, list[Any]] = defaultdict(list)
    for row in rows:
        grouped[row.employee_id].append(row)
    return grouped


def _one(rows: list[Any], day: date) -> Any | None:
    matched = [row for row in rows if _during(row, day)]
    return matched[0] if len(matched) == 1 else None


def _load_snapshot(
    db: Session, batch: PayrollBatch, period: PayrollPeriod
) -> tuple[dict[str, Any], dict[str, Any]]:
    subject = db.get(Subject, batch.subject_id)
    scope = employee_scope(db, period, batch.subject_id)
    ids = scope.employee_ids
    employees = (
        list(db.scalars(select(Employee).where(Employee.id.in_(ids)).order_by(Employee.id)))
        if ids
        else []
    )
    assignments = _period_rows(db, EmployeeAssignment, ids, period)
    salaries = _period_rows(db, EmployeeSalary, ids, period)
    bases = _period_rows(db, EmployeeBase, ids, period)
    banks = _period_rows(db, EmployeeBankAccount, ids, period)
    attendance = list(
        db.scalars(
            select(AttendanceRecord)
            .where(
                AttendanceRecord.payroll_period_id == period.id,
                AttendanceRecord.employee_id.in_(ids or [-1]),
            )
            .order_by(AttendanceRecord.employee_id)
        )
    )
    performance = list(
        db.scalars(
            select(PerformanceRecord)
            .where(
                PerformanceRecord.payroll_period_id == period.id,
                PerformanceRecord.employee_id.in_(ids or [-1]),
            )
            .order_by(PerformanceRecord.employee_id)
        )
    )
    city_ids = sorted({row.city_id for row in bases})
    cities = (
        list(db.scalars(select(City).where(City.id.in_(city_ids)).order_by(City.id)))
        if city_ids
        else []
    )
    social_rules = list(
        db.scalars(
            select(SocialSecurityRule)
            .where(
                SocialSecurityRule.city_id.in_(city_ids or [-1]),
                SocialSecurityRule.effective_from <= period.period_end,
                (SocialSecurityRule.effective_to.is_(None))
                | (SocialSecurityRule.effective_to > period.period_start),
            )
            .order_by(SocialSecurityRule.city_id, SocialSecurityRule.id)
        )
    )
    rule_ids = [rule.id for rule in social_rules]
    social_items = list(
        db.scalars(
            select(SocialSecurityItemRule)
            .where(SocialSecurityItemRule.social_security_rule_id.in_(rule_ids or [-1]))
            .order_by(
                SocialSecurityItemRule.social_security_rule_id, SocialSecurityItemRule.item_code
            )
        )
    )
    housing_rules = list(
        db.scalars(
            select(HousingFundRule)
            .where(
                HousingFundRule.city_id.in_(city_ids or [-1]),
                HousingFundRule.effective_from <= period.period_end,
                (HousingFundRule.effective_to.is_(None))
                | (HousingFundRule.effective_to > period.period_start),
            )
            .order_by(HousingFundRule.city_id, HousingFundRule.id)
        )
    )
    attendance_rules = list(
        db.scalars(
            select(AttendanceRule)
            .where(
                AttendanceRule.effective_from <= period.period_end,
                (AttendanceRule.effective_to.is_(None))
                | (AttendanceRule.effective_to > period.period_start),
            )
            .order_by(AttendanceRule.id)
        )
    )
    department_ids = sorted({row.subject_department_id for row in assignments})
    relations = list(
        db.scalars(
            select(SubjectDepartment)
            .where(SubjectDepartment.id.in_(department_ids or [-1]))
            .order_by(SubjectDepartment.id)
        )
    )
    departments = list(
        db.scalars(
            select(Department)
            .where(Department.id.in_([row.department_id for row in relations] or [-1]))
            .order_by(Department.id)
        )
    )
    imports = list(
        db.scalars(
            select(ImportBatch)
            .where(
                ImportBatch.payroll_batch_id == batch.id,
                ImportBatch.import_type.in_(["attendance", "performance"]),
            )
            .order_by(ImportBatch.id)
        )
    )
    import_rows = list(
        db.scalars(
            select(ImportRow)
            .where(ImportRow.import_batch_id.in_([row.id for row in imports] or [-1]))
            .order_by(
                ImportRow.import_batch_id,
                ImportRow.sheet_name,
                ImportRow.source_row_number,
                ImportRow.id,
            )
        )
    )
    snapshot = {
        "period": _record(period, exclude={"created_at"}),
        "subject": _record(subject),
        "employees": [_record(row, exclude={"created_at", "updated_at"}) for row in employees],
        "assignments": [_record(row, exclude={"created_at"}) for row in assignments],
        "salaries": [_record(row, exclude={"created_at"}) for row in salaries],
        "bases": [_record(row, exclude={"created_at"}) for row in bases],
        "banks": [_record(row, exclude={"created_at"}) for row in banks],
        "attendance": [_record(row, exclude={"created_at"}) for row in attendance],
        "performance": [_record(row, exclude={"created_at"}) for row in performance],
        "cities": [_record(row) for row in cities],
        "social_rules": [_record(row, exclude={"created_at"}) for row in social_rules],
        "social_items": [_record(row) for row in social_items],
        "housing_rules": [_record(row, exclude={"created_at"}) for row in housing_rules],
        "attendance_rules": [_record(row, exclude={"created_at"}) for row in attendance_rules],
        "relations": [_record(row) for row in relations],
        "departments": [_record(row) for row in departments],
        "imports": [_record(row, exclude={"original_file", "uploaded_at"}) for row in imports],
        "import_rows": [_record(row, exclude={"created_at"}) for row in import_rows],
        "scope": {"employee_ids": ids, "ambiguous_employee_ids": scope.ambiguous_employee_ids},
    }
    data = {
        "employees": employees,
        "assignments": _index(assignments),
        "salaries": _index(salaries),
        "bases": _index(bases),
        "banks": _index(banks),
        "attendance": {row.employee_id: row for row in attendance},
        "performance": {row.employee_id: row for row in performance},
        "cities": {row.id: row for row in cities},
        "social_rules": social_rules,
        "social_items": social_items,
        "housing_rules": housing_rules,
        "attendance_rules": attendance_rules,
        "relations": {row.id: row for row in relations},
        "departments": {row.id: row for row in departments},
        "ambiguous_ids": set(scope.ambiguous_employee_ids),
    }
    return snapshot, data


def _covering(rows: list[Any], period: PayrollPeriod, *, city_id: int | None = None) -> Any | None:
    matched = [
        row
        for row in rows
        if (city_id is None or row.city_id == city_id)
        and row.effective_from <= period.period_start
        and (row.effective_to is None or row.effective_to > period.period_end)
    ]
    return matched[0] if len(matched) == 1 else None


def _issue(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def _employee_trial(
    employee: Employee, period: PayrollPeriod, data: dict[str, Any]
) -> dict[str, Any]:
    days = _days(
        max(period.period_start, employee.hire_date),
        min(period.period_end, employee.termination_date or period.period_end),
    )
    assignments = [_one(data["assignments"].get(employee.id, []), day) for day in days]
    salaries = [_one(data["salaries"].get(employee.id, []), day) for day in days]
    bases = [_one(data["bases"].get(employee.id, []), day) for day in days]
    errors: list[dict[str, str]] = []
    if not days or not all(assignments):
        errors.append(_issue("ASSIGNMENT_GAP", "本期任职关系不完整"))
    if (
        employee.id in data["ambiguous_ids"]
        or len({row.subject_id for row in assignments if row}) > 1
    ):
        errors.append(_issue("CROSS_SUBJECT_UNSUPPORTED", "本期跨主体调动暂不计算，请核对归属"))
    if not all(salaries):
        errors.append(_issue("SALARY_GAP", "本期薪酬标准不完整"))
    if not all(bases) or len({row.city_id for row in bases if row}) != 1:
        errors.append(_issue("BASE_CITY_GAP", "本期 base 地缺失或发生变化，无法确定整月缴费城市"))
    attendance = data["attendance"].get(employee.id)
    if attendance is None:
        errors.append(_issue("ATTENDANCE_MISSING", "缺本期考勤记录"))
    performance = data["performance"].get(employee.id)
    performance_required = requires_performance(employee, period)
    if performance_required and performance is None:
        errors.append(_issue("PERFORMANCE_MISSING", "缺本期绩效系数"))
    if not performance_required and performance is not None:
        errors.append(_issue("PROBATION_PERFORMANCE", "试用期不考核绩效，请核对错误绩效记录"))
    attendance_rule = _covering(data["attendance_rules"], period)
    if attendance_rule is None:
        errors.append(_issue("ATTENDANCE_RULE_MISSING", "缺覆盖本期的有效考勤规则"))

    last_assignment = next((row for row in reversed(assignments) if row), None)
    last_salary = next((row for row in reversed(salaries) if row), None)
    last_base = next((row for row in reversed(bases) if row), None)
    level_number = (
        last_assignment.level_number
        if last_assignment and last_assignment.level_number is not None
        else employee.level_number
    )
    if level_number is None:
        errors.append(_issue("LEVEL_MISSING", "缺职级数字，无法判断 P7 考勤免扣"))
    city = data["cities"].get(last_base.city_id) if last_base else None
    social_rule = _covering(data["social_rules"], period, city_id=city.id) if city else None
    housing_rule = _covering(data["housing_rules"], period, city_id=city.id) if city else None
    if social_rule is None or social_rule.fixed_base is None:
        errors.append(_issue("CITY_RULE_MISSING", "缺覆盖本期的城市社保基数规则"))
    if housing_rule is None:
        errors.append(_issue("HOUSING_RULE_MISSING", "缺覆盖本期的公积金规则"))
    elif housing_rule.employee_rate != Decimal("0.05") or housing_rule.company_rate != Decimal(
        "0.05"
    ):
        errors.append(_issue("HOUSING_RATE_INVALID", "公积金个人与公司比例均须为 5%"))
    social_items = [
        item
        for item in data["social_items"]
        if social_rule is not None and item.social_security_rule_id == social_rule.id
    ]
    if social_rule is not None and not social_items:
        errors.append(_issue("SOCIAL_ITEMS_MISSING", "城市社保缴费项目缺失"))
    relation = (
        data["relations"].get(last_assignment.subject_department_id) if last_assignment else None
    )
    department = data["departments"].get(relation.department_id) if relation else None
    last_day = days[-1] if days else period.period_end
    bank = _one(data["banks"].get(employee.id, []), last_day)
    snapshot = {
        "id_number": employee.id_number,
        "employee_no": employee.employee_no,
        "name": employee.name,
        "department_name": department.name if department else None,
        "position_title": last_assignment.position_title if last_assignment else None,
        "level_number": level_number,
        "fixed_salary": str(last_salary.fixed_salary) if last_salary else None,
        "performance_base": str(last_salary.performance_base) if last_salary else None,
        "base_city_name": city.name if city else None,
        "bank_account": bank.account_number if bank else None,
        "last_effective_subject_id": last_assignment.subject_id if last_assignment else None,
    }
    row: dict[str, Any] = {
        "employee_id": employee.id,
        "employee_name": employee.name,
        "snapshot": snapshot,
        "errors": errors,
        "warnings": [],
        "amounts": None,
        "items": [],
        "steps": [],
    }
    if errors:
        return row

    salary_segments: list[SalarySegment] = []
    for salary in salaries:
        if salary_segments and salary_segments[-1].fixed_salary == salary.fixed_salary:
            last = salary_segments[-1]
            salary_segments[-1] = SalarySegment(last.days + 1, last.fixed_salary)
        else:
            salary_segments.append(SalarySegment(1, salary.fixed_salary))
    assert attendance and last_salary and social_rule and housing_rule and attendance_rule
    payroll_input = PayrollInput(
        month_days=(period.period_end - period.period_start).days + 1,
        salary_segments=tuple(salary_segments),
        performance_base=last_salary.performance_base,
        performance_coefficient=performance.coefficient if performance_required else None,
        attendance=Attendance(
            attendance.expected_work_days,
            attendance.late_minutes,
            attendance.early_leave_minutes,
            attendance.unpaid_leave_days,
            attendance.missed_punch_count,
            attendance.corrected_punch_count,
        ),
        level_number=level_number,
        social_base=social_rule.fixed_base,
        social_items=tuple(
            SocialItem(item.item_code, item.item_name, item.employee_rate, item.company_rate)
            for item in social_items
        ),
        housing_fixed_salary=last_salary.fixed_salary,
        housing_rate=housing_rule.employee_rate,
        standard_hours=attendance_rule.standard_hours,
        missed_punch_amount=attendance_rule.missed_punch_amount,
        exempt_level_number=attendance_rule.exempt_level_number,
    )
    try:
        result = calculate(payroll_input)
    except (ArithmeticError, ValueError) as exc:
        row["errors"].append(_issue("CALCULATION_FAILED", f"金额无法计算：{exc}"))
        return row
    row["amounts"] = {
        key: str(getattr(result, key))
        for key in (
            "fixed",
            "performance",
            "attendance_deduction",
            "gross",
            "employee_social",
            "company_social",
            "employee_housing",
            "company_housing",
            "untaxed_amount",
            "employer_cost",
        )
    }
    row["items"] = [
        {
            "code": item.code,
            "name": item.name,
            "category": item.category,
            "amount": str(item.amount),
        }
        for item in result.items
    ]
    row["steps"] = [
        {
            "code": step.code,
            "formula": step.formula,
            "inputs": step.inputs,
            "amount": str(step.amount),
        }
        for step in result.steps
    ]
    row["warnings"] = list(result.warnings)
    row["errors"] = [_issue("AMOUNT_INVALID", message) for message in result.errors]
    return row


def _fingerprint(snapshot: dict[str, Any]) -> str:
    canonical = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _latest(db: Session, batch_id: int) -> PayrollTrialRun | None:
    return db.scalar(
        select(PayrollTrialRun)
        .where(PayrollTrialRun.payroll_batch_id == batch_id)
        .order_by(PayrollTrialRun.id.desc())
        .limit(1)
    )


def _result(run: PayrollTrialRun, *, stale: bool) -> dict[str, Any]:
    successful = [row for row in run.results if not row["errors"]]
    failed = len(run.results) - len(successful)
    with localcontext() as context:
        context.prec = (
            max(
                [
                    len(row["amounts"][key])
                    for row in successful
                    for key in ("gross", "untaxed_amount", "employer_cost")
                ]
                + [28]
            )
            + len(str(len(successful)))
            + 2
        )
        totals = {
            key: str(sum((Decimal(row["amounts"][key]) for row in successful), Decimal("0.00")))
            for key in ("gross", "untaxed_amount", "employer_cost")
        }
    return {
        "id": run.id,
        "payroll_batch_id": run.payroll_batch_id,
        "input_fingerprint": run.input_fingerprint,
        "created_at": run.created_at,
        "stale": stale,
        "success_count": len(successful),
        "error_count": failed,
        "total_count": len(run.results),
        "totals": totals,
        "results": run.results,
        "includes_final_incentive": False,
        "ready_for_confirmation": False,
        "confirmation_blockers": [
            *(["试算输入已变化，请重新试算"] if stale else []),
            *(["存在员工试算错误"] if failed else []),
            "尚未计算全公司考勤激励",
        ],
    }


def get_trial(db: Session, batch_id: int) -> dict[str, Any] | None:
    batch = db.get(PayrollBatch, batch_id)
    if batch is None or batch.batch_type != "normal":
        raise TrialError(404, "正常工资批次不存在")
    run = _latest(db, batch_id)
    if run is None:
        return None
    period = db.get(PayrollPeriod, batch.payroll_period_id)
    current, _ = _load_snapshot(db, batch, period)
    return _result(run, stale=_fingerprint(current) != run.input_fingerprint)


def run_trial(db: Session, batch_id: int) -> dict[str, Any]:
    batch = db.get(PayrollBatch, batch_id, with_for_update=True)
    if batch is None or batch.batch_type != "normal":
        raise TrialError(404, "正常工资批次不存在")
    if batch.status not in {"draft", "trial"}:
        raise TrialError(409, "已确认或锁定的批次不能重新试算")
    period = db.get(PayrollPeriod, batch.payroll_period_id, with_for_update=True)
    snapshot, data = _load_snapshot(db, batch, period)
    fingerprint = _fingerprint(snapshot)
    previous = _latest(db, batch_id)
    if previous is not None and previous.input_fingerprint == fingerprint:
        return _result(previous, stale=False)
    results = [_employee_trial(employee, period, data) for employee in data["employees"]]
    run = PayrollTrialRun(
        payroll_batch_id=batch_id,
        input_fingerprint=fingerprint,
        input_snapshot=snapshot,
        results=results,
    )
    db.add(run)
    batch.status = "trial"
    db.commit()
    db.refresh(run)
    return _result(run, stale=False)
