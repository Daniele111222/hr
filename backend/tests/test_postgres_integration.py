import os
from collections.abc import Generator
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, select
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from paylite.config import get_settings
from paylite.db.models import (
    AttendanceRecord,
    City,
    Company,
    CorrectionBatch,
    Employee,
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
