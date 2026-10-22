"""Import monthly attendance facts with row-level correction and traceability."""

import calendar
import hashlib
import re
from decimal import Decimal, InvalidOperation
from typing import Any

from openpyxl.utils import get_column_letter
from sqlalchemy import select
from sqlalchemy.orm import Session

from paylite.db.models import (
    AttendanceRecord,
    Employee,
    ImportBatch,
    ImportRow,
    PayrollBatch,
    PayrollPeriod,
    Subject,
)
from paylite.excel.attendance_template import (
    SHEET_NAME,
    TEMPLATE_HEADERS,
    input_fields,
    parse_workbook,
    resolve_attendance_formulas,
)
from paylite.excel.employee_template import WorkbookFormatError
from paylite.services import monthly_import
from paylite.services.employee_import import ImportFailure

ID_PATTERN = re.compile(r"^\d{17}[\dX]$")


def _issue(
    code: str, field: str, message: str, row: int, *, headers: tuple[str, ...] | None = None
) -> dict[str, str]:
    if headers is None:
        headers = next(items for items in TEMPLATE_HEADERS.values() if field in items)
    column = get_column_letter(headers.index(field) + 1)
    return {
        "code": code,
        "field": field,
        "column": column,
        "cell": f"{column}{row}",
        "message": message,
    }


def _decimal(
    raw: str, field: str, row: int, errors: list[dict[str, str]], *, required: bool = False
) -> Decimal | None:
    if not raw and not required:
        return Decimal(0)
    try:
        value = Decimal(raw)
    except (InvalidOperation, ValueError):
        value = None
    if value is None or not value.is_finite() or value < 0 or value.as_tuple().exponent < -2:
        errors.append(_issue("INVALID_NUMBER", field, "须填写非负数，最多两位小数", row))
        return None
    return value


def _integer(raw: str, field: str, row: int, errors: list[dict[str, str]]) -> int | None:
    if not raw:
        return 0
    if not raw.isdecimal() or len(raw) > 7:
        errors.append(_issue("INVALID_NUMBER", field, "须填写非负整数", row))
        return None
    return int(raw)


def _validate(
    db: Session,
    period: PayrollPeriod,
    company_id: int,
    subject: Subject | None,
    scope_ids: set[int],
    ambiguous_ids: set[int],
    number: int,
    raw: dict[str, str],
    headers: tuple[str, ...],
) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    errors: list[dict[str, str]] = []
    reference = "公司" in raw
    fields = (
        {
            "应出勤天数": "工作日天数合计" if "工作日天数合计" in raw else "应出勤天数",
            "迟到分钟": "迟到时长" if "迟到时长" in raw else "迟到分钟",
            "早退分钟": "早退时长" if "早退时长" in raw else "早退分钟",
            "忘打卡次数": "缺卡次数" if "缺卡次数" in raw else "未补卡次数",
            "无薪请假天数": "事假天数",
            "有薪请假天数": "病假天数",
        }
        if reference
        else {}
    )
    values = dict(raw)
    if reference:
        for old, new in fields.items():
            values[old] = raw[new]
        for target, sources in (
            ("无薪请假天数", ("事假天数", "旷工天数")),
            (
                "有薪请假天数",
                (
                    "病假天数",
                    "年假天数",
                    "产假天数",
                    "产检假天数",
                    "陪产假天数",
                    "育儿假天数",
                    "婚假天数",
                    "丧假天数",
                    "其他福利假",
                    "调休天数",
                ),
            ),
        ):
            amounts = [_decimal(raw[field], field, number, errors) for field in sources]
            values[target] = str(sum((value for value in amounts if value is not None), Decimal(0)))
            fields[target] = next(
                (field for field in sources if raw[field] not in {"", "0"}), sources[0]
            )
        values["补卡次数"] = "0"
        values["来源说明"] = "考勤导入模版"
    identity = raw["身份证号"].upper()
    if reference and subject is not None and raw["公司"] != subject.name:
        errors.append(
            _issue("SUBJECT_MISMATCH", "公司", "公司须与员工本期间的归属主体一致", number)
        )
    employee = (
        db.scalar(
            select(Employee).where(
                Employee.company_id == company_id, Employee.id_number == identity
            )
        )
        if ID_PATTERN.fullmatch(identity)
        else None
    )
    if employee is None or employee.id not in scope_ids or employee.id in ambiguous_ids:
        errors.append(
            _issue(
                "EMPLOYEE_NOT_IN_SCOPE",
                "身份证号",
                "员工不在本公司本期间的确定名单中，或存在跨主体归属",
                number,
            )
        )
    if not raw["姓名"] or (employee and raw["姓名"] != employee.name):
        errors.append(_issue("NAME_MISMATCH", "姓名", "姓名必须与员工主档一致", number))
    days = _decimal(values["应出勤天数"], "应出勤天数", number, errors, required=True)
    late = _integer(values["迟到分钟"], "迟到分钟", number, errors)
    early = _integer(values["早退分钟"], "早退分钟", number, errors)
    paid = _decimal(values["有薪请假天数"], "有薪请假天数", number, errors)
    unpaid = _decimal(values["无薪请假天数"], "无薪请假天数", number, errors)
    missed = _integer(values["忘打卡次数"], "忘打卡次数", number, errors)
    corrected = _integer(values["补卡次数"], "补卡次数", number, errors)
    month_days = calendar.monthrange(period.year, period.month)[1]
    if days is not None and (days <= 0 or days > month_days):
        errors.append(
            _issue(
                "WORK_DAYS_OUT_OF_RANGE", "应出勤天数", "须大于 0 且不超过当月自然日天数", number
            )
        )
    if days is not None and days > 0:
        if late is not None and late > days * 480:
            errors.append(
                _issue(
                    "MINUTES_OUT_OF_RANGE", "迟到分钟", "不能超过应出勤天数乘每日 480 分钟", number
                )
            )
        if early is not None and early > days * 480:
            errors.append(
                _issue(
                    "MINUTES_OUT_OF_RANGE", "早退分钟", "不能超过应出勤天数乘每日 480 分钟", number
                )
            )
        if paid is not None and unpaid is not None and paid + unpaid > days:
            errors.append(
                _issue("LEAVE_OUT_OF_RANGE", "无薪请假天数", "请假总天数不能超过应出勤天数", number)
            )
    if days is not None and days > 0 and missed is not None and missed > days * 2:
        errors.append(
            _issue("PUNCH_OUT_OF_RANGE", "忘打卡次数", "不能超过应出勤天数的两倍", number)
        )
    if corrected is not None and missed is not None and corrected > missed:
        errors.append(
            _issue("PUNCH_OUT_OF_RANGE", "补卡次数", "补卡次数不能超过忘打卡次数", number)
        )
    if not values["来源说明"] or len(values["来源说明"]) > 500:
        errors.append(
            _issue("SOURCE_REQUIRED", "来源说明", "请填写不超过 500 字的来源说明", number)
        )
    if employee and db.scalar(
        select(AttendanceRecord.id).where(
            AttendanceRecord.payroll_period_id == period.id,
            AttendanceRecord.employee_id == employee.id,
        )
    ):
        errors.append(
            _issue("DUPLICATE_PERIOD", "身份证号", "本员工本期间已有考勤事实，不会覆盖", number)
        )
    if errors:
        return None, [
            _issue(
                error["code"],
                fields.get(error["field"], error["field"]),
                error["message"],
                number,
                headers=headers,
            )
            for error in errors
        ]
    assert employee and days is not None and late is not None and early is not None
    assert paid is not None and unpaid is not None and missed is not None and corrected is not None
    return {
        "employee_id": employee.id,
        "expected_work_days": days,
        "late_minutes": late,
        "early_leave_minutes": early,
        "paid_leave_days": paid,
        "unpaid_leave_days": unpaid,
        "leave_days": paid + unpaid,
        "leave_type": "mixed"
        if paid and unpaid
        else "paid"
        if paid
        else "unpaid"
        if unpaid
        else "none",
        "missed_punch_count": missed,
        "corrected_punch_count": corrected,
        "punch_corrected": bool(missed and corrected == missed),
        "exception_note": values["来源说明"],
    }, []


def _rows(db: Session, batch_id: int) -> list[ImportRow]:
    return monthly_import.rows(db, batch_id)


def get_batch(db: Session, batch_id: int, *, include_file: bool = False) -> dict[str, Any]:
    return monthly_import.get_batch(db, batch_id, "attendance", include_file=include_file)


def list_batches(db: Session, company_id: int) -> list[dict[str, Any]]:
    return monthly_import.list_batches(db, company_id, "attendance")


def _save(
    db: Session,
    batch: ImportBatch,
    period: PayrollPeriod,
    row: ImportRow,
    normalized: dict[str, Any],
    raw: dict[str, str],
) -> None:
    fact = AttendanceRecord(
        import_batch_id=batch.id, payroll_period_id=period.id, raw_values=raw, **normalized
    )
    db.add(fact)
    db.flush()
    row.normalized_data = {
        "attendance_record_id": fact.id,
        "employee_id": fact.employee_id,
        **{
            key: str(value) if isinstance(value, Decimal) else value
            for key, value in normalized.items()
            if key != "employee_id"
        },
    }
    row.validation_status = "imported"
    period.attendance_input_revision += 1


def upload_batch(
    db: Session, company_id: int, payroll_period_id: int, filename: str, content: bytes
) -> dict[str, Any]:
    scope = monthly_import.load_scope(db, company_id, payroll_period_id)
    period = scope.period
    digest = hashlib.sha256(content).hexdigest()
    previous = monthly_import.existing_file(db, company_id, period.id, "attendance", digest)
    if previous is not None:
        db.commit()
        return get_batch(db, previous.id)
    try:
        workbook_rows = parse_workbook(content)
    except WorkbookFormatError as exc:
        raise ImportFailure(400, str(exc)) from exc
    scope_ids = set(scope.scope_ids)
    ambiguous_ids = set(scope.ambiguous_ids)
    headers = tuple(workbook_rows[0].raw)
    batch = ImportBatch(
        company_id=company_id,
        payroll_period_id=period.id,
        import_type="attendance",
        original_filename=filename,
        file_sha256=digest,
        original_file=content,
        template_version=next(
            version for version, items in TEMPLATE_HEADERS.items() if items == headers
        ),
        field_mapping={field: get_column_letter(index + 1) for index, field in enumerate(headers)},
        status="uploaded",
    )
    db.add(batch)
    db.flush()
    seen: set[str] = set()
    successful = 0
    for source in workbook_rows:
        subject = scope.subject_for(source.raw["身份证号"])
        normalized, errors = _validate(
            db,
            period,
            company_id,
            subject,
            scope_ids,
            ambiguous_ids,
            source.number,
            source.raw,
            headers,
        )
        batch_error = scope.batch_error(subject)
        if batch_error:
            errors.insert(0, _issue("BATCH_NOT_EDITABLE", "身份证号", batch_error, source.number))
        errors = [*source.errors, *errors]
        identity = source.raw["身份证号"].upper()
        if identity in seen:
            errors.append(
                _issue("DUPLICATE_IN_FILE", "身份证号", "同一文件中身份证号重复", source.number)
            )
        seen.add(identity)
        row = ImportRow(
            import_batch_id=batch.id,
            subject_id=subject.id if subject else None,
            payroll_batch_id=scope.batches[subject.id].id
            if subject and subject.id in scope.batches
            else None,
            sheet_name=SHEET_NAME,
            source_row_number=source.number,
            validation_status="invalid" if errors else "imported",
            raw_data={**source.raw, **source.formulas},
            errors=errors or None,
        )
        db.add(row)
        if normalized is not None and not errors:
            assert subject is not None
            payroll_batch, created = scope.ensure_batch(db, subject)
            row.payroll_batch_id = payroll_batch.id
            _save(db, batch, period, row, normalized, row.raw_data)
            row.normalized_data = {**row.normalized_data, "batch_created": created}
            successful += 1
    batch.status = (
        "imported"
        if successful == len(workbook_rows)
        else "partially_imported"
        if successful
        else "rejected"
    )
    db.commit()
    return get_batch(db, batch.id)


def correct_row(db: Session, batch_id: int, row_id: int, values: dict[str, str]) -> dict[str, Any]:
    batch = db.get(ImportBatch, batch_id)
    if batch is None or batch.import_type != "attendance":
        raise ImportFailure(404, "考勤导入批次不存在")
    if batch.template_version == "TPL-WORKBOOK-v1":
        raise ImportFailure(409, "整本来源请在原整本任务中修正，以保留依赖和修正版本")
    scope = monthly_import.load_scope(db, batch.company_id, batch.payroll_period_id)
    period = scope.period
    legacy_batch = db.get(PayrollBatch, batch.payroll_batch_id) if batch.payroll_batch_id else None
    if legacy_batch and legacy_batch.status not in {"draft", "trial"}:
        raise ImportFailure(409, "已确认或锁定的历史工资批次不能修正考勤")
    row = db.scalar(
        select(ImportRow)
        .where(ImportRow.id == row_id, ImportRow.import_batch_id == batch_id)
        .with_for_update()
    )
    if row is None:
        raise ImportFailure(404, "导入行不存在")
    if row.validation_status != "invalid":
        raise ImportFailure(409, "该行已入库，重复修正不会再次入账")
    headers = TEMPLATE_HEADERS[batch.template_version]
    if not values or any(
        field not in row.raw_data or field not in input_fields(headers) for field in values
    ):
        raise ImportFailure(400, "只能修正考勤输入字段，薪资及扣款等原始数据只读")
    corrected = {**row.raw_data, **(row.correction_values or {}), **values}
    computed, formula_errors = resolve_attendance_formulas(
        corrected,
        row.source_row_number,
        headers,
    )
    subject = scope.subject_for(corrected["身份证号"])
    row.subject_id = subject.id if subject else None
    row.payroll_batch_id = (
        scope.batches[subject.id].id if subject and subject.id in scope.batches else None
    )
    normalized, errors = _validate(
        db,
        period,
        batch.company_id,
        subject,
        scope.scope_ids,
        scope.ambiguous_ids,
        row.source_row_number,
        computed,
        headers,
    )
    batch_error = scope.batch_error(subject)
    if batch_error:
        errors.insert(
            0, _issue("BATCH_NOT_EDITABLE", "身份证号", batch_error, row.source_row_number)
        )
    errors = [*formula_errors, *errors]
    for old_error in row.errors or []:
        if (
            old_error["code"] in {"IDENTIFIER_NOT_TEXT", "EXCEL_ERROR"}
            and old_error["field"] in input_fields(headers)
            and old_error["field"] not in (row.correction_values or {})
            and old_error["field"] not in values
        ):
            errors.append(old_error)
    for other in _rows(db, batch_id):
        if (
            other.id != row.id
            and {**other.raw_data, **(other.correction_values or {})}["身份证号"].upper()
            == corrected["身份证号"].upper()
        ):
            errors.append(
                _issue(
                    "DUPLICATE_IN_FILE", "身份证号", "同一文件中身份证号重复", row.source_row_number
                )
            )
            break
    row.correction_values = {**(row.correction_values or {}), **values}
    row.correction_history = [
        *row.correction_history,
        {
            "values": values,
            "result": "invalid" if errors else "imported",
            "errors": errors,
        },
    ]
    row.errors = errors or None
    if normalized is not None and not errors:
        assert subject is not None
        payroll_batch, created = scope.ensure_batch(db, subject)
        row.payroll_batch_id = payroll_batch.id
        _save(db, batch, period, row, normalized, corrected)
        row.normalized_data = {**row.normalized_data, "batch_created": created}
    row.correction_history = [
        *row.correction_history[:-1],
        {
            **row.correction_history[-1],
            "subject_id": row.subject_id,
            "payroll_batch_id": row.payroll_batch_id,
        },
    ]
    remaining = db.scalar(
        select(ImportRow.id).where(
            ImportRow.import_batch_id == batch_id, ImportRow.validation_status == "invalid"
        )
    )
    success = db.scalar(
        select(ImportRow.id).where(
            ImportRow.import_batch_id == batch_id, ImportRow.validation_status == "imported"
        )
    )
    batch.status = (
        "partially_imported" if remaining and success else "rejected" if remaining else "imported"
    )
    db.commit()
    return get_batch(db, batch_id)
