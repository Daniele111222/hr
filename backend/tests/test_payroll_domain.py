from dataclasses import replace
from decimal import Decimal

from paylite.domain.payroll import Attendance, PayrollInput, SalarySegment, SocialItem, calculate


def example(*, level: int = 6) -> PayrollInput:
    return PayrollInput(
        month_days=30,
        salary_segments=(SalarySegment(15, Decimal("8000")),),
        attendance=Attendance(Decimal("20"), 60, 0, Decimal("1"), 2, 1),
        level_number=level,
        social_base=Decimal("5000"),
        social_items=(SocialItem("pension", "养老", Decimal("0.10"), Decimal("0.20")),),
        housing_fixed_salary=Decimal("8000"),
        housing_rate=Decimal("0.05"),
        standard_hours=Decimal("8"),
        missed_punch_amount=Decimal("30"),
        exempt_level_number=7,
    )


def test_monthly_payroll_excludes_performance_income() -> None:
    result = calculate(example())
    assert result.gross == Decimal("3520.00")
    assert result.untaxed_amount == Decimal("2620.00")
    assert all(item.code != "performance" for item in result.items)


def test_ordinary_payroll_prorates_calendar_days_and_rounds_items() -> None:
    result = calculate(example())
    assert result.fixed == Decimal("4000.00")
    assert result.attendance_deduction == Decimal("480.00")
    assert result.gross == Decimal("3520.00")
    assert result.employee_social == Decimal("500.00")
    assert result.employee_housing == Decimal("400.00")
    assert result.untaxed_amount == Decimal("2620.00")
    assert result.employer_cost == Decimal("4920.00")
    assert result.errors == ()
    assert {step.code for step in result.steps} >= {"fixed_salary", "untaxed_amount"}


def test_p7_has_no_attendance_penalty() -> None:
    result = calculate(example(level=7))
    assert result.attendance_deduction == Decimal("0.00")
    assert result.untaxed_amount == Decimal("3100.00")


def test_zero_is_warning_and_negative_untaxed_amount_is_error() -> None:
    zero = calculate(
        replace(
            example(),
            salary_segments=(SalarySegment(0, Decimal("8000")),),
            social_base=Decimal(0),
            housing_fixed_salary=Decimal(0),
            attendance=Attendance(Decimal("20"), 0, 0, Decimal(0), 0, 0),
        )
    )
    assert zero.untaxed_amount == 0
    assert zero.warnings
    negative = calculate(
        replace(
            example(),
            salary_segments=(SalarySegment(1, Decimal("8000")),),
        )
    )
    assert negative.untaxed_amount < 0
    assert negative.errors


def test_change_day_uses_new_salary_and_rounds_half_up() -> None:
    result = calculate(
        replace(
            example(),
            month_days=31,
            salary_segments=(
                SalarySegment(15, Decimal("8000")),
                SalarySegment(16, Decimal("10000")),
            ),
            attendance=Attendance(Decimal("20"), 0, 0, Decimal(0), 0, 0),
        )
    )
    assert result.fixed == Decimal("9032.26")


def test_p7_exempts_all_penalties_even_with_unpaid_leave() -> None:
    result = calculate(
        replace(example(level=7), attendance=Attendance(Decimal("20"), 90, 90, Decimal("2"), 3, 1))
    )
    assert result.attendance_deduction == 0
    assert all(item.amount == 0 for item in result.items if item.code.startswith("attendance_"))
