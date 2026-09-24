from decimal import Decimal

from paylite.domain.payroll import IncentiveCandidate, calculate_attendance_incentive


def test_attendance_incentive_rounds_and_assigns_remainder_to_last_sorted_employee() -> None:
    result = calculate_attendance_incentive(
        Decimal("10.00"),
        (
            IncentiveCandidate(3, 2, "E03"),
            IncentiveCandidate(1, 1, "E01"),
            IncentiveCandidate(2, 1, "E02"),
        ),
    )

    assert result.average == Decimal("3.33")
    assert result.remainder == Decimal("0.01")
    assert [item.employee_id for item in result.allocations] == [1, 2, 3]
    assert [item.amount for item in result.allocations] == [
        Decimal("3.33"),
        Decimal("3.33"),
        Decimal("3.34"),
    ]
    assert sum((item.amount for item in result.allocations), Decimal("0")) == result.pool


def test_attendance_incentive_with_no_candidate_does_not_create_zero_allocations() -> None:
    result = calculate_attendance_incentive(Decimal("12.34"), ())

    assert result.pool == Decimal("12.34")
    assert result.allocations == ()
    assert result.average == Decimal("0.00")


def test_attendance_incentive_keeps_tail_nonnegative_for_small_pool() -> None:
    result = calculate_attendance_incentive(
        Decimal("0.01"),
        (IncentiveCandidate(1, 1, "E001"), IncentiveCandidate(2, 1, "E002")),
    )

    assert [item.amount for item in result.allocations] == [Decimal("0.00"), Decimal("0.01")]
    assert result.remainder == Decimal("0.01")
