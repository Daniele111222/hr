from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError


def integrity_detail(exc: IntegrityError) -> str:
    detail = "数据违反唯一性或关联约束"
    message = str(exc.orig).lower()
    details = {
        "uq_company_code": "公司编码已存在",
        "uq_city_code": "城市编码已存在",
        "uq_subject_company_code": "主体编码已在本公司使用",
        "uq_department_company_code": "部门编码已在本公司使用",
        "uq_subject_department_code": "该主体下的部门实例编码已存在",
        "uq_employee_company_id_number": "身份证号码已在本公司使用",
        "uq_employee_company_employee_no": "员工编号已在本公司使用",
        "uq_subject_department": "该主体和部门关系已存在",
        "uq_employee_bank_account": "该银行卡已登记",
        "ex_social_security_rule_dates": "社保规则有效期与已有版本重叠",
        "ex_housing_fund_rule_dates": "公积金规则有效期与已有版本重叠",
        "ex_attendance_rule_dates": "考勤规则有效期与已有版本重叠",
        "uq_attendance_rule_start": "考勤规则生效日期已存在",
        "ck_housing_fund_confirmed_rates": "公积金个人和公司比例必须均为 5%",
        "uq_payroll_period_start": "该工资期间已存在",
        "uq_payroll_period_year_month": "该工资期间已存在",
        "uq_payroll_batch_normal": "该主体在此工资期间已有正常批次",
        "uq_payroll_batch_identity": "该工资批次已存在",
        "ck_payroll_period_year": "工资期间年份与起始日期不一致",
        "ck_payroll_period_month_match": "工资期间月份与起始日期不一致",
        "ck_payroll_period_first_day": "工资期间必须从每月第一天开始",
        "ck_payroll_period_last_day": "工资期间必须结束于当月最后一天",
        "ck_payroll_batch_type": "工资批次类型无效",
        "ck_payroll_batch_status": "工资批次状态无效",
        "ck_department_not_self_parent": "上级部门不能是自身",
    }
    for constraint, message_text in details.items():
        if constraint in message:
            return message_text
    if "department hierarchy cannot contain a cycle" in message:
        return "部门上下级不能形成循环"
    if "effective" in message or "daterange" in message:
        return "生效日期区间与已有记录重叠"
    if "foreign key" in message or "violates fk_" in message:
        return "关联数据不存在或仍被其他数据引用"
    return detail


def install_error_handlers(application: FastAPI) -> None:
    @application.exception_handler(IntegrityError)
    async def integrity_error(_: Request, exc: IntegrityError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": integrity_detail(exc)})
