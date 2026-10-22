"""Original workbook upload: one transaction, employee inputs before attendance facts."""

import hashlib
from collections import Counter
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, defer

from paylite.db.models import (
    Company,
    Employee,
    ImportBatch,
    ImportRow,
    PayrollPeriod,
    WorkbookImport,
)
from paylite.excel import engine
from paylite.excel.attendance_template import HEADERS as ATTENDANCE_HEADERS
from paylite.excel.employee_template import WorkbookFormatError, WorkbookRow
from paylite.excel.workbook_import import (
    ATTENDANCE_SHEET,
    EMPLOYEE_INPUTS,
    EMPLOYEE_SHEET,
    TEMPLATE_VERSION,
    changed_dependencies,
    parse_workbook,
    prepare_evaluation,
    read_evaluated,
)
from paylite.services import attendance_import, employee_import, monthly_import
from paylite.services.employee_import import ImportFailure


def _positions(errors, sheet: str, mapping: dict[str, str], number: int):
    result = []
    for error in errors:
        field = error["field"]
        column = mapping[field]
        item = {**error, "sheet_name": sheet, "column": column, "cell": f"{column}{number}"}
        if item not in result:
            result.append(item)
    return result


def get_task(db: Session, task_id: int, *, include_file: bool = False) -> dict[str, Any]:
    task = db.scalar(
        select(WorkbookImport)
        .where(WorkbookImport.id == task_id)
        .options(defer(WorkbookImport.original_file))
    )
    if task is None:
        raise ImportFailure(404, "整本导入任务不存在")
    period = db.get(PayrollPeriod, task.payroll_period_id)
    employee_batch = db.get(ImportBatch, task.employee_import_id)
    employee = employee_import._serialize(
        employee_batch, monthly_import.rows(db, employee_batch.id)
    )
    attendance = monthly_import.get_batch(db, task.attendance_import_id, "attendance")
    total_success = employee["success_rows"] + attendance["success_rows"]
    total_errors = employee["error_rows"] + attendance["error_rows"]
    result = {
        "id": task.id,
        "company_id": task.company_id,
        "payroll_period_id": task.payroll_period_id,
        "period": f"{period.year:04d}-{period.month:02d}",
        "original_filename": task.original_filename,
        "file_sha256": task.file_sha256,
        "template_version": TEMPLATE_VERSION,
        "status": "partially_imported"
        if total_success and total_errors
        else "rejected"
        if total_errors
        else "imported",
        "revision": task.revision,
        "uploaded_at": task.uploaded_at,
        "evaluation": task.evaluation,
        "employee_import": employee,
        "attendance_import": attendance,
    }
    if include_file:
        result["original_file"] = task.original_file
    return result


def list_tasks(db: Session, company_id: int) -> list[dict[str, Any]]:
    tasks = []
    for task_id in db.scalars(
        select(WorkbookImport.id)
        .where(WorkbookImport.company_id == company_id)
        .order_by(WorkbookImport.uploaded_at.desc(), WorkbookImport.id.desc())
    ):
        item = get_task(db, task_id)
        for kind in ("employee_import", "attendance_import"):
            item[kind]["rows"] = None
        tasks.append(item)
    return tasks


def _save_employee_row(
    db: Session,
    batch: ImportBatch,
    source: WorkbookRow,
    mapping: dict[str, str],
    period_start: date,
    seen: set[str],
    row: ImportRow | None = None,
) -> ImportRow:
    identity = employee_import._identity(source.raw)
    legal_identity = bool(employee_import.ID_PATTERN.fullmatch(identity))
    duplicate = legal_identity and (
        identity in seen or employee_import._existing_identity(db, batch.company_id, identity)
    )
    if legal_identity:
        seen.add(identity)
    if row is None:
        row = ImportRow(
            import_batch_id=batch.id,
            sheet_name=EMPLOYEE_SHEET,
            source_row_number=source.number,
            raw_data={**source.raw, **source.formulas},
        )
        db.add(row)
    row.validation_status = "skipped" if duplicate else "invalid"
    row.errors = None
    row.normalized_data = {"evaluated_values": source.raw}
    if duplicate:
        return row
    try:
        effective = max(period_start, date.fromisoformat(source.raw["入职时间"]))
    except ValueError:
        effective = period_start  # The shared validator reports the invalid hire date.
    transaction = db.begin_nested()
    normalized, errors = employee_import._validate(
        db,
        batch.company_id,
        source.number,
        source.raw,
        source.errors,
        imported_on=effective,
    )
    if errors:
        transaction.rollback()
        row.errors = _positions(errors, EMPLOYEE_SHEET, mapping, source.number)
    else:
        employee_id = employee_import._save_employee(db, normalized)
        transaction.commit()
        row.validation_status = "imported"
        row.normalized_data = {
            **row.normalized_data,
            "employee_id": employee_id,
            "id_number": identity,
            "effective_from": effective.isoformat(),
        }
    return row


def _save_attendance_row(
    db: Session,
    batch: ImportBatch,
    source: WorkbookRow,
    mapping: dict[str, str],
    scope: monthly_import.ImportScope,
    seen: set[str],
    ambiguous_source_ids: set[str],
    row: ImportRow | None = None,
) -> ImportRow:
    identity = source.raw["身份证号"].upper()
    subject = scope.subject_for(identity)
    normalized, errors = attendance_import._validate(
        db,
        scope.period,
        batch.company_id,
        subject,
        scope.scope_ids,
        scope.ambiguous_ids,
        source.number,
        source.raw,
        ATTENDANCE_HEADERS,
    )
    if identity in ambiguous_source_ids:
        errors.append(
            {
                "code": "DEPENDENCY_NOT_UNIQUE",
                "field": "身份证号",
                "message": "来源花名册的身份查找匹配不唯一，请核对完整证件号码；考勤尚未保存",
            }
        )
    employee_id = db.scalar(
        select(Employee.id).where(
            Employee.company_id == batch.company_id,
            Employee.id_number == identity,
        )
    )
    if employee_id is None or employee_id not in scope.scope_ids:
        for issue in errors:
            if issue["code"] == "EMPLOYEE_NOT_IN_SCOPE":
                issue.update(
                    code="DEPENDENCY_NOT_READY", message="花名册员工或本期任职未就绪，考勤尚未保存"
                )
    batch_error = scope.batch_error(subject)
    if batch_error:
        errors.append({"code": "BATCH_NOT_EDITABLE", "field": "身份证号", "message": batch_error})
    if identity in seen:
        errors.append(
            {"code": "DUPLICATE_IN_FILE", "field": "身份证号", "message": "同一文件中身份证号重复"}
        )
    seen.add(identity)
    errors = _positions([*source.errors, *errors], ATTENDANCE_SHEET, mapping, source.number)
    if row is None:
        row = ImportRow(
            import_batch_id=batch.id,
            sheet_name=ATTENDANCE_SHEET,
            source_row_number=source.number,
            raw_data={**source.raw, **source.formulas},
        )
        db.add(row)
    row.validation_status = "invalid" if errors else "imported"
    row.errors = errors or None
    row.subject_id = subject.id if subject else None
    row.payroll_batch_id = (
        scope.batches[subject.id].id if subject and subject.id in scope.batches else None
    )
    row.normalized_data = {"evaluated_values": source.raw}
    if normalized is not None and not errors:
        payroll_batch, created = scope.ensure_batch(db, subject)
        row.payroll_batch_id = payroll_batch.id
        attendance_import._save(
            db,
            batch,
            scope.period,
            row,
            normalized,
            {**row.raw_data, **(row.correction_values or {})},
        )
        row.normalized_data = {
            **row.normalized_data,
            "evaluated_values": source.raw,
            "batch_created": created,
        }
    return row


def upload_task(
    db: Session, company_id: int, period_id: int, filename: str, content: bytes
) -> dict[str, Any]:
    if db.get(Company, company_id) is None:
        raise ImportFailure(404, "目标公司不存在")
    period = db.get(PayrollPeriod, period_id)
    if period is None:
        raise ImportFailure(404, "工资期间不存在")
    digest = hashlib.sha256(content).hexdigest()
    previous_query = select(WorkbookImport.id).where(
        WorkbookImport.company_id == company_id,
        WorkbookImport.payroll_period_id == period_id,
        WorkbookImport.file_sha256 == digest,
    )
    previous = db.scalar(previous_query)
    if previous is not None:
        db.commit()
        return get_task(db, previous)
    period_start = period.period_start
    db.rollback()
    try:
        parsed = parse_workbook(content, period_start)
        plan = prepare_evaluation(parsed)
    except WorkbookFormatError as exc:
        raise ImportFailure(400, str(exc)) from exc
    try:
        result = engine.recalculate(plan.content)
        employees, attendance = read_evaluated(parsed, plan, result.content)
    except (engine.EngineFailure, WorkbookFormatError) as exc:
        raise ImportFailure(503, str(exc)) from exc
    # Recheck idempotency after evaluation; concurrent uploads can finish the same task.
    if db.scalar(select(Company.id).where(Company.id == company_id).with_for_update()) is None:
        raise ImportFailure(404, "目标公司不存在")
    period = db.get(PayrollPeriod, period_id, with_for_update=True, populate_existing=True)
    if period is None:
        raise ImportFailure(404, "工资期间不存在")
    if period.period_start != parsed.period:
        raise ImportFailure(409, "工资期间已变化，请核对来源月份后重新上传")
    previous = db.scalar(previous_query)
    if previous is not None:
        db.commit()
        return get_task(db, previous)
    batches = []
    for kind, mapping in (
        ("workbook_employee", parsed.employee_mapping),
        ("attendance", parsed.attendance_mapping),
    ):
        batch = ImportBatch(
            company_id=company_id,
            payroll_period_id=period_id,
            import_type=kind,
            original_filename=filename,
            file_sha256=digest,
            template_version=TEMPLATE_VERSION,
            field_mapping=mapping,
            status="uploaded",
        )
        db.add(batch)
        db.flush()
        batches.append(batch)
    task = WorkbookImport(
        company_id=company_id,
        payroll_period_id=period_id,
        employee_import_id=batches[0].id,
        attendance_import_id=batches[1].id,
        original_filename=filename,
        file_sha256=digest,
        original_file=content,
        evaluation={
            "engine_version": result.version,
            "revision": 1,
            "input_sha256": hashlib.sha256(plan.content).hexdigest(),
            "output_sha256": hashlib.sha256(result.content).hexdigest(),
            "dependencies": plan.dependencies,
            "dependency_graph": plan.dependency_graph,
        },
    )
    db.add(task)
    db.flush()
    seen = set()
    for source in employees:
        _save_employee_row(
            db, batches[0], source, parsed.employee_mapping, period.period_start, seen
        )
    employee_import._set_batch_status(db, batches[0])
    scope = monthly_import.load_scope(db, company_id, period_id)
    seen = set()
    source_counts = Counter(
        employee_import._identity(source.raw)[:18]
        for source in employees
        if employee_import.ID_PATTERN.fullmatch(employee_import._identity(source.raw)[:18])
    )
    ambiguous = {identity for identity, count in source_counts.items() if count > 1}
    for source in attendance:
        uses_lookup = any(
            root.startswith(f"{ATTENDANCE_SHEET}!") and root.endswith(f"!{source.number}")
            for root in plan.lookup_roots
        )
        _save_attendance_row(
            db,
            batches[1],
            source,
            parsed.attendance_mapping,
            scope,
            seen,
            ambiguous if uses_lookup else set(),
        )
    employee_import._set_batch_status(db, batches[1])
    db.commit()
    return get_task(db, task.id)


def correct_task_row(
    db: Session, task_id: int, row_id: int, values: dict[str, str], expected_revision: int
) -> dict[str, Any]:
    task = db.get(WorkbookImport, task_id)
    if task is None:
        raise ImportFailure(404, "整本导入任务不存在")
    row = db.get(ImportRow, row_id)
    if row is None or row.import_batch_id not in {
        task.employee_import_id,
        task.attendance_import_id,
    }:
        raise ImportFailure(404, "整本导入行不存在")
    if row.validation_status != "invalid":
        raise ImportFailure(409, "该行已处理，不能重复修正或覆盖")
    if task.revision != expected_revision:
        raise ImportFailure(409, "整本任务已有新修正，请刷新结果后重试")
    fields = EMPLOYEE_INPUTS if row.sheet_name == EMPLOYEE_SHEET else set(ATTENDANCE_HEADERS)
    if not values or any(field not in fields or field not in row.raw_data for field in values):
        raise ImportFailure(400, "只能修正有效输入，薪资结果、绩效及辅助来源列只读")
    company_id, period_id = task.company_id, task.payroll_period_id
    period_start = db.get(PayrollPeriod, period_id).period_start
    rows = [
        *monthly_import.rows(db, task.employee_import_id),
        *monthly_import.rows(db, task.attendance_import_id),
    ]
    corrections = {
        (item.sheet_name, item.source_row_number): dict(item.correction_values)
        for item in rows
        if item.correction_values
    }
    target = (row.sheet_name, row.source_row_number)
    corrections[target] = {**corrections.get(target, {}), **values}
    before_values = dict((row.normalized_data or {}).get("evaluated_values", row.raw_data))
    original_identity = (row.normalized_data or {}).get("evaluated_values", {}).get("证件号码")
    content = task.original_file
    db.rollback()
    try:
        parsed = parse_workbook(content, period_start, corrections)
        plan = prepare_evaluation(parsed)
        evaluated = engine.recalculate(plan.content)
        employees, attendance = read_evaluated(parsed, plan, evaluated.content)
    except (engine.EngineFailure, WorkbookFormatError) as exc:
        raise ImportFailure(503, str(exc)) from exc
    db.scalar(select(Company.id).where(Company.id == company_id).with_for_update())
    period = db.get(PayrollPeriod, period_id, with_for_update=True, populate_existing=True)
    task = db.scalar(
        select(WorkbookImport)
        .where(WorkbookImport.id == task_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if task.revision != expected_revision or period.period_start != parsed.period:
        raise ImportFailure(409, "任务或工资期间已变化，请刷新结果后重试")
    row = db.get(ImportRow, row_id, populate_existing=True)
    if row.validation_status != "invalid":
        raise ImportFailure(409, "该行已处理，不能重复修正或覆盖")
    employee_batch = db.get(ImportBatch, task.employee_import_id)
    attendance_batch = db.get(ImportBatch, task.attendance_import_id)
    revision = task.revision + 1
    row.correction_values = corrections[target]
    modified = {
        f"{target[0]}!{db.get(ImportBatch, row.import_batch_id).field_mapping[field]}{target[1]}"
        for field in values
    }
    identities = {original_identity}
    if target[0] == EMPLOYEE_SHEET:
        seen = set()
        for source in employees:
            identity = employee_import._identity(source.raw)
            if source.number == target[1]:
                identities.add(identity)
                _save_employee_row(
                    db,
                    employee_batch,
                    source,
                    parsed.employee_mapping,
                    period.period_start,
                    seen,
                    row,
                )
                break
            if employee_import.ID_PATTERN.fullmatch(identity):
                seen.add(identity)
    scope = monthly_import.load_scope(db, company_id, period_id)
    source_counts = Counter(
        employee_import._identity(source.raw)[:18]
        for source in employees
        if employee_import.ID_PATTERN.fullmatch(employee_import._identity(source.raw)[:18])
    )
    ambiguous = {identity for identity, count in source_counts.items() if count > 1}
    attendance_rows = {
        item.source_row_number: item for item in monthly_import.rows(db, attendance_batch.id)
    }
    for source in attendance:
        item = attendance_rows[source.number]
        if item.validation_status != "invalid":
            continue
        roots = [f"{ATTENDANCE_SHEET}!{field}!{source.number}" for field in ATTENDANCE_HEADERS]
        retry = item.id == row_id or (
            target[0] == EMPLOYEE_SHEET
            and (
                source.raw["身份证号"].upper() in identities
                or changed_dependencies(plan, roots, modified)
            )
        )
        if not retry:
            continue
        seen = {
            other.raw["身份证号"].upper() for other in attendance if other.number != source.number
        }
        previous_values = dict((item.normalized_data or {}).get("evaluated_values", item.raw_data))
        _save_attendance_row(
            db,
            attendance_batch,
            source,
            parsed.attendance_mapping,
            scope,
            seen,
            ambiguous if set(roots) & plan.lookup_roots else set(),
            item,
        )
        if item.id != row_id:
            item.correction_history = [
                *item.correction_history,
                {
                    "revision": revision,
                    "source_row_id": row_id,
                    "before_values": previous_values,
                    "evaluated_values": item.normalized_data["evaluated_values"],
                    "result": item.validation_status,
                    "errors": item.errors,
                    "subject_id": item.subject_id,
                    "payroll_batch_id": item.payroll_batch_id,
                },
            ]
    row.correction_history = [
        *row.correction_history,
        {
            "revision": revision,
            "values": values,
            "before_values": before_values,
            "evaluated_values": row.normalized_data["evaluated_values"],
            "result": row.validation_status,
            "errors": row.errors,
            "subject_id": row.subject_id,
            "payroll_batch_id": row.payroll_batch_id,
        },
    ]
    for batch in (employee_batch, attendance_batch):
        employee_import._set_batch_status(db, batch)
    task.revision = revision
    task.evaluation = {
        "engine_version": evaluated.version,
        "revision": revision,
        "input_sha256": hashlib.sha256(plan.content).hexdigest(),
        "output_sha256": hashlib.sha256(evaluated.content).hexdigest(),
        "dependencies": plan.dependencies,
        "dependency_graph": plan.dependency_graph,
    }
    db.commit()
    return get_task(db, task.id)
