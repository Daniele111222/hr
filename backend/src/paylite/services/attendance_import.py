"""Import monthly attendance facts with row-level correction and traceability."""

import calendar
import hashlib
import re
from decimal import Decimal, InvalidOperation
from typing import Any

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
from paylite.excel.attendance_template import HEADERS, SHEET_NAME, TEMPLATE_VERSION, parse_workbook
from paylite.excel.employee_template import WorkbookFormatError
from paylite.services.employee_import import ImportFailure
from paylite.services.payroll_workbench import employee_scope

ID_PATTERN = re.compile(r"^\d{17}[\dX]$")


def _issue(code: str, field: str, message: str, row: int) -> dict[str, str]:
    column = chr(65 + HEADERS.index(field))
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
    batch: PayrollBatch,
    scope_ids: set[int],
    ambiguous_ids: set[int],
    number: int,
    raw: dict[str, str],
) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    errors: list[dict[str, str]] = []
    for field in HEADERS:
        if raw[field].startswith("="):
            errors.append(_issue("FORMULA_NOT_ALLOWED", field, "导入模板不接受公式", number))
    identity = raw["身份证号"].upper()
    subject = db.get(Subject, batch.subject_id)
    employee = (
        db.scalar(
            select(Employee).where(
                Employee.company_id == subject.company_id, Employee.id_number == identity
            )
        )
        if ID_PATTERN.fullmatch(identity)
        else None
    )
    if employee is None or employee.id not in scope_ids or employee.id in ambiguous_ids:
        errors.append(
            _issue("EMPLOYEE_NOT_IN_SCOPE", "身份证号", "员工不在本主体本期间的确定名单中", number)
        )
    if not raw["姓名"] or (employee and raw["姓名"] != employee.name):
        errors.append(_issue("NAME_MISMATCH", "姓名", "姓名必须与员工主档一致", number))
    days = _decimal(raw["应出勤天数"], "应出勤天数", number, errors, required=True)
    late = _integer(raw["迟到分钟"], "迟到分钟", number, errors)
    early = _integer(raw["早退分钟"], "早退分钟", number, errors)
    paid = _decimal(raw["有薪请假天数"], "有薪请假天数", number, errors)
    unpaid = _decimal(raw["无薪请假天数"], "无薪请假天数", number, errors)
    missed = _integer(raw["忘打卡次数"], "忘打卡次数", number, errors)
    corrected = _integer(raw["补卡次数"], "补卡次数", number, errors)
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
    if not raw["来源说明"] or len(raw["来源说明"]) > 500:
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
        return None, errors
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
        "exception_note": raw["来源说明"],
    }, []


def _rows(db: Session, batch_id: int) -> list[ImportRow]:
    return list(
        db.scalars(
            select(ImportRow)
            .where(ImportRow.import_batch_id == batch_id)
            .order_by(ImportRow.source_row_number)
        )
    )


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
        "payroll_period_id": batch.payroll_period_id,
        "payroll_batch_id": batch.payroll_batch_id,
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


def get_batch(db: Session, batch_id: int, *, include_file: bool = False) -> dict[str, Any]:
    batch = db.get(ImportBatch, batch_id)
    if batch is None or batch.import_type != "attendance":
        raise ImportFailure(404, "考勤导入批次不存在")
    payroll_batch = db.get(PayrollBatch, batch.payroll_batch_id)
    result = _serialize(batch, _rows(db, batch_id))
    result["subject_name"] = db.get(Subject, payroll_batch.subject_id).name
    if include_file:
        result["original_file"] = batch.original_file
    return result


def list_batches(db: Session, company_id: int) -> list[dict[str, Any]]:
    batches = db.scalars(
        select(ImportBatch)
        .where(ImportBatch.company_id == company_id, ImportBatch.import_type == "attendance")
        .order_by(ImportBatch.uploaded_at.desc(), ImportBatch.id.desc())
    )
    return [
        _serialize(batch, _rows(db, batch.id))
        | {
            "rows": None,
            "subject_name": db.get(
                Subject, db.get(PayrollBatch, batch.payroll_batch_id).subject_id
            ).name,
        }
        for batch in batches
    ]


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
    db: Session, payroll_batch_id: int, filename: str, content: bytes
) -> dict[str, Any]:
    payroll_batch = db.get(PayrollBatch, payroll_batch_id)
    if payroll_batch is None or payroll_batch.batch_type != "normal":
        raise ImportFailure(404, "正常工资批次不存在")
    period = db.get(PayrollPeriod, payroll_batch.payroll_period_id, with_for_update=True)
    if payroll_batch.status not in {"draft", "trial"}:
        raise ImportFailure(409, "已确认或锁定的工资批次不能导入考勤")
    digest = hashlib.sha256(content).hexdigest()
    company_id = db.get(Subject, payroll_batch.subject_id).company_id
    if db.scalar(
        select(ImportBatch.id).where(
            ImportBatch.company_id == company_id,
            ImportBatch.import_type == "attendance",
            ImportBatch.file_sha256 == digest,
        )
    ):
        raise ImportFailure(409, "本公司已导入过完全相同的考勤文件")
    try:
        workbook_rows = parse_workbook(content)
    except WorkbookFormatError as exc:
        raise ImportFailure(400, str(exc)) from exc
    scope = employee_scope(db, period, payroll_batch.subject_id)
    scope_ids = set(scope.employee_ids)
    ambiguous_ids = set(scope.ambiguous_employee_ids)
    batch = ImportBatch(
        company_id=company_id,
        payroll_period_id=period.id,
        payroll_batch_id=payroll_batch.id,
        import_type="attendance",
        original_filename=filename,
        file_sha256=digest,
        original_file=content,
        template_version=TEMPLATE_VERSION,
        field_mapping={field: chr(65 + index) for index, field in enumerate(HEADERS)},
        status="uploaded",
    )
    db.add(batch)
    db.flush()
    seen: set[str] = set()
    successful = 0
    for source in workbook_rows:
        normalized, errors = _validate(
            db,
            period,
            payroll_batch,
            scope_ids,
            ambiguous_ids,
            source.number,
            source.raw,
        )
        errors = [*source.errors, *errors]
        identity = source.raw["身份证号"].upper()
        if identity in seen:
            errors.append(
                _issue("DUPLICATE_IN_FILE", "身份证号", "同一文件中身份证号重复", source.number)
            )
        seen.add(identity)
        row = ImportRow(
            import_batch_id=batch.id,
            sheet_name=SHEET_NAME,
            source_row_number=source.number,
            validation_status="invalid" if errors else "imported",
            raw_data=source.raw,
            errors=errors or None,
        )
        db.add(row)
        if normalized is not None and not errors:
            _save(db, batch, period, row, normalized, source.raw)
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
    period = db.get(PayrollPeriod, batch.payroll_period_id, with_for_update=True)
    payroll_batch = db.get(PayrollBatch, batch.payroll_batch_id)
    if payroll_batch.status not in {"draft", "trial"}:
        raise ImportFailure(409, "已确认或锁定的工资批次不能修正考勤")
    row = db.scalar(
        select(ImportRow)
        .where(ImportRow.id == row_id, ImportRow.import_batch_id == batch_id)
        .with_for_update()
    )
    if row is None:
        raise ImportFailure(404, "导入行不存在")
    if row.validation_status != "invalid":
        raise ImportFailure(409, "该行已入库，重复修正不会再次入账")
    if not values or any(field not in HEADERS for field in values):
        raise ImportFailure(400, "只能修正固定模板中的字段")
    corrected = {**row.raw_data, **(row.correction_values or {}), **values}
    scope = employee_scope(db, period, payroll_batch.subject_id)
    normalized, errors = _validate(
        db,
        period,
        payroll_batch,
        set(scope.employee_ids),
        set(scope.ambiguous_employee_ids),
        row.source_row_number,
        corrected,
    )
    for old_error in row.errors or []:
        if (
            old_error["code"] in {"IDENTIFIER_NOT_TEXT", "EXCEL_ERROR"}
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
        _save(db, batch, period, row, normalized, corrected)
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
