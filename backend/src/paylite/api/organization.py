from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from paylite.api.deps import get_db
from paylite.api.schemas import (
    CityIn,
    CityOut,
    CityPatch,
    CompanyIn,
    CompanyOut,
    CompanyPatch,
    DepartmentIn,
    DepartmentOut,
    DepartmentPatch,
    SubjectDepartmentIn,
    SubjectDepartmentOut,
    SubjectDepartmentPatch,
    SubjectIn,
    SubjectOut,
    SubjectPatch,
)
from paylite.db.models import (
    City,
    Company,
    Department,
    EmployeeAssignment,
    EmployeeBase,
    Subject,
    SubjectDepartment,
)

router = APIRouter(prefix="/organization", tags=["organization"])


@router.get("/company", response_model=CompanyOut | None)
def get_company(db: Session = Depends(get_db)):
    return db.scalar(select(Company).order_by(Company.id).limit(1))


@router.post("/company", response_model=CompanyOut, status_code=status.HTTP_201_CREATED)
def create_company(payload: CompanyIn, db: Session = Depends(get_db)):
    if db.scalar(select(Company).limit(1)):
        raise HTTPException(409, "系统只支持一个目标公司")
    company = Company(**payload.model_dump())
    db.add(company)
    db.commit()
    db.refresh(company)
    return company


@router.patch("/company", response_model=CompanyOut)
def update_company(payload: CompanyPatch, db: Session = Depends(get_db)):
    company = db.scalar(select(Company).order_by(Company.id).limit(1))
    if not company:
        raise HTTPException(404, "目标公司不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(company, key, value)
    db.commit()
    db.refresh(company)
    return company


@router.delete("/company", status_code=204)
def delete_company(db: Session = Depends(get_db)):
    raise HTTPException(409, "目标公司不能删除")


@router.get("/cities", response_model=list[CityOut])
def list_cities(db: Session = Depends(get_db)):
    return list(db.scalars(select(City).order_by(City.code)))


@router.post("/cities", response_model=CityOut, status_code=201)
def create_city(payload: CityIn, db: Session = Depends(get_db)):
    city = City(**payload.model_dump())
    db.add(city)
    db.commit()
    db.refresh(city)
    return city


@router.patch("/cities/{city_id}", response_model=CityOut)
def update_city(city_id: int, payload: CityPatch, db: Session = Depends(get_db)):
    city = db.get(City, city_id)
    if not city:
        raise HTTPException(404, "城市不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(city, key, value)
    db.commit()
    db.refresh(city)
    return city


@router.delete("/cities/{city_id}", status_code=204)
def delete_city(city_id: int, db: Session = Depends(get_db)):
    city = db.get(City, city_id)
    if not city:
        raise HTTPException(404, "城市不存在")
    if db.scalar(select(EmployeeBase.id).where(EmployeeBase.city_id == city_id).limit(1)):
        raise HTTPException(409, "城市已被员工 base 地引用，不能删除")
    db.delete(city)
    db.commit()


@router.get("/subjects", response_model=list[SubjectOut])
def list_subjects(db: Session = Depends(get_db)):
    return list(db.scalars(select(Subject).order_by(Subject.code)))


@router.post("/subjects", response_model=SubjectOut, status_code=201)
def create_subject(payload: SubjectIn, db: Session = Depends(get_db)):
    if not db.get(Company, payload.company_id):
        raise HTTPException(404, "目标公司不存在")
    subject = Subject(**payload.model_dump())
    db.add(subject)
    db.commit()
    db.refresh(subject)
    return subject


@router.patch("/subjects/{subject_id}", response_model=SubjectOut)
def update_subject(subject_id: int, payload: SubjectPatch, db: Session = Depends(get_db)):
    subject = db.get(Subject, subject_id)
    if not subject:
        raise HTTPException(404, "主体不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(subject, key, value)
    db.commit()
    db.refresh(subject)
    return subject


@router.delete("/subjects/{subject_id}", status_code=204)
def delete_subject(subject_id: int, db: Session = Depends(get_db)):
    subject = db.get(Subject, subject_id)
    if not subject:
        raise HTTPException(404, "主体不存在")
    if db.scalar(
        select(EmployeeAssignment.id).where(EmployeeAssignment.subject_id == subject_id).limit(1)
    ):
        raise HTTPException(409, "主体已被员工任职关系引用，不能删除")
    if db.scalar(
        select(SubjectDepartment.id).where(SubjectDepartment.subject_id == subject_id).limit(1)
    ):
        raise HTTPException(409, "主体已配置部门实例，不能删除")
    db.delete(subject)
    db.commit()


@router.get("/departments", response_model=list[DepartmentOut])
def list_departments(db: Session = Depends(get_db)):
    return list(db.scalars(select(Department).order_by(Department.code)))


@router.post("/departments", response_model=DepartmentOut, status_code=201)
def create_department(payload: DepartmentIn, db: Session = Depends(get_db)):
    if not db.get(Company, payload.company_id):
        raise HTTPException(404, "目标公司不存在")
    if payload.parent_id:
        parent = db.get(Department, payload.parent_id)
        if not parent or parent.company_id != payload.company_id:
            raise HTTPException(400, "上级部门必须属于同一公司")
    department = Department(**payload.model_dump())
    db.add(department)
    db.commit()
    db.refresh(department)
    return department


@router.patch("/departments/{department_id}", response_model=DepartmentOut)
def update_department(department_id: int, payload: DepartmentPatch, db: Session = Depends(get_db)):
    department = db.get(Department, department_id)
    if not department:
        raise HTTPException(404, "部门不存在")
    if payload.parent_id:
        parent = db.get(Department, payload.parent_id)
        if not parent or parent.company_id != department.company_id:
            raise HTTPException(400, "上级部门必须属于同一公司")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(department, key, value)
    db.commit()
    db.refresh(department)
    return department


@router.delete("/departments/{department_id}", status_code=204)
def delete_department(department_id: int, db: Session = Depends(get_db)):
    department = db.get(Department, department_id)
    if not department:
        raise HTTPException(404, "部门不存在")
    if db.scalar(select(Department.id).where(Department.parent_id == department_id).limit(1)):
        raise HTTPException(409, "部门存在下级部门，不能删除")
    if db.scalar(
        select(SubjectDepartment.id)
        .where(SubjectDepartment.department_id == department_id)
        .limit(1)
    ):
        raise HTTPException(409, "部门已被主体部门实例引用，不能删除")
    db.delete(department)
    db.commit()


@router.get("/subject-departments", response_model=list[SubjectDepartmentOut])
def list_subject_departments(db: Session = Depends(get_db)):
    return list(
        db.scalars(
            select(SubjectDepartment).order_by(SubjectDepartment.subject_id, SubjectDepartment.code)
        )
    )


@router.post("/subject-departments", response_model=SubjectDepartmentOut, status_code=201)
def create_subject_department(payload: SubjectDepartmentIn, db: Session = Depends(get_db)):
    subject = db.get(Subject, payload.subject_id)
    department = db.get(Department, payload.department_id)
    if (
        not subject
        or not department
        or subject.company_id != payload.company_id
        or department.company_id != payload.company_id
    ):
        raise HTTPException(400, "主体和部门必须属于同一公司")
    row = SubjectDepartment(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/subject-departments/{row_id}", response_model=SubjectDepartmentOut)
def update_subject_department(
    row_id: int, payload: SubjectDepartmentPatch, db: Session = Depends(get_db)
):
    row = db.get(SubjectDepartment, row_id)
    if not row:
        raise HTTPException(404, "主体部门关系不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/subject-departments/{row_id}", status_code=204)
def delete_subject_department(row_id: int, db: Session = Depends(get_db)):
    row = db.get(SubjectDepartment, row_id)
    if not row:
        raise HTTPException(404, "主体部门关系不存在")
    if db.scalar(
        select(EmployeeAssignment.id)
        .where(EmployeeAssignment.subject_department_id == row_id)
        .limit(1)
    ):
        raise HTTPException(409, "主体部门已被员工任职关系引用，不能删除")
    db.delete(row)
    db.commit()
