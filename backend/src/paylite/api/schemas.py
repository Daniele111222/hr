from datetime import date
from decimal import Decimal
from typing import Literal

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
