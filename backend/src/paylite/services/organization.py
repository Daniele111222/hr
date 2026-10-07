"""Organization list queries, including names needed across page boundaries."""

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from paylite.db.models import City, Department, Subject, SubjectDepartment
from paylite.services.pagination import paginate


def city_page(db: Session, page_no: int, page_size: int):
    statement = select(City.__table__).order_by(City.code, City.id)
    return paginate(db, statement, page_no=page_no, page_size=page_size)


def subject_page(db: Session, page_no: int, page_size: int):
    statement = select(Subject.__table__).order_by(Subject.code, Subject.id)
    return paginate(db, statement, page_no=page_no, page_size=page_size)


def department_page(db: Session, page_no: int, page_size: int):
    parent = aliased(Department)
    statement = (
        select(Department.__table__, parent.name.label("parent_name"))
        .outerjoin(parent, Department.parent_id == parent.id)
        .order_by(Department.code, Department.id)
    )
    return paginate(db, statement, page_no=page_no, page_size=page_size)


def subject_department_page(db: Session, page_no: int, page_size: int):
    statement = (
        select(
            SubjectDepartment.__table__,
            Subject.name.label("subject_name"),
            Department.name.label("department_name"),
        )
        .join(Subject, SubjectDepartment.subject_id == Subject.id)
        .join(Department, SubjectDepartment.department_id == Department.id)
        .order_by(SubjectDepartment.subject_id, SubjectDepartment.code, SubjectDepartment.id)
    )
    return paginate(db, statement, page_no=page_no, page_size=page_size)
