from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from paylite.api.schemas import AssignmentIn, BankIn, BaseIn, EmployeeIn, SalaryIn


def test_effective_records_reject_reversed_dates() -> None:
    invalid_inputs = (
        (AssignmentIn, {"subject_id": 1, "subject_department_id": 1, "position_title": "工程师"}),
        (SalaryIn, {"fixed_salary": "8000", "performance_base": "2000"}),
        (BankIn, {"account_number": "6222", "account_name": "张三"}),
        (BaseIn, {"city_id": 1}),
    )
    for schema, values in invalid_inputs:
        with pytest.raises(ValidationError):
            schema(
                effective_from=date(2026, 6, 1),
                effective_to=date(2026, 6, 1),
                **values,
            )


def test_employee_rejects_invalid_lifecycle_dates() -> None:
    with pytest.raises(ValidationError, match="离职日期"):
        EmployeeIn(
            company_id=1,
            id_number="11010119900101123X",
            employee_no="E001",
            name="张三",
            employee_type="employee",
            hire_date=date(2026, 6, 10),
            termination_date=date(2026, 6, 9),
            assignment={
                "subject_id": 1,
                "subject_department_id": 1,
                "position_title": "工程师",
                "effective_from": date(2026, 6, 10),
            },
            salary={
                "fixed_salary": Decimal("8000"),
                "performance_base": Decimal("2000"),
                "effective_from": date(2026, 6, 10),
            },
            base={"city_id": 1, "effective_from": date(2026, 6, 10)},
            bank_account={
                "account_number": "6222",
                "account_name": "张三",
                "effective_from": date(2026, 6, 10),
            },
        )


def employee_payload(*, probation_status: str, performance_base: str) -> dict:
    return {
        "company_id": 1,
        "id_number": "11010119900101123X",
        "employee_no": "E001",
        "name": "张三",
        "employee_type": "employee",
        "probation_status": probation_status,
        "hire_date": date(2026, 6, 1),
        "assignment": {
            "subject_id": 1,
            "subject_department_id": 1,
            "position_title": "工程师",
            "effective_from": date(2026, 6, 1),
        },
        "salary": {
            "fixed_salary": Decimal("8000"),
            "performance_base": Decimal(performance_base),
            "effective_from": date(2026, 6, 1),
        },
        "base": {"city_id": 1, "effective_from": date(2026, 6, 1)},
        "bank_account": {
            "account_number": "6222",
            "account_name": "张三",
            "effective_from": date(2026, 6, 1),
        },
    }


def test_salary_policy_requires_eighty_twenty_and_no_probation_performance() -> None:
    with pytest.raises(ValidationError, match="试用期"):
        EmployeeIn(**employee_payload(probation_status="in_probation", performance_base="2000"))
    with pytest.raises(ValidationError, match="80%/20%"):
        EmployeeIn(**employee_payload(probation_status="confirmed", performance_base="1000"))
    EmployeeIn(**employee_payload(probation_status="confirmed", performance_base="2000"))
