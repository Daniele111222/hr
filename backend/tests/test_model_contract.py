from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import Numeric, Text

from paylite.application import create_app
from paylite.config import Settings
from paylite.db.base import Base
from paylite.db.models import Employee, ImportBatch, PayrollPeriod, PayrollRecord, primary_key
from paylite.db.models.common import primary_key as primary_key_from_module
from paylite.db.models.employees import Employee as EmployeeFromModule
from paylite.db.models.imports import ImportBatch as ImportBatchFromModule
from paylite.db.models.payroll import PayrollRecord as PayrollRecordFromModule
from paylite.main import app

EXPECTED_TABLES = {
    "company",
    "city",
    "subject",
    "department",
    "subject_department",
    "employee",
    "employee_assignment",
    "employee_salary",
    "employee_bank_account",
    "employee_base",
    "payroll_period",
    "payroll_batch",
    "import_batch",
    "import_row",
    "attendance_record",
    "performance_record",
    "social_security_rule",
    "social_security_item_rule",
    "housing_fund_rule",
    "attendance_rule",
    "payroll_record",
    "payroll_item",
    "payroll_calculation_detail",
    "correction_batch",
    "export_batch",
    "export_warning",
}


class TestModelContract:
    def test_all_domain_tables_are_registered(self) -> None:
        assert set(Base.metadata.tables) == EXPECTED_TABLES
        assert {mapper.class_.__tablename__ for mapper in Base.registry.mappers} == EXPECTED_TABLES

    def test_public_model_imports_remain_compatible(self) -> None:
        assert Employee is EmployeeFromModule
        assert ImportBatch is ImportBatchFromModule
        assert PayrollRecord is PayrollRecordFromModule
        assert primary_key is primary_key_from_module

    def test_business_identifier_and_money_types(self) -> None:
        assert isinstance(Employee.__table__.c.id_number.type, Text)
        assert isinstance(PayrollRecord.__table__.c.snapshot_fixed_salary.type, Numeric)
        assert PayrollRecord.__table__.c.snapshot_fixed_salary.type.precision == 18
        assert PayrollRecord.__table__.c.snapshot_fixed_salary.type.scale == 2

    def test_critical_constraints_are_named(self) -> None:
        employee_constraints = {
            constraint.name for constraint in Employee.__table__.constraints if constraint.name
        }
        batch_constraints = {
            constraint.name
            for constraint in Base.metadata.tables["payroll_batch"].constraints
            if constraint.name
        }
        assert "uq_employee_company_id_number" in employee_constraints
        assert "uq_payroll_batch_identity" in batch_constraints
        assert "ck_payroll_batch_status" in batch_constraints

    def test_server_defaults_and_effective_range_constraints(self) -> None:
        assert str(ImportBatch.__table__.c.field_mapping.server_default.arg) == "'{}'::jsonb"
        assert Employee.__table__.c.formal_status.server_default is not None
        assert Employee.__table__.c.updated_at.server_onupdate is not None
        assert any(
            constraint.name == "ex_employee_salary_dates"
            for constraint in Base.metadata.tables["employee_salary"].constraints
        )
        assert any(
            constraint.name == "ck_payroll_period_last_day"
            for constraint in PayrollPeriod.__table__.constraints
        )

    def test_normal_batch_has_partial_unique_index(self) -> None:
        indexes = Base.metadata.tables["payroll_batch"].indexes
        normal_index = next(index for index in indexes if index.name == "uq_payroll_batch_normal")
        assert normal_index.unique is True
        assert normal_index.dialect_options["postgresql"]["where"].text == "batch_type = 'normal'"

    def test_executable_sql_keeps_explicit_ddl_and_lock_trigger(self) -> None:
        sql_path = Path(__file__).parents[1] / "sql" / "001_initial_schema.sql"
        sql = sql_path.read_text(encoding="utf-8")
        for statement in (
            "CREATE TABLE employee (",
            "CONSTRAINT uq_employee_company_id_number UNIQUE",
            "CREATE UNIQUE INDEX uq_payroll_batch_normal",
            "CREATE TABLE payroll_record (",
            "CREATE OR REPLACE FUNCTION prevent_locked_payroll_record_mutation()",
            "CREATE TRIGGER trg_payroll_record_immutable_after_lock",
        ):
            assert statement in sql


def test_health_endpoint() -> None:
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_application_factory_uses_explicit_settings() -> None:
    application = create_app(Settings(app_name="PayLite Test"))

    with TestClient(application) as client:
        response = client.get("/health")

    assert application.title == "PayLite Test"
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
