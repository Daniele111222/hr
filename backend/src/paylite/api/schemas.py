from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CompanyIn(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)


class CompanyPatch(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=50)
    name: str | None = Field(default=None, min_length=1, max_length=200)


class CompanyOut(CompanyIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class CityIn(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=100)


class CityPatch(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=50)
    name: str | None = Field(default=None, min_length=1, max_length=100)


class CityOut(CityIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class SocialSecurityItemRuleIn(BaseModel):
    item_code: str = Field(min_length=1, max_length=30)
    item_name: str = Field(min_length=1, max_length=100)
    company_rate: Decimal = Field(ge=0)
    employee_rate: Decimal = Field(ge=0)


class CityRuleIn(BaseModel):
    city_id: int
    effective_from: date
    effective_to: date | None = None
    version: str = Field(min_length=1, max_length=50)
    source: str | None = None
    fixed_base: Decimal = Field(ge=0)
    social_items: list[SocialSecurityItemRuleIn] = Field(min_length=1)
    housing_company_rate: Decimal = Decimal("0.05")
    housing_employee_rate: Decimal = Decimal("0.05")

    @model_validator(mode="after")
    def valid_rule(self):
        if self.effective_to and self.effective_to <= self.effective_from:
            raise ValueError("规则结束日期必须晚于生效日期")
        if self.housing_company_rate != Decimal("0.05") or self.housing_employee_rate != Decimal(
            "0.05"
        ):
            raise ValueError("公积金个人和公司比例必须均为 5%")
        return self


class SocialSecurityItemRuleOut(SocialSecurityItemRuleIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class CityRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    city_id: int
    city_name: str
    effective_from: date
    effective_to: date | None
    version: str
    source: str | None
    fixed_base: Decimal | None
    social_items: list[SocialSecurityItemRuleOut]
    housing_company_rate: Decimal | None
    housing_employee_rate: Decimal | None
    housing_base_source: str | None


class AttendanceRuleIn(BaseModel):
    effective_from: date
    effective_to: date | None = None
    standard_hours: Decimal = Decimal("8")
    missed_punch_amount: Decimal = Decimal("30")
    exempt_level_number: int = 7
    makeup_punch_exempt: bool = True
    version: str = Field(min_length=1, max_length=50)
    source: str | None = None

    @model_validator(mode="after")
    def valid_attendance_rule(self):
        if self.effective_to and self.effective_to <= self.effective_from:
            raise ValueError("规则结束日期必须晚于生效日期")
        if self.standard_hours != Decimal("8"):
            raise ValueError("每日标准工时必须为 8 小时")
        if self.missed_punch_amount != Decimal("30"):
            raise ValueError("忘打卡每次罚款必须为 30 元")
        if self.exempt_level_number != 7:
            raise ValueError("免考勤罚款职级必须为 P7 及以上")
        if not self.makeup_punch_exempt:
            raise ValueError("补卡后必须免除忘打卡罚款")
        return self


class AttendanceRuleOut(AttendanceRuleIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class SubjectIn(BaseModel):
    company_id: int
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)


class SubjectPatch(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=50)
    name: str | None = Field(default=None, min_length=1, max_length=200)


class SubjectOut(SubjectIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class DepartmentIn(BaseModel):
    company_id: int
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    parent_id: int | None = None


class DepartmentPatch(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=50)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    parent_id: int | None = None


class DepartmentOut(DepartmentIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class SubjectDepartmentIn(BaseModel):
    company_id: int
    subject_id: int
    department_id: int
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)


class SubjectDepartmentPatch(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=50)
    name: str | None = Field(default=None, min_length=1, max_length=200)


class SubjectDepartmentOut(SubjectDepartmentIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class AssignmentIn(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    subject_id: int
    subject_department_id: int
    position_title: str = Field(min_length=1, max_length=100)
    level_code: str | None = Field(default=None, max_length=30)
    level_number: int | None = Field(default=None, ge=0)
    effective_from: date
    effective_to: date | None = None

    @model_validator(mode="after")
    def valid_dates(self):
        if self.effective_to and self.effective_to <= self.effective_from:
            raise ValueError("任职结束日期必须晚于生效日期")
        return self


class SalaryIn(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    fixed_salary: Decimal = Field(ge=0)
    performance_base: Decimal = Field(ge=0)
    effective_from: date
    effective_to: date | None = None

    @model_validator(mode="after")
    def valid_dates(self):
        if self.effective_to and self.effective_to <= self.effective_from:
            raise ValueError("薪酬结束日期必须晚于生效日期")
        return self


class BankIn(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    account_number: str = Field(min_length=1)
    account_name: str = Field(min_length=1, max_length=100)
    bank_name: str | None = Field(default=None, max_length=100)
    branch_name: str | None = Field(default=None, max_length=100)
    is_primary: bool = True
    effective_from: date
    effective_to: date | None = None

    @model_validator(mode="after")
    def valid_dates(self):
        if self.effective_to and self.effective_to <= self.effective_from:
            raise ValueError("银行卡结束日期必须晚于生效日期")
        return self


class BaseIn(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    city_id: int
    effective_from: date
    effective_to: date | None = None

    @model_validator(mode="after")
    def valid_dates(self):
        if self.effective_to and self.effective_to <= self.effective_from:
            raise ValueError("base 地结束日期必须晚于生效日期")
        return self


class EmployeeIn(BaseModel):
    company_id: int
    id_number: str = Field(min_length=1)
    employee_no: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=100)
    employee_type: str = Field(min_length=1, max_length=50)
    level_code: str | None = Field(default=None, max_length=30)
    level_number: int | None = Field(default=None, ge=0)
    formal_status: bool = False
    probation_status: Literal["not_applicable", "in_probation", "confirmed"] = "not_applicable"
    probation_date: date | None = None
    hire_date: date
    termination_date: date | None = None
    active: bool = True
    assignment: AssignmentIn
    salary: SalaryIn
    base: BaseIn
    bank_account: BankIn

    @model_validator(mode="after")
    def valid_employee_dates(self):
        if self.termination_date and self.termination_date < self.hire_date:
            raise ValueError("离职日期不能早于入职日期")
        if self.probation_date and self.probation_date < self.hire_date:
            raise ValueError("转正日期不能早于入职日期")
        if self.probation_status == "in_probation" and self.salary.performance_base != 0:
            raise ValueError("试用期员工不应有绩效基数")
        if (
            self.probation_status != "in_probation"
            and self.salary.performance_base * 4 != self.salary.fixed_salary
        ):
            raise ValueError("固定薪资和绩效基数必须按 80%/20% 表达")
        return self


class EmployeePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    employee_type: str | None = Field(default=None, min_length=1, max_length=50)
    level_code: str | None = Field(default=None, max_length=30)
    level_number: int | None = Field(default=None, ge=0)
    formal_status: bool | None = None
    probation_status: Literal["not_applicable", "in_probation", "confirmed"] | None = None
    probation_date: date | None = None
    termination_date: date | None = None
    active: bool | None = None
    assignment: AssignmentIn | None = None
    salary: SalaryIn | None = None
    base: BaseIn | None = None
    bank_account: BankIn | None = None


class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    id_number: str
    employee_no: str
    name: str
    employee_type: str
    level_code: str | None
    level_number: int | None
    formal_status: bool
    probation_status: str
    probation_date: date | None
    hire_date: date
    termination_date: date | None
    active: bool
    assignment: AssignmentIn | None = None
    salary: SalaryIn | None = None
    base: BaseIn | None = None
    bank_account: BankIn | None = None


class PayrollPeriodCreate(BaseModel):
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")


class PayrollPeriodOut(BaseModel):
    id: int
    year: int
    month: int
    period: str
    period_start: date
    period_end: date
    payment_date: date | None
    payment_date_confirmed: bool
    batch_count: int = 0
    normal_batch_count: int = 0


class PayrollBatchCreate(BaseModel):
    subject_id: int
    batch_type: Literal["normal"] = "normal"
    name: str | None = Field(default=None, max_length=200)


class PayrollSubjectOut(BaseModel):
    id: int
    code: str
    name: str


class PayrollScopeOut(BaseModel):
    source: str
    criteria: dict[str, object]
    employee_count: int
    employee_ids: list[int]
    ambiguous_employee_ids: list[int]
    status: Literal["ready", "blocked", "empty"]


class PayrollPreparationItemOut(BaseModel):
    status: Literal["ready", "partial", "missing", "blocked", "not_required"]
    prepared_count: int
    missing_count: int
    message: str | None = None


class PayrollDataPreparationOut(BaseModel):
    attendance: PayrollPreparationItemOut
    performance: PayrollPreparationItemOut
    city_rules: PayrollPreparationItemOut
    overall_status: Literal["ready", "partial", "blocked"]


class PayrollBatchOut(BaseModel):
    id: int
    period_id: int
    subject: PayrollSubjectOut
    batch_type: Literal["normal", "supplement", "performance_supplement", "other"]
    batch_no: int
    name: str | None
    status: Literal["draft", "trial", "confirmed", "locked", "exported", "cancelled"]
    scope: PayrollScopeOut
    data_preparation: PayrollDataPreparationOut
    payment_date: date | None
    payment_date_confirmed: bool


class PayrollWorkbenchOut(BaseModel):
    period: PayrollPeriodOut | None
    periods: list[PayrollPeriodOut]
    batches: list[PayrollBatchOut]


class PayrollTrialOut(BaseModel):
    id: int
    payroll_batch_id: int
    input_fingerprint: str
    created_at: datetime
    stale: bool
    success_count: int
    error_count: int
    total_count: int
    totals: dict[str, str]
    results: list[dict[str, Any]]
    includes_final_incentive: bool
    ready_for_confirmation: bool
    confirmation_blockers: list[str]


class AttendanceIncentiveRunOut(BaseModel):
    id: int
    company_id: int
    payroll_period_id: int
    source_period_id: int
    status: Literal["calculated", "empty", "stale"]
    input_fingerprint: str
    pool_amount: str
    allocated_amount: str
    average_amount: str
    remainder_amount: str
    source_snapshot: list[dict[str, Any]]
    candidate_snapshot: list[dict[str, Any]]
    allocations: list[dict[str, Any]]
    message: str | None
    created_at: datetime
    stale: bool
    ready: bool


class AttendanceIncentiveOut(BaseModel):
    period_id: int
    period: str
    source_period: str | None
    company_id: int
    status: Literal["blocked", "ready", "calculated", "empty", "stale"]
    can_calculate: bool
    message: str | None
    source_rows: list[dict[str, Any]]
    current_rows: list[dict[str, Any]]
    pool_amount: str
    candidate_snapshot: list[dict[str, Any]]
    run: AttendanceIncentiveRunOut | None
    input_fingerprint: str
