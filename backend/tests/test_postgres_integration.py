import os
from collections.abc import Generator
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from paylite.api.deps import get_db
from paylite.application import create_app
from paylite.config import get_settings
from paylite.db.models import (
    AttendanceRecord,
    City,
    Company,
    CorrectionBatch,
    Employee,
    EmployeeSalary,
    ImportBatch,
    ImportRow,
    PayrollBatch,
    PayrollPeriod,
    PayrollRecord,
    SocialSecurityRule,
    Subject,
)

TEST_DATABASE_URL = os.getenv("PAYLITE_TEST_DATABASE_URL")
ALLOW_TEST_DATABASE_RESET = os.getenv("PAYLITE_ALLOW_TEST_DATABASE_RESET") == "1"


def validate_test_database_url(database_url: str) -> URL:
    parsed = make_url(database_url)
    database_name = parsed.database or ""
    if database_name.lower() in {"", "postgres", "paylite"} or "test" not in database_name.lower():
        raise RuntimeError(
            "PAYLITE_TEST_DATABASE_URL must target a dedicated database whose name contains 'test'"
        )
    if not ALLOW_TEST_DATABASE_RESET:
        raise RuntimeError(
            "Set PAYLITE_ALLOW_TEST_DATABASE_RESET=1 to allow integration-test database reset"
        )
    return parsed


pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="PAYLITE_TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


@pytest.fixture(scope="session")
def postgres_engine():
    assert TEST_DATABASE_URL is not None
    validate_test_database_url(TEST_DATABASE_URL)
    os.environ["PAYLITE_DATABASE_URL"] = TEST_DATABASE_URL
    get_settings.cache_clear()

    backend_root = Path(__file__).parents[1]
    alembic_config = Config(str(backend_root / "alembic.ini"))
    command.upgrade(alembic_config, "head")

    engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    yield engine

    if engine.url.database != "paylite":
        command.downgrade(alembic_config, "base")
    engine.dispose()


@pytest.fixture
def db_session(postgres_engine) -> Generator[Session]:
    with Session(postgres_engine) as session:
        yield session
        session.rollback()


@pytest.fixture
def api_client(postgres_engine):
    application = create_app()

    def override_get_db() -> Generator[Session]:
        with Session(postgres_engine) as session:
            try:
                yield session
            except Exception:
                session.rollback()
                raise

    application.dependency_overrides[get_db] = override_get_db
    with TestClient(application) as client:
        yield client
    application.dependency_overrides.clear()


def create_base_records(session: Session) -> tuple[Company, City, Subject, PayrollPeriod, Employee]:
    company = Company(code="ACME", name="Acme")
    city = City(code="BJ", name="北京")
    session.add_all([company, city])
    session.flush()

    subject = Subject(company_id=company.id, code="MAIN", name="主主体")
    period = PayrollPeriod(
        year=2026,
        month=6,
        period_start=date(2026, 6, 1),
        period_end=date(2026, 6, 30),
    )
    employee = Employee(
        company_id=company.id,
        id_number="11010119900101123X",
        employee_no="E001",
        name="测试员工",
        employee_type="employee",
        formal_status=True,
        probation_status="confirmed",
        hire_date=date(2020, 1, 1),
    )
    session.add_all([subject, period, employee])
    session.flush()
    return company, city, subject, period, employee


def test_id_number_is_unique_text(db_session: Session) -> None:
    company, _, _, _, _ = create_base_records(db_session)
    duplicate = Employee(
        company_id=company.id,
        id_number="11010119900101123X",
        employee_no="E002",
        name="重复员工",
        employee_type="employee",
        hire_date=date(2026, 1, 1),
    )
    db_session.add(duplicate)

    with pytest.raises(IntegrityError):
        db_session.flush()


def test_normal_batch_is_unique_but_supplement_is_independent(db_session: Session) -> None:
    _, _, subject, period, _ = create_base_records(db_session)
    normal = PayrollBatch(
        subject_id=subject.id,
        payroll_period_id=period.id,
        batch_type="normal",
        status="draft",
    )
    supplement = PayrollBatch(
        subject_id=subject.id,
        payroll_period_id=period.id,
        batch_type="supplement",
        status="draft",
    )
    db_session.add_all([normal, supplement])
    db_session.flush()

    duplicate_normal = PayrollBatch(
        subject_id=subject.id,
        payroll_period_id=period.id,
        batch_type="normal",
        batch_no=2,
        status="draft",
    )
    db_session.add(duplicate_normal)
    with pytest.raises(IntegrityError):
        db_session.flush()


def test_duplicate_import_row_location_is_rejected(db_session: Session) -> None:
    _, _, _, period, employee = create_base_records(db_session)
    import_batch = ImportBatch(
        payroll_period_id=period.id,
        import_type="attendance",
        original_filename="attendance.xlsx",
        file_sha256="a" * 64,
        template_version="v1",
    )
    db_session.add(import_batch)
    db_session.flush()

    db_session.add_all(
        [
            ImportRow(
                import_batch_id=import_batch.id,
                sheet_name="Sheet1",
                source_row_number=2,
                validation_status="valid",
                raw_data={"employee": employee.employee_no},
            ),
            ImportRow(
                import_batch_id=import_batch.id,
                sheet_name="Sheet1",
                source_row_number=2,
                validation_status="valid",
                raw_data={"employee": employee.employee_no},
            ),
        ]
    )
    with pytest.raises(IntegrityError):
        db_session.flush()


def test_duplicate_attendance_for_period_is_rejected(db_session: Session) -> None:
    _, _, _, period, employee = create_base_records(db_session)
    first_batch = ImportBatch(
        payroll_period_id=period.id,
        import_type="attendance",
        original_filename="attendance-1.xlsx",
        file_sha256="b" * 64,
        template_version="v1",
    )
    second_batch = ImportBatch(
        payroll_period_id=period.id,
        import_type="attendance",
        original_filename="attendance-2.xlsx",
        file_sha256="c" * 64,
        template_version="v1",
    )
    db_session.add_all([first_batch, second_batch])
    db_session.flush()

    db_session.add(
        AttendanceRecord(
            import_batch_id=first_batch.id,
            payroll_period_id=period.id,
            employee_id=employee.id,
            expected_work_days=Decimal("20"),
        )
    )
    db_session.flush()
    db_session.add(
        AttendanceRecord(
            import_batch_id=second_batch.id,
            payroll_period_id=period.id,
            employee_id=employee.id,
            expected_work_days=Decimal("20"),
        )
    )

    with pytest.raises(IntegrityError):
        db_session.flush()


def test_rule_is_unique_by_city_and_effective_start(db_session: Session) -> None:
    _, city, _, _, _ = create_base_records(db_session)
    db_session.add(
        SocialSecurityRule(
            city_id=city.id,
            effective_from=date(2026, 1, 1),
            version="2026-01",
        )
    )
    db_session.flush()
    db_session.add(
        SocialSecurityRule(
            city_id=city.id,
            effective_from=date(2026, 1, 1),
            version="2026-01-revision",
        )
    )

    with pytest.raises(IntegrityError):
        db_session.flush()


def test_payroll_record_keeps_snapshot_and_correction_link(db_session: Session) -> None:
    _, _, subject, period, employee = create_base_records(db_session)
    original = PayrollBatch(
        subject_id=subject.id,
        payroll_period_id=period.id,
        batch_type="normal",
        status="locked",
    )
    replacement = PayrollBatch(
        subject_id=subject.id,
        payroll_period_id=period.id,
        batch_type="supplement",
        batch_no=1,
        status="draft",
    )
    db_session.add_all([original, replacement])
    db_session.flush()

    record = PayrollRecord(
        payroll_batch_id=original.id,
        payroll_period_id=period.id,
        subject_id=subject.id,
        employee_id=employee.id,
        snapshot_id_number=employee.id_number,
        snapshot_employee_no=employee.employee_no,
        snapshot_employee_name=employee.name,
        snapshot_fixed_salary=Decimal("10000.00"),
        snapshot_performance_base=Decimal("2000.00"),
        gross_amount=Decimal("10000.00"),
        net_amount=Decimal("10000.00"),
    )
    db_session.add(record)
    db_session.add(
        CorrectionBatch(
            original_batch_id=original.id,
            replacement_batch_id=replacement.id,
            reason="修正导入数据",
        )
    )
    db_session.flush()

    persisted = db_session.scalar(select(PayrollRecord).where(PayrollRecord.id == record.id))
    assert persisted is not None
    assert persisted.snapshot_fixed_salary == Decimal("10000.00")


def test_locked_payroll_record_cannot_be_updated(db_session: Session) -> None:
    _, _, subject, period, employee = create_base_records(db_session)
    batch = PayrollBatch(
        subject_id=subject.id,
        payroll_period_id=period.id,
        batch_type="normal",
        status="draft",
    )
    db_session.add(batch)
    db_session.flush()
    record = PayrollRecord(
        payroll_batch_id=batch.id,
        payroll_period_id=period.id,
        subject_id=subject.id,
        employee_id=employee.id,
        snapshot_id_number=employee.id_number,
        snapshot_employee_no=employee.employee_no,
        snapshot_employee_name=employee.name,
        snapshot_fixed_salary=Decimal("10000.00"),
        snapshot_performance_base=Decimal("2000.00"),
    )
    db_session.add(record)
    db_session.flush()

    record.calculation_status = "locked"
    db_session.flush()
    record.snapshot_employee_name = "不应被修改"

    with pytest.raises(IntegrityError):
        db_session.flush()


def test_organization_and_employee_api_flow(api_client: TestClient, postgres_engine) -> None:
    company = api_client.post("/organization/company", json={"code": "ACME", "name": "示例公司"})
    assert company.status_code == 201
    company_id = company.json()["id"]

    city = api_client.post("/organization/cities", json={"code": "BJ", "name": "北京"})
    subject = api_client.post(
        "/organization/subjects",
        json={"company_id": company_id, "code": "MAIN", "name": "主主体"},
    )
    department = api_client.post(
        "/organization/departments",
        json={"company_id": company_id, "code": "ENG", "name": "研发"},
    )
    subject_department = api_client.post(
        "/organization/subject-departments",
        json={
            "company_id": company_id,
            "subject_id": subject.json()["id"],
            "department_id": department.json()["id"],
            "code": "ENG",
            "name": "研发",
        },
    )
    assert all(
        response.status_code == 201 for response in (city, subject, department, subject_department)
    )

    employee_payload = {
        "company_id": company_id,
        "id_number": "11010119900101123X",
        "employee_no": "E001",
        "name": "测试员工",
        "employee_type": "employee",
        "formal_status": True,
        "probation_status": "confirmed",
        "hire_date": "2026-01-01",
        "assignment": {
            "subject_id": subject.json()["id"],
            "subject_department_id": subject_department.json()["id"],
            "position_title": "工程师",
            "effective_from": "2026-01-01",
        },
        "salary": {
            "fixed_salary": "8000.00",
            "performance_base": "2000.00",
            "effective_from": "2026-01-01",
        },
        "base": {"city_id": city.json()["id"], "effective_from": "2026-01-01"},
        "bank_account": {
            "account_number": "6222000000000001",
            "account_name": "测试员工",
            "effective_from": "2026-01-01",
        },
    }
    created = api_client.post("/employees", json=employee_payload)
    assert created.status_code == 201
    employee_id = created.json()["id"]

    duplicate = api_client.post("/employees", json={**employee_payload, "employee_no": "E002"})
    assert duplicate.status_code == 409
    assert "身份证" in duplicate.json()["detail"]

    updated = api_client.patch(
        f"/employees/{employee_id}",
        json={
            "salary": {
                "fixed_salary": "8500.00",
                "performance_base": "2125.00",
                "effective_from": "2026-07-01",
            }
        },
    )
    assert updated.status_code == 200
    assert updated.json()["salary"]["fixed_salary"] == "8500.00"

    overlapping_salary = api_client.patch(
        f"/employees/{employee_id}",
        json={
            "salary": {
                "fixed_salary": "8500.00",
                "performance_base": "2125.00",
                "effective_from": "2026-07-01",
            }
        },
    )
    assert overlapping_salary.status_code == 400
    assert "生效日期" in overlapping_salary.json()["detail"]

    deactivated = api_client.patch(f"/employees/{employee_id}", json={"active": False})
    assert deactivated.status_code == 200
    assert deactivated.json()["active"] is False
    persisted = api_client.get(f"/employees/{employee_id}")
    assert persisted.status_code == 200
    assert persisted.json()["salary"]["fixed_salary"] == "8500.00"

    with Session(postgres_engine) as session:
        salary_rows = list(
            session.scalars(
                select(EmployeeSalary)
                .where(EmployeeSalary.employee_id == employee_id)
                .order_by(EmployeeSalary.effective_from)
            )
        )
        assert salary_rows[0].effective_to == date(2026, 7, 1)

    blocked_delete = api_client.delete(f"/organization/cities/{city.json()['id']}")
    assert blocked_delete.status_code == 409
    assert "base 地" in blocked_delete.json()["detail"]

    probation_payload = {
        **employee_payload,
        "id_number": "11010119900101124X",
        "employee_no": "E003",
        "probation_status": "in_probation",
        "formal_status": False,
        "salary": {
            **employee_payload["salary"],
            "performance_base": "0.00",
        },
    }
    probation_employee = api_client.post("/employees", json=probation_payload)
    assert probation_employee.status_code == 201

    changed_fixed_salary = api_client.patch(
        f"/employees/{probation_employee.json()['id']}",
        json={
            "probation_status": "confirmed",
            "formal_status": True,
            "salary": {
                "fixed_salary": "8500.00",
                "performance_base": "2125.00",
                "effective_from": "2026-07-01",
            },
        },
    )
    assert changed_fixed_salary.status_code == 400
    assert "固定薪资必须保持不变" in changed_fixed_salary.json()["detail"]

    confirmed = api_client.patch(
        f"/employees/{probation_employee.json()['id']}",
        json={
            "probation_status": "confirmed",
            "formal_status": True,
            "salary": {
                "fixed_salary": "8000.00",
                "performance_base": "2000.00",
                "effective_from": "2026-07-01",
            },
        },
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["probation_status"] == "confirmed"
    assert confirmed.json()["salary"]["fixed_salary"] == "8000.00"
