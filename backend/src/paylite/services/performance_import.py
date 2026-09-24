"""Import monthly performance coefficients with row-level correction."""

import hashlib
import re
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from paylite.db.models import (
    Employee,
    ImportBatch,
    ImportRow,
    PayrollBatch,
    PayrollPeriod,
    PerformanceRecord,
    Subject,
)
from paylite.excel.employee_template import WorkbookFormatError
from paylite.excel.performance_template import HEADERS, SHEET_NAME, TEMPLATE_VERSION, parse_workbook
from paylite.services.employee_import import ImportFailure
from paylite.services.payroll_workbench import employee_scope, requires_performance

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


def _validate(
    db: Session,
    period: PayrollPeriod,
    company_id: int,
    scope_ids: set[int],
    ambiguous_ids: set[int],
    number: int,
    raw: dict[str, str],
) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    errors = [
        _issue("FORMULA_NOT_ALLOWED", field, "导入模板不接受公式", number)
        for field in HEADERS
        if raw[field].startswith("=")
    ]
    identity = raw["身份证号"].upper()
    employee = (
        db.scalar(
            select(Employee).where(
                Employee.company_id == company_id,
                Employee.id_number == identity,
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
    if employee and employee.id in scope_ids and not requires_performance(employee, period):
        errors.append(
            _issue("PROBATION_NO_PERFORMANCE", "绩效系数", "试用期不考核绩效，无需导入", number)
        )
    raw_coefficient = raw["绩效系数"].strip()
    coefficient = None
    if not raw_coefficient:
        errors.append(
            _issue("COEFFICIENT_REQUIRED", "绩效系数", "绩效系数缺失；0 须明确填写", number)
        )
    else:
        try:
            coefficient = Decimal(raw_coefficient)
        except (InvalidOperation, ValueError):
            pass
        if coefficient is None or not coefficient.is_finite() or coefficient < 0:
            errors.append(_issue("INVALID_COEFFICIENT", "绩效系数", "须填写非负有限数", number))
        elif coefficient.adjusted() + 1 > 131072 or -coefficient.as_tuple().exponent > 16383:
            errors.append(
                _issue(
                    "NUMERIC_OUT_OF_RANGE", "绩效系数", "超出 PostgreSQL NUMERIC 可存储范围", number
                )
            )
    if employee and db.scalar(
        select(PerformanceRecord.id).where(
            PerformanceRecord.payroll_period_id == period.id,
            PerformanceRecord.employee_id == employee.id,
        )
    ):
        errors.append(
            _issue("DUPLICATE_PERIOD", "身份证号", "本员工本期间已有绩效系数，不会覆盖", number)
        )
    if errors:
        return None, errors
    assert employee is not None and coefficient is not None
    return {"employee_id": employee.id, "coefficient": coefficient}, []


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
    if batch is None or batch.import_type != "performance":
        raise ImportFailure(404, "绩效导入批次不存在")
    payroll_batch = db.get(PayrollBatch, batch.payroll_batch_id)
    result = _serialize(batch, _rows(db, batch_id))
    result["subject_name"] = db.get(Subject, payroll_batch.subject_id).name
    if include_file:
        result["original_file"] = batch.original_file
    return result


def list_batches(db: Session, company_id: int) -> list[dict[str, Any]]:
    batches = db.scalars(
        select(ImportBatch)
        .where(ImportBatch.company_id == company_id, ImportBatch.import_type == "performance")
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
    fact = PerformanceRecord(
        import_batch_id=batch.id,
        payroll_period_id=period.id,
        employee_id=normalized["employee_id"],
        coefficient=normalized["coefficient"],
        source_value=raw["绩效系数"],
    )
    db.add(fact)
    db.flush()
    row.normalized_data = {
        "performance_record_id": fact.id,
        "employee_id": fact.employee_id,
        "coefficient": str(fact.coefficient),
    }
    row.validation_status = "imported"
    period.performance_input_revision += 1


def upload_batch(
    db: Session, payroll_batch_id: int, filename: str, content: bytes
) -> dict[str, Any]:
    payroll_batch = db.get(PayrollBatch, payroll_batch_id)
    if payroll_batch is None or payroll_batch.batch_type != "normal":
        raise ImportFailure(404, "正常工资批次不存在")
    period = db.get(PayrollPeriod, payroll_batch.payroll_period_id, with_for_update=True)
    if payroll_batch.status not in {"draft", "trial"}:
        raise ImportFailure(409, "已确认或锁定的工资批次不能导入绩效")
    company_id = db.get(Subject, payroll_batch.subject_id).company_id
    digest = hashlib.sha256(content).hexdigest()
    if db.scalar(
        select(ImportBatch.id).where(
            ImportBatch.company_id == company_id,
            ImportBatch.import_type == "performance",
            ImportBatch.file_sha256 == digest,
        )
    ):
        raise ImportFailure(409, "本公司已导入过完全相同的绩效文件")
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
        import_type="performance",
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
            db, period, company_id, scope_ids, ambiguous_ids, source.number, source.raw
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
    if batch is None or batch.import_type != "performance":
        raise ImportFailure(404, "绩效导入批次不存在")
    period = db.get(PayrollPeriod, batch.payroll_period_id, with_for_update=True)
    payroll_batch = db.get(PayrollBatch, batch.payroll_batch_id)
    if payroll_batch.status not in {"draft", "trial"}:
        raise ImportFailure(409, "已确认或锁定的工资批次不能修正绩效")
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
    trimmed = {field: value.strip() for field, value in values.items()}
    corrected = {
        **row.raw_data,
        **(row.correction_values or {}),
        **trimmed,
    }
    scope = employee_scope(db, period, payroll_batch.subject_id)
    normalized, errors = _validate(
        db,
        period,
        batch.company_id,
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
    row.correction_values = {**(row.correction_values or {}), **trimmed}
    row.correction_history = [
        *row.correction_history,
        {"values": trimmed, "result": "invalid" if errors else "imported", "errors": errors},
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
