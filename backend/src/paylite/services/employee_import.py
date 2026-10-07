"""Employee master import use case and transaction boundary."""

import hashlib
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

from openpyxl.utils import get_column_letter
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from paylite.db.models import (
    City,
    Company,
    Department,
    Employee,
    EmployeeAssignment,
    EmployeeBankAccount,
    EmployeeBase,
    EmployeeSalary,
    ImportBatch,
    ImportRow,
    Subject,
    SubjectDepartment,
)
from paylite.excel.employee_template import (
    HEADERS,
    LEGACY_HEADERS,
    LEGACY_TEMPLATE_VERSION,
    SHEET_NAME,
    TEMPLATE_VERSION,
    WorkbookFormatError,
    parse_workbook,
)

ID_PATTERN = re.compile(r"^\d{17}[\dX]$")
REQUIRED = (
    "身份证号",
    "员工编号",
    "姓名",
    "员工类型",
    "入职日期",
    "转正状态",
    "是否正式",
    "主体编码",
    "部门编码",
    "职位",
    "固定薪资",
    "绩效基数",
    "base城市编码",
    "银行卡号",
    "开户名",
    "生效日期",
)
FIELD_LIMITS = {
    "员工编号": 50,
    "姓名": 100,
    "员工类型": 50,
    "主体编码": 50,
    "部门编码": 50,
    "职位": 100,
    "职级": 30,
    "base城市编码": 50,
    "开户名": 100,
    "银行名称": 100,
    "支行名称": 100,
}


class ImportFailure(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(message)


def _issue(code: str, field: str, message: str, row: int) -> dict[str, str]:
    headers = LEGACY_HEADERS if field in LEGACY_HEADERS else HEADERS
    letter = get_column_letter(headers.index(field) + 1)
    return {
        "code": code,
        "field": field,
        "column": letter,
        "cell": f"{letter}{row}",
        "message": message,
    }


def _date(raw: str, field: str, row: int, errors: list[dict[str, str]]) -> date | None:
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        errors.append(_issue("INVALID_DATE", field, "日期须为 YYYY-MM-DD", row))
        return None


def _money(raw: str, field: str, row: int, errors: list[dict[str, str]]) -> Decimal | None:
    if not raw:
        return None
    try:
        value = Decimal(raw)
    except InvalidOperation:
        value = None
    if (
        value is None
        or not value.is_finite()
        or value < 0
        or value.as_tuple().exponent < -2
        or value >= Decimal("10000000000000000")
    ):
        errors.append(_issue("INVALID_AMOUNT", field, "金额须为非负且最多两位小数", row))
        return None
    return value


def _validate_values(
    db: Session,
    company_id: int,
    row_number: int,
    raw: dict[str, str],
    workbook_errors: list[dict[str, str]] | None = None,
    *,
    auto_number: bool = False,
) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    errors = list(workbook_errors or [])
    for field in REQUIRED:
        if auto_number and field == "员工编号":
            continue
        if not raw[field]:
            errors.append(_issue("REQUIRED", field, f"{field}不能为空", row_number))
    for field, maximum in FIELD_LIMITS.items():
        if len(raw[field]) > maximum:
            errors.append(_issue("TOO_LONG", field, f"{field}不能超过 {maximum} 字", row_number))
    id_number = raw["身份证号"].upper()
    if id_number and not ID_PATTERN.fullmatch(id_number):
        errors.append(_issue("INVALID_ID", "身份证号", "身份证号须为 18 位文本", row_number))
    if id_number and db.scalar(
        select(Employee.id).where(
            Employee.company_id == company_id,
            Employee.id_number == id_number,
        )
    ):
        errors.append(
            _issue("EMPLOYEE_EXISTS", "身份证号", "身份证号已存在，请到员工管理核对", row_number)
        )
    if (
        not auto_number
        and raw["员工编号"]
        and db.scalar(
            select(Employee.id).where(
                Employee.company_id == company_id,
                Employee.employee_no == raw["员工编号"],
            )
        )
    ):
        errors.append(_issue("EMPLOYEE_NO_EXISTS", "员工编号", "员工编号已存在", row_number))
    hire_date = _date(raw["入职日期"], "入职日期", row_number, errors)
    termination_date = _date(raw["离职日期"], "离职日期", row_number, errors)
    probation_date = _date(raw["转正日期"], "转正日期", row_number, errors)
    effective_date = _date(raw["生效日期"], "生效日期", row_number, errors)
    if hire_date and termination_date and termination_date < hire_date:
        errors.append(_issue("DATE_ORDER", "离职日期", "离职日期不能早于入职日期", row_number))
    if hire_date and probation_date and probation_date < hire_date:
        errors.append(_issue("DATE_ORDER", "转正日期", "转正日期不能早于入职日期", row_number))
    if hire_date and effective_date and effective_date < hire_date:
        errors.append(_issue("DATE_ORDER", "生效日期", "生效日期不能早于入职日期", row_number))
    status = raw["转正状态"]
    if status and status not in {"not_applicable", "in_probation", "confirmed"}:
        errors.append(_issue("INVALID_STATUS", "转正状态", "转正状态值无效", row_number))
    if raw["是否正式"] not in {"是", "否"}:
        errors.append(_issue("INVALID_BOOLEAN", "是否正式", "请填写是或否", row_number))
    level_number = None
    if raw["职级数字"]:
        try:
            level_number = int(raw["职级数字"])
            if level_number < 0:
                raise ValueError
        except ValueError:
            errors.append(_issue("INVALID_LEVEL", "职级数字", "须为非负整数", row_number))
    fixed_salary = _money(raw["固定薪资"], "固定薪资", row_number, errors)
    performance_base = _money(raw["绩效基数"], "绩效基数", row_number, errors)
    if status == "in_probation" and performance_base not in (None, Decimal("0")):
        errors.append(_issue("PROBATION_PAY", "绩效基数", "试用期绩效基数必须为 0", row_number))
    if status != "in_probation" and fixed_salary is not None and performance_base is not None:
        if performance_base * 4 != fixed_salary:
            errors.append(
                _issue(
                    "SALARY_RATIO", "绩效基数", "固定薪资和绩效基数须按 80%/20% 表达", row_number
                )
            )
    subject = (
        db.scalar(
            select(Subject).where(
                Subject.company_id == company_id,
                Subject.code == raw["主体编码"],
            )
        )
        if raw["主体编码"]
        else None
    )
    if raw["主体编码"] and subject is None:
        errors.append(_issue("SUBJECT_NOT_FOUND", "主体编码", "主体编码不存在", row_number))
    relation = (
        db.scalar(
            select(SubjectDepartment).where(
                SubjectDepartment.subject_id == subject.id,
                SubjectDepartment.code == raw["部门编码"],
            )
        )
        if subject and raw["部门编码"]
        else None
    )
    if raw["部门编码"] and relation is None:
        errors.append(
            _issue("DEPARTMENT_NOT_FOUND", "部门编码", "该主体下部门编码不存在", row_number)
        )
    city = (
        db.scalar(select(City).where(City.code == raw["base城市编码"]))
        if raw["base城市编码"]
        else None
    )
    if raw["base城市编码"] and city is None:
        errors.append(_issue("CITY_NOT_FOUND", "base城市编码", "城市编码不存在", row_number))
    if errors:
        return None, errors
    return {
        "company_id": company_id,
        "id_number": id_number,
        "employee_no": raw["员工编号"] or None,
        "name": raw["姓名"],
        "employee_type": raw["员工类型"],
        "level_code": raw["职级"] or None,
        "level_number": level_number,
        "formal_status": raw["是否正式"] == "是",
        "probation_status": status,
        "probation_date": probation_date,
        "hire_date": hire_date,
        "termination_date": termination_date,
        "subject_id": subject.id,
        "subject_department_id": relation.id,
        "position_title": raw["职位"],
        "fixed_salary": fixed_salary,
        "performance_base": performance_base,
        "city_id": city.id,
        "account_number": raw["银行卡号"],
        "account_name": raw["开户名"],
        "bank_name": raw["银行名称"] or None,
        "branch_name": raw["支行名称"] or None,
        "effective_from": effective_date,
    }, []


def _validate(
    db: Session,
    company_id: int,
    row_number: int,
    raw: dict[str, str],
    workbook_errors: list[dict[str, str]] | None = None,
    *,
    imported_on: date | None = None,
) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    if "证件号码" not in raw:
        return _validate_values(db, company_id, row_number, raw, workbook_errors)

    imported_on = imported_on or datetime.now(ZoneInfo("Asia/Shanghai")).date()
    fields = {
        "身份证号": "证件号码",
        "姓名": "姓名",
        "入职日期": "入职时间",
        "离职日期": "离职时间",
        "转正日期": "转正日期",
        "职位": "岗位",
        "职级": "职级",
        "职级数字": "职级",
        "固定薪资": "转正固定薪资",
        "绩效基数": "转正绩效标准",
        "银行卡号": "银行卡号",
        "银行名称": "开户行",
        "主体编码": "公司主体全称",
        "部门编码": next(
            (field for field in ("三级部门", "二级部门", "一级部门") if raw[field]), "一级部门"
        ),
        "base城市编码": "公司主体全称",
        "生效日期": "入职时间",
    }
    values = {field: "" for field in LEGACY_HEADERS}
    for field, source in fields.items():
        values[field] = raw[source]
    values.update(员工类型="employee", 是否正式="是", 开户名=raw["姓名"])
    values["生效日期"] = imported_on.isoformat()
    errors: list[dict[str, str]] = []

    subjects = list(
        db.scalars(
            select(Subject).where(
                Subject.company_id == company_id, Subject.name == raw["公司主体全称"]
            )
        )
    )
    subject = subjects[0] if len(subjects) == 1 else None
    values["主体编码"] = subject.code if subject else raw["公司主体全称"]
    if raw["公司主体全称"] and subject is None:
        errors.append(
            _issue(
                "SUBJECT_NOT_FOUND",
                "公司主体全称",
                "公司主体全称须唯一匹配已维护的主体",
                row_number,
            )
        )

    parent_ids = None
    departments = []
    department_fields = ("一级部门", "二级部门", "三级部门")
    for index, field in enumerate(department_fields):
        if not raw[field]:
            if any(raw[later] for later in department_fields[index + 1 :]):
                errors.append(
                    _issue("DEPARTMENT_LEVEL_GAP", field, "部门层级不能跳级填写", row_number)
                )
            break
        departments = list(
            db.scalars(
                select(Department).where(
                    Department.company_id == company_id,
                    (
                        Department.parent_id.is_(None)
                        if parent_ids is None
                        else Department.parent_id.in_(parent_ids)
                    ),
                    Department.name == raw[field],
                )
            )
        )
        if not departments:
            errors.append(
                _issue("DEPARTMENT_NOT_FOUND", field, "该层级部门名称无法唯一匹配", row_number)
            )
            break
        parent_ids = [department.id for department in departments]
    relations = (
        list(
            db.scalars(
                select(SubjectDepartment).where(
                    SubjectDepartment.subject_id == subject.id,
                    SubjectDepartment.department_id.in_(
                        [department.id for department in departments]
                    ),
                )
            )
        )
        if subject and departments
        else []
    )
    relation = relations[0] if len(relations) == 1 else None
    if subject and relation is None:
        errors.append(
            _issue(
                "DEPARTMENT_NOT_FOUND",
                fields["部门编码"],
                "该主体下部门路径无法唯一匹配",
                row_number,
            )
        )
    values["部门编码"] = relation.code if relation else ""

    cities = list(db.scalars(select(City)))
    subject_name = subject.name if subject else raw["公司主体全称"]
    if subject_name.endswith("分公司"):
        matches = [
            city
            for city in cities
            if subject_name.endswith(f"{city.name.removesuffix('市')}分公司")
            or subject_name.endswith(f"{city.name}分公司")
        ]
    else:
        locations = re.findall(r"[（(]([^（）()]+)[）)]", subject_name)
        matches = [
            city
            for city in cities
            if city.name.removesuffix("市") in locations or city.name in locations
        ]
    values["base城市编码"] = matches[0].code if len(matches) == 1 else ""
    if len(matches) != 1:
        errors.append(
            _issue(
                "CITY_NOT_FOUND",
                "公司主体全称",
                "无法从主体名称唯一匹配已维护的 base 城市，请先维护城市与主体名称",
                row_number,
            )
        )

    level = re.fullmatch(r"[Pp]?(\d+)", raw["职级"])
    values["职级数字"] = level.group(1) if level else ""
    if raw["职级"] and level is None:
        errors.append(_issue("INVALID_LEVEL", "职级", "职级须为 P 加数字或非负整数", row_number))

    try:
        probation_date = date.fromisoformat(raw["转正日期"])
    except ValueError:
        probation_date = None
    status = "confirmed" if probation_date and probation_date <= imported_on else "in_probation"
    values["转正状态"] = status
    fixed = _money(raw["转正固定薪资"], "固定薪资", row_number, errors)
    performance = _money(raw["转正绩效标准"], "绩效基数", row_number, errors)
    if not raw["转正绩效标准"]:
        errors.append(_issue("REQUIRED", "转正绩效标准", "转正绩效标准不能为空", row_number))
    if fixed is not None and performance is not None and performance * 4 != fixed:
        errors.append(
            _issue(
                "SALARY_RATIO",
                "转正绩效标准",
                "转正固定薪资和绩效标准须按 80%/20% 表达",
                row_number,
            )
        )
    probation_fixed = _money(raw["试用期底薪"], "试用期底薪", row_number, errors)
    probation_performance = _money(raw["试用期绩效"], "试用期绩效", row_number, errors)
    if probation_fixed is not None and fixed is not None and probation_fixed != fixed:
        errors.append(
            _issue("PROBATION_FIXED", "试用期底薪", "试用期底薪须与转正固定薪资相同", row_number)
        )
    if probation_performance not in (None, Decimal("0")):
        errors.append(_issue("PROBATION_PAY", "试用期绩效", "试用期绩效必须为 0", row_number))
    values["绩效基数"] = (
        str(performance) if status == "confirmed" and performance is not None else "0"
    )
    normalized, validation_errors = _validate_values(
        db, company_id, row_number, values, auto_number=True
    )
    errors.extend(validation_errors)
    for error in errors:
        field = fields.get(error["field"], error["field"])
        # 自动生成的信息没有模板列；相关错误定位到它的实际输入来源。
        field = {"开户名": "姓名", "转正状态": "转正日期"}.get(field, field)
        letter = get_column_letter(HEADERS.index(field) + 1)
        error.update(
            message=(
                "入职时间不能晚于本次导入日期"
                if error["field"] == "生效日期"
                else error["message"].replace(error["field"], field)
            ),
            field=field,
            column=letter,
            cell=f"{letter}{row_number}",
        )
    errors = [*(workbook_errors or []), *errors]
    if errors:
        return None, errors
    return normalized, []


def _save_employee(db: Session, values: dict[str, Any]) -> int:
    employee = Employee(
        **{
            key: values[key]
            for key in (
                "company_id",
                "id_number",
                "employee_no",
                "name",
                "employee_type",
                "level_code",
                "level_number",
                "formal_status",
                "probation_status",
                "probation_date",
                "hire_date",
                "termination_date",
            )
        }
    )
    if employee.employee_no is None:
        while True:
            employee.id = db.scalar(
                select(func.nextval(func.pg_get_serial_sequence("employee", "id")))
            )
            employee.employee_no = f"AUTO-{employee.id}"
            if (
                db.scalar(
                    select(Employee.id).where(
                        Employee.company_id == employee.company_id,
                        Employee.employee_no == employee.employee_no,
                    )
                )
                is None
            ):
                break
    db.add(employee)
    db.flush()
    employee_id = employee.id
    effective_date = values["effective_from"]
    salary = EmployeeSalary(
        employee_id=employee_id,
        fixed_salary=values["fixed_salary"],
        performance_base=values["performance_base"],
        effective_from=effective_date,
        source="employee_import",
    )
    db.add_all(
        [
            EmployeeAssignment(
                employee_id=employee_id,
                subject_id=values["subject_id"],
                subject_department_id=values["subject_department_id"],
                position_title=values["position_title"],
                level_code=values["level_code"],
                level_number=values["level_number"],
                effective_from=effective_date,
            ),
            salary,
            EmployeeBase(
                employee_id=employee_id, city_id=values["city_id"], effective_from=effective_date
            ),
            EmployeeBankAccount(
                employee_id=employee_id,
                account_number=values["account_number"],
                account_name=values["account_name"],
                bank_name=values["bank_name"],
                branch_name=values["branch_name"],
                is_primary=True,
                effective_from=effective_date,
            ),
        ]
    )
    db.flush()
    return employee_id


def _serialize(batch: ImportBatch, rows: list[ImportRow] | None = None) -> dict[str, Any]:
    items = [
        {
            "id": row.id,
            "sheet_name": row.sheet_name,
            "source_row_number": row.source_row_number,
            "validation_status": row.validation_status,
            "raw_data": row.raw_data,
            "correction_values": row.correction_values,
            "normalized_data": row.normalized_data,
            "errors": row.errors,
            "correction_history": row.correction_history,
        }
        for row in rows or []
    ]
    return {
        "id": batch.id,
        "company_id": batch.company_id,
        "import_type": batch.import_type,
        "original_filename": batch.original_filename,
        "file_sha256": batch.file_sha256,
        "template_version": batch.template_version,
        "field_mapping": batch.field_mapping,
        "status": batch.status,
        "uploaded_at": batch.uploaded_at,
        "total_rows": len(rows or []),
        "success_rows": sum(row.validation_status == "imported" for row in rows or []),
        "error_rows": sum(row.validation_status == "invalid" for row in rows or []),
        "rows": items if rows is not None else None,
    }


def _rows(db: Session, batch_id: int) -> list[ImportRow]:
    return list(
        db.scalars(
            select(ImportRow)
            .where(
                ImportRow.import_batch_id == batch_id,
            )
            .order_by(ImportRow.source_row_number)
        )
    )


def get_batch(db: Session, batch_id: int, *, include_file: bool = False) -> dict[str, Any]:
    batch = db.get(ImportBatch, batch_id)
    if batch is None or batch.import_type != "employee_master":
        raise ImportFailure(404, "导入批次不存在")
    result = _serialize(batch, _rows(db, batch_id))
    if include_file:
        result["original_file"] = batch.original_file
    return result


def list_batches(db: Session, company_id: int) -> list[dict[str, Any]]:
    batches = db.scalars(
        select(ImportBatch)
        .where(
            ImportBatch.company_id == company_id,
            ImportBatch.import_type == "employee_master",
        )
        .order_by(ImportBatch.uploaded_at.desc(), ImportBatch.id.desc())
    )
    return [_serialize(batch, _rows(db, batch.id)) | {"rows": None} for batch in batches]


def upload_batch(db: Session, company_id: int, filename: str, content: bytes) -> dict[str, Any]:
    if db.get(Company, company_id) is None:
        raise ImportFailure(404, "目标公司不存在")
    digest = hashlib.sha256(content).hexdigest()
    if db.scalar(
        select(ImportBatch.id).where(
            ImportBatch.company_id == company_id,
            ImportBatch.import_type == "employee_master",
            ImportBatch.file_sha256 == digest,
        )
    ):
        raise ImportFailure(409, "同一公司已导入过完全相同的文件")
    try:
        workbook_rows = parse_workbook(content)
    except WorkbookFormatError as exc:
        raise ImportFailure(400, str(exc)) from exc
    batch = ImportBatch(
        company_id=company_id,
        import_type="employee_master",
        original_filename=filename,
        file_sha256=digest,
        original_file=content,
        template_version=(
            TEMPLATE_VERSION if "证件号码" in workbook_rows[0].raw else LEGACY_TEMPLATE_VERSION
        ),
        field_mapping={
            field: get_column_letter(index) for index, field in enumerate(workbook_rows[0].raw, 1)
        },
        status="uploaded",
    )
    db.add(batch)
    db.flush()
    seen_ids: set[str] = set()
    seen_numbers: set[str] = set()
    successful = 0
    for source in workbook_rows:
        normalized, errors = _validate(
            db,
            company_id,
            source.number,
            source.raw,
            source.errors,
            imported_on=batch.uploaded_at.astimezone(ZoneInfo("Asia/Shanghai")).date(),
        )
        identity_field = "证件号码" if "证件号码" in source.raw else "身份证号"
        id_number = source.raw[identity_field].upper()
        employee_no = source.raw.get("员工编号")
        if id_number in seen_ids:
            errors.append(
                _issue("DUPLICATE_IN_FILE", identity_field, "同一文件中证件号码重复", source.number)
            )
        if employee_no and employee_no in seen_numbers:
            errors.append(
                _issue("DUPLICATE_IN_FILE", "员工编号", "同一文件中员工编号重复", source.number)
            )
        seen_ids.add(id_number)
        if employee_no:
            seen_numbers.add(employee_no)
        if errors:
            normalized = None
        row = ImportRow(
            import_batch_id=batch.id,
            sheet_name=SHEET_NAME,
            source_row_number=source.number,
            validation_status="invalid" if errors else "imported",
            raw_data=source.raw,
            errors=errors or None,
            normalized_data=None,
        )
        db.add(row)
        if normalized is not None and not errors:
            employee_id = _save_employee(db, normalized)
            row.normalized_data = {"employee_id": employee_id, "id_number": normalized["id_number"]}
            successful += 1
    batch.status = (
        "imported"
        if successful == len(workbook_rows)
        else ("partially_imported" if successful else "rejected")
    )
    db.commit()
    return get_batch(db, batch.id)


def correct_row(
    db: Session,
    batch_id: int,
    row_id: int,
    values: dict[str, str],
) -> dict[str, Any]:
    batch = db.get(ImportBatch, batch_id)
    row = db.scalar(
        select(ImportRow)
        .where(
            ImportRow.id == row_id,
            ImportRow.import_batch_id == batch_id,
        )
        .with_for_update()
    )
    if batch is None or batch.import_type != "employee_master" or row is None:
        raise ImportFailure(404, "导入行不存在")
    if row.validation_status != "invalid":
        raise ImportFailure(409, "该行已入库，不能重复写入")
    if not values or any(field not in batch.field_mapping for field in values):
        raise ImportFailure(400, "只能修正固定模板中的字段")
    corrected = {**row.raw_data, **(row.correction_values or {}), **values}
    corrected_fields = {
        field for entry in row.correction_history for field in entry["values"]
    } | set(values)
    workbook_errors = [
        error
        for error in row.errors or []
        if error["code"] in {"FORMULA_NOT_ALLOWED", "EXCEL_ERROR", "IDENTIFIER_NOT_TEXT"}
        and error["field"] not in corrected_fields
    ]
    normalized, errors = _validate(
        db,
        batch.company_id,
        row.source_row_number,
        corrected,
        workbook_errors,
        imported_on=batch.uploaded_at.astimezone(ZoneInfo("Asia/Shanghai")).date(),
    )
    row.correction_values = corrected
    row.correction_history = [
        *row.correction_history,
        {"values": values, "result": "invalid" if errors else "imported", "errors": errors},
    ]
    row.errors = errors or None
    if normalized is not None:
        employee_id = _save_employee(db, normalized)
        row.normalized_data = {"employee_id": employee_id, "id_number": normalized["id_number"]}
        row.validation_status = "imported"
    db.flush()
    remaining = db.scalar(
        select(ImportRow.id).where(
            ImportRow.import_batch_id == batch_id,
            ImportRow.validation_status == "invalid",
        )
    )
    batch.status = "partially_imported" if remaining else "imported"
    db.commit()
    return get_batch(db, batch_id)
