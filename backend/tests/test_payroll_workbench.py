from datetime import date

import pytest
from pydantic import ValidationError

from paylite.api.schemas import PayrollBatchCreate, PayrollPeriodCreate
from paylite.services.payroll_workbench import EmployeeScope, data_preparation, parse_period


def test_parse_period_calculates_natural_month_boundaries() -> None:
    assert parse_period("2026-02").end == date(2026, 2, 28)
    assert parse_period("2028-02").end == date(2028, 2, 29)
    assert parse_period("2026-04").end == date(2026, 4, 30)


def test_parse_period_rejects_invalid_months_and_formats() -> None:
    for value in ("2026/02", "2026-00", "2026-13", "0-01"):
        with pytest.raises(Exception):
            parse_period(value)


def test_period_create_schema_requires_yyyy_mm() -> None:
    PayrollPeriodCreate(period="2026-09")
    with pytest.raises(ValidationError):
        PayrollPeriodCreate(period="2026/09")


def test_batch_create_schema_only_exposes_normal_batch_for_issue_05() -> None:
    PayrollBatchCreate(subject_id=1)
    with pytest.raises(ValidationError):
        PayrollBatchCreate(subject_id=1, batch_type="supplement")


def test_empty_scope_does_not_report_missing_preparation() -> None:
    scope = EmployeeScope(employee_ids=[], ambiguous_employee_ids=[])
    data = data_preparation(None, None, scope)  # type: ignore[arg-type]
    assert data.overall_status == "ready"
    assert data.attendance.status == "not_required"
