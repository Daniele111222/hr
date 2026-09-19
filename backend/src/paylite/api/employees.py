from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from paylite.api.deps import get_db
from paylite.api.schemas import EmployeeIn, EmployeeOut, EmployeePatch
from paylite.db.models import (
    City,
    Company,
    Employee,
    EmployeeAssignment,
    EmployeeBankAccount,
    EmployeeBase,
    EmployeeSalary,
    Subject,
    SubjectDepartment,
)

router = APIRouter(prefix="/employees", tags=["employees"])


def _validate_related(company_id: int, assignment, base, db: Session) -> None:
    subject = db.get(Subject, assignment.subject_id)
    subject_department = db.get(SubjectDepartment, assignment.subject_department_id)
    city = db.get(City, base.city_id)
    if not subject or not subject_department or not city:
        raise HTTPException(400, "任职主体、主体部门和 base 地必须存在")
    if subject.company_id != company_id or subject_department.company_id != company_id:
        raise HTTPException(400, "任职关系必须属于员工所在公司")
    if subject_department.subject_id != subject.id:
        raise HTTPException(400, "主体部门不属于所选主体")


def _to_out(employee: Employee, db: Session) -> EmployeeOut:
    assignment = db.scalar(
        select(EmployeeAssignment)
        .where(EmployeeAssignment.employee_id == employee.id)
        .order_by(EmployeeAssignment.effective_from.desc())
    )
    salary = db.scalar(
        select(EmployeeSalary)
        .where(EmployeeSalary.employee_id == employee.id)
        .order_by(EmployeeSalary.effective_from.desc())
    )
    base = db.scalar(
        select(EmployeeBase)
        .where(EmployeeBase.employee_id == employee.id)
        .order_by(EmployeeBase.effective_from.desc())
    )
    bank = db.scalar(
        select(EmployeeBankAccount)
        .where(EmployeeBankAccount.employee_id == employee.id)
        .order_by(EmployeeBankAccount.effective_from.desc())
    )
    return EmployeeOut.model_validate(
        {
            **{
                c.name: getattr(employee, c.name)
                for c in Employee.__table__.columns
                if c.name not in {"created_at", "updated_at"}
            },
            "assignment": assignment,
            "salary": salary,
            "base": base,
            "bank_account": bank,
        }
    )


def _latest(db: Session, model, employee_id: int):
    return db.scalar(
        select(model).where(model.employee_id == employee_id).order_by(model.effective_from.desc())
    )


def _append_effective_record(db: Session, model, employee_id: int, payload) -> None:
    current = _latest(db, model, employee_id)
    if current:
        if payload.effective_from <= current.effective_from:
            raise HTTPException(400, "新生效日期必须晚于当前记录的生效日期")
        if current.effective_to is None or current.effective_to > payload.effective_from:
            current.effective_to = payload.effective_from
    db.add(model(employee_id=employee_id, **payload.model_dump()))


def _validate_salary_policy(
    probation_status: str, salary, current_salary=None, preserve_fixed: bool = False
) -> None:
    if probation_status == "in_probation" and salary and salary.performance_base != 0:
        raise HTTPException(400, "试用期员工不应有绩效基数")
    if salary and probation_status != "in_probation":
        if salary.performance_base * 4 != salary.fixed_salary:
            raise HTTPException(400, "固定薪资和绩效基数必须按 80%/20% 表达")
    if (
        preserve_fixed
        and current_salary
        and salary
        and salary.fixed_salary != current_salary.fixed_salary
    ):
        raise HTTPException(400, "转正前后固定薪资必须保持不变")


@router.get("", response_model=list[EmployeeOut])
def list_employees(company_id: int | None = Query(default=None), db: Session = Depends(get_db)):
    query = select(Employee).order_by(Employee.employee_no)
    if company_id is not None:
        query = query.where(Employee.company_id == company_id)
    return [_to_out(employee, db) for employee in db.scalars(query)]


@router.get("/{employee_id}", response_model=EmployeeOut)
def get_employee(employee_id: int, db: Session = Depends(get_db)):
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(404, "员工不存在")
    return _to_out(employee, db)


@router.post("", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
def create_employee(payload: EmployeeIn, db: Session = Depends(get_db)):
    if not db.get(Company, payload.company_id):
        raise HTTPException(404, "目标公司不存在")
    _validate_related(payload.company_id, payload.assignment, payload.base, db)
    _validate_salary_policy(payload.probation_status, payload.salary)
    employee = Employee(
        **payload.model_dump(exclude={"assignment", "salary", "base", "bank_account"})
    )
    db.add(employee)
    db.flush()
    db.add_all(
        [
            EmployeeAssignment(employee_id=employee.id, **payload.assignment.model_dump()),
            EmployeeSalary(employee_id=employee.id, **payload.salary.model_dump()),
            EmployeeBase(employee_id=employee.id, **payload.base.model_dump()),
            EmployeeBankAccount(employee_id=employee.id, **payload.bank_account.model_dump()),
        ]
    )
    db.commit()
    db.refresh(employee)
    return _to_out(employee, db)


@router.patch("/{employee_id}", response_model=EmployeeOut)
def update_employee(employee_id: int, payload: EmployeePatch, db: Session = Depends(get_db)):
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(404, "员工不存在")
    values = payload.model_dump(
        exclude_unset=True, exclude={"assignment", "salary", "base", "bank_account"}
    )
    if (
        "termination_date" in values
        and values["termination_date"]
        and values["termination_date"] < employee.hire_date
    ):
        raise HTTPException(400, "离职日期不能早于入职日期")
    for key, value in values.items():
        setattr(employee, key, value)
    if payload.assignment or payload.salary or payload.base or payload.bank_account:
        current_salary = _latest(db, EmployeeSalary, employee.id)
        salary = payload.salary or current_salary
        target_status = payload.probation_status or employee.probation_status
        _validate_salary_policy(
            target_status,
            salary,
            current_salary,
            employee.probation_status == "in_probation" and target_status != "in_probation",
        )
        current_assignment = _latest(db, EmployeeAssignment, employee.id)
        current_base = _latest(db, EmployeeBase, employee.id)
        assignment = payload.assignment or current_assignment
        base = payload.base or current_base
        if not assignment or not base:
            raise HTTPException(400, "员工缺少当前任职关系或 base 地")
        _validate_related(employee.company_id, assignment, base, db)
        if payload.assignment:
            _append_effective_record(db, EmployeeAssignment, employee.id, payload.assignment)
        if payload.salary:
            _append_effective_record(db, EmployeeSalary, employee.id, payload.salary)
        if payload.base:
            _append_effective_record(db, EmployeeBase, employee.id, payload.base)
        if payload.bank_account:
            _append_effective_record(db, EmployeeBankAccount, employee.id, payload.bank_account)
    elif "probation_status" in values:
        current_salary = _latest(db, EmployeeSalary, employee.id)
        _validate_salary_policy(values["probation_status"], current_salary)
    db.commit()
    db.refresh(employee)
    return _to_out(employee, db)
