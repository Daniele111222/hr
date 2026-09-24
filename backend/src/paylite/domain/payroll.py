"""Calculate one employee's ordinary monthly payroll from normalized inputs."""

from dataclasses import dataclass
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal, localcontext

CENT = Decimal("0.01")


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class SalarySegment:
    days: int
    fixed_salary: Decimal


@dataclass(frozen=True)
class Attendance:
    expected_work_days: Decimal
    late_minutes: int
    early_leave_minutes: int
    unpaid_leave_days: Decimal
    missed_punch_count: int
    corrected_punch_count: int


@dataclass(frozen=True)
class SocialItem:
    code: str
    name: str
    employee_rate: Decimal
    company_rate: Decimal


@dataclass(frozen=True)
class PayrollInput:
    month_days: int
    salary_segments: tuple[SalarySegment, ...]
    performance_base: Decimal
    performance_coefficient: Decimal | None
    attendance: Attendance
    level_number: int | None
    social_base: Decimal
    social_items: tuple[SocialItem, ...]
    housing_fixed_salary: Decimal
    housing_rate: Decimal
    standard_hours: Decimal
    missed_punch_amount: Decimal
    exempt_level_number: int


@dataclass(frozen=True)
class PayrollItemResult:
    code: str
    name: str
    category: str
    amount: Decimal


@dataclass(frozen=True)
class CalculationStep:
    code: str
    formula: str
    inputs: dict[str, str]
    amount: Decimal


@dataclass(frozen=True)
class PayrollResult:
    fixed: Decimal
    performance: Decimal
    attendance_deduction: Decimal
    gross: Decimal
    employee_social: Decimal
    company_social: Decimal
    employee_housing: Decimal
    company_housing: Decimal
    untaxed_amount: Decimal
    employer_cost: Decimal
    items: tuple[PayrollItemResult, ...]
    steps: tuple[CalculationStep, ...]
    warnings: tuple[str, ...]
    errors: tuple[str, ...]


@dataclass(frozen=True)
class IncentiveCandidate:
    employee_id: int
    subject_id: int
    employee_no: str


@dataclass(frozen=True)
class IncentiveAllocation:
    employee_id: int
    subject_id: int
    employee_no: str
    amount: Decimal


@dataclass(frozen=True)
class AttendanceIncentiveResult:
    pool: Decimal
    average: Decimal
    remainder: Decimal
    allocations: tuple[IncentiveAllocation, ...]


def calculate_attendance_incentive(
    pool: Decimal, candidates: tuple[IncentiveCandidate, ...]
) -> AttendanceIncentiveResult:
    """Split a locked attendance-deduction pool deterministically among eligible employees."""
    normalized_pool = money(pool)
    ordered = tuple(
        sorted(candidates, key=lambda item: (item.subject_id, item.employee_no, item.employee_id))
    )
    if not ordered:
        return AttendanceIncentiveResult(normalized_pool, Decimal("0.00"), Decimal("0.00"), ())
    average = (normalized_pool / len(ordered)).quantize(CENT, rounding=ROUND_DOWN)
    remainder = money(normalized_pool - average * len(ordered))
    allocations = tuple(
        IncentiveAllocation(
            candidate.employee_id,
            candidate.subject_id,
            candidate.employee_no,
            money(average + remainder if index == len(ordered) - 1 else average),
        )
        for index, candidate in enumerate(ordered)
    )
    return AttendanceIncentiveResult(normalized_pool, average, remainder, allocations)


def calculate(value: PayrollInput) -> PayrollResult:
    """Round each wage item once; keep daily and rate calculations at full precision."""
    if value.month_days <= 0 or value.attendance.expected_work_days <= 0:
        raise ValueError("自然日与应出勤天数必须大于零")
    if sum(segment.days for segment in value.salary_segments) > value.month_days:
        raise ValueError("计薪天数不能超过当月自然日")
    if value.performance_coefficient is not None and value.performance_coefficient < 0:
        raise ValueError("绩效系数不能为负数")

    items: list[PayrollItemResult] = []
    steps: list[CalculationStep] = []

    def add(code: str, name: str, category: str, amount: Decimal, formula: str, **inputs: str):
        rounded = money(amount)
        items.append(PayrollItemResult(code, name, category, rounded))
        steps.append(CalculationStep(code, formula, inputs, rounded))
        return rounded

    # Imported coefficients have no application-defined upper bound; adjust precision to their size.
    digits = sum(
        len(number.as_tuple().digits) + max(number.as_tuple().exponent, 0)
        for number in (
            value.performance_base,
            value.performance_coefficient or Decimal(0),
            value.housing_fixed_salary,
            value.social_base,
        )
    )
    with localcontext() as context:
        context.prec = max(digits + 20, 50)
        fixed_raw = sum(
            (
                segment.fixed_salary * segment.days / value.month_days
                for segment in value.salary_segments
            ),
            Decimal(0),
        )
        fixed = add(
            "fixed_salary",
            "固定薪资",
            "income",
            fixed_raw,
            "各生效区间固定月薪 × 计薪自然日 ÷ 当月自然日之和",
            month_days=str(value.month_days),
            segments=";".join(
                f"{segment.fixed_salary}×{segment.days}" for segment in value.salary_segments
            ),
        )
        worked_days = sum(segment.days for segment in value.salary_segments)
        performance_raw = (
            value.performance_base * value.performance_coefficient * worked_days / value.month_days
            if value.performance_coefficient is not None
            else Decimal(0)
        )
        performance = add(
            "performance",
            "绩效金额",
            "income",
            performance_raw,
            "转正后绩效基数 × 当月绩效系数 × 计薪自然日 ÷ 当月自然日",
            base=str(value.performance_base),
            coefficient=str(value.performance_coefficient or 0),
            worked_days=str(worked_days),
            month_days=str(value.month_days),
        )
        attendance_total = Decimal(0)
        exempt = value.level_number is not None and value.level_number >= value.exempt_level_number
        fixed_full = value.housing_fixed_salary
        per_minute = fixed_full / value.attendance.expected_work_days / value.standard_hours / 60
        deductions = (
            ("attendance_late", "迟到扣款", Decimal(value.attendance.late_minutes) * per_minute),
            (
                "attendance_early",
                "早退扣款",
                Decimal(value.attendance.early_leave_minutes) * per_minute,
            ),
            (
                "attendance_unpaid_leave",
                "无薪请假扣款",
                value.attendance.unpaid_leave_days
                * fixed_full
                / value.attendance.expected_work_days,
            ),
            (
                "attendance_missed_punch",
                "忘打卡扣款",
                Decimal(
                    value.attendance.missed_punch_count - value.attendance.corrected_punch_count
                )
                * value.missed_punch_amount,
            ),
        )
        for code, name, amount in deductions:
            attendance_total += add(
                code,
                name,
                "deduction",
                Decimal(0) if exempt else amount,
                "P7及以上免考勤处罚" if exempt else "依据固定月薪、应出勤天数和考勤事实计算",
                fixed_salary=str(fixed_full),
                expected_work_days=str(value.attendance.expected_work_days),
            )
        employee_social = Decimal(0)
        company_social = Decimal(0)
        for rule in value.social_items:
            employee_social += add(
                f"social_employee_{rule.code}",
                f"个人{rule.name}",
                "deduction",
                value.social_base * rule.employee_rate,
                "城市统一社保基数 × 个人比例",
                base=str(value.social_base),
                rate=str(rule.employee_rate),
            )
            company_social += add(
                f"social_company_{rule.code}",
                f"公司{rule.name}",
                "employer_cost",
                value.social_base * rule.company_rate,
                "城市统一社保基数 × 公司比例",
                base=str(value.social_base),
                rate=str(rule.company_rate),
            )
        employee_housing = add(
            "housing_employee",
            "个人公积金",
            "deduction",
            fixed_full * value.housing_rate,
            "固定月薪 × 个人公积金比例",
            base=str(fixed_full),
            rate=str(value.housing_rate),
        )
        company_housing = add(
            "housing_company",
            "公司公积金",
            "employer_cost",
            fixed_full * value.housing_rate,
            "固定月薪 × 公司公积金比例",
            base=str(fixed_full),
            rate=str(value.housing_rate),
        )
        gross = money(fixed + performance - attendance_total)
        untaxed = money(gross - employee_social - employee_housing)
        employer_cost = money(gross + company_social + company_housing)
        for code, amount, formula in (
            ("gross", gross, "固定薪资 + 绩效金额 − 考勤扣款"),
            ("untaxed_amount", untaxed, "应发金额 − 个人社保 − 个人公积金"),
            ("employer_cost", employer_cost, "应发金额 + 公司社保 + 公司公积金"),
        ):
            steps.append(CalculationStep(code, formula, {}, amount))
        errors = []
        if gross < 0:
            errors.append("考勤扣款超过收入，应发金额为负")
        if untaxed < 0:
            errors.append("个人扣款超过收入，未扣个税金额为负")
        warnings = ("未扣个税金额为零，请核对",) if untaxed == 0 else ()
        return PayrollResult(
            fixed,
            performance,
            attendance_total,
            gross,
            employee_social,
            company_social,
            employee_housing,
            company_housing,
            untaxed,
            employer_cost,
            tuple(items),
            tuple(steps),
            warnings,
            tuple(errors),
        )
