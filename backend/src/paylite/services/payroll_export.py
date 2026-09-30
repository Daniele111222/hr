"""Snapshot in a short transaction, render outside it, then recheck the version."""

from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from paylite.config import get_settings
from paylite.db.models import (
    ExportBatch,
    ExportWarning,
    PayrollBatch,
    PayrollPeriod,
    PayrollRecord,
    PayrollTrialRun,
    Subject,
)
from paylite.excel.payroll_export import (
    TAX_NOTICE,
    TEMPLATE_NOTICE,
    TEMPLATE_VERSION,
    render_payroll,
)
from paylite.services.payroll_ledger import get_ledger


class PayrollExportError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code, self.detail = status_code, detail
        super().__init__(detail)


def _scope(db: Session, period_id: int, subject_id: int | None, *, lock: bool = False):
    query = select(PayrollPeriod).where(PayrollPeriod.id == period_id)
    if lock:
        query = query.with_for_update()
    period = db.scalar(query.execution_options(populate_existing=True))
    if period is None:
        raise PayrollExportError(404, "工资期间不存在")
    subjects = list(db.scalars(select(Subject).order_by(Subject.id)))
    if subject_id is not None:
        subjects = [s for s in subjects if s.id == subject_id]
        if not subjects:
            raise PayrollExportError(404, "主体不存在")
    query = (
        select(PayrollBatch)
        .where(
            PayrollBatch.payroll_period_id == period_id,
            PayrollBatch.subject_id.in_([s.id for s in subjects]),
            PayrollBatch.status != "cancelled",
        )
        .order_by(PayrollBatch.subject_id, PayrollBatch.id)
    )
    if lock:
        query = query.with_for_update()
    all_batches = list(db.scalars(query.execution_options(populate_existing=True)))
    if lock:
        # A correction may have been inserted while waiting for its original batch lock.
        all_batches = list(db.scalars(query.execution_options(populate_existing=True)))
    # Superseded locked history is excluded; pending replacements still block the scope.
    batches = [b for b in all_batches if b.is_effective or b.status not in {"locked", "exported"}]
    blockers = []
    versions = []
    for batch in batches:
        if not batch.is_effective or batch.status not in {"locked", "exported"}:
            blockers.append(f"批次 #{batch.id} 尚未锁定为有效版本")
            continue
        trial = (
            db.get(PayrollTrialRun, batch.confirmed_trial_id) if batch.confirmed_trial_id else None
        )
        records = list(
            db.scalars(select(PayrollRecord).where(PayrollRecord.payroll_batch_id == batch.id))
        )
        if (
            trial is None
            or trial.payroll_batch_id != batch.id
            or trial.input_fingerprint != batch.confirmed_input_fingerprint
            or not trial.results
            or any(r.get("errors") for r in trial.results)
            or {r["employee_id"] for r in trial.results} != {r.employee_id for r in records}
            or any(r.calculation_status != "locked" for r in records)
            or (batch.batch_type == "normal" and not trial.includes_final_incentive)
        ):
            blockers.append(f"批次 #{batch.id} 缺少完整的已确认锁定快照或最终激励")
        versions.append(
            {
                "batch_id": batch.id,
                "trial_id": batch.confirmed_trial_id,
                "input_fingerprint": batch.confirmed_input_fingerprint,
                "batch_no": batch.batch_no,
                "batch_type": batch.batch_type,
                "record_ids": sorted(r.id for r in records),
            }
        )
    ledger = get_ledger(db, period_id, subject_id=subject_id)
    if not ledger["records"]:
        blockers.append("所选范围无工资记录，不能生成文件")
    empty = [s.name for s in subjects if s.id not in {b.subject_id for b in batches}]
    return ledger, versions, list(dict.fromkeys(blockers)), empty


def preview_export(db: Session, period_id: int, subject_id: int | None) -> dict[str, Any]:
    ledger, versions, blockers, empty = _scope(db, period_id, subject_id)
    return {
        "period": ledger["period"],
        "employee_count": ledger["employee_count"],
        "record_count": ledger["record_count"],
        "untaxed_amount": ledger["totals"]["untaxed_amount"],
        "template_version": TEMPLATE_VERSION,
        "can_export": not blockers,
        "blockers": blockers,
        "skipped_subjects": empty,
        "versions": versions,
    }


def export_report(db: Session, export_id: int) -> dict[str, Any]:
    export = db.get(ExportBatch, export_id)
    if export is None or export.output_type != "payroll_sheet":
        raise PayrollExportError(404, "工资表导出记录不存在")
    warnings = list(
        db.scalars(
            select(ExportWarning)
            .where(ExportWarning.export_batch_id == export_id)
            .order_by(ExportWarning.id)
        )
    )
    return {
        "id": export.id,
        "period_id": export.payroll_period_id,
        "status": export.status,
        "template_version": export.template_version,
        "parameters": export.parameters,
        "created_at": export.created_at,
        "completed_at": export.completed_at,
        "warnings": [
            {
                "code": w.code,
                "severity": w.severity,
                "message": w.message,
                "employee_id": w.employee_id,
                "field_name": w.field_name,
            }
            for w in warnings
        ],
    }


def list_exports(db: Session, period_id: int) -> list[dict[str, Any]]:
    ids = db.scalars(
        select(ExportBatch.id)
        .where(
            ExportBatch.payroll_period_id == period_id, ExportBatch.output_type == "payroll_sheet"
        )
        .order_by(ExportBatch.id.desc())
        .limit(100)
    ).all()
    return [export_report(db, id) for id in ids]


def _warning(
    db, export_id, code, message, *, severity="warning", employee_id=None, field_name=None
):
    db.add(
        ExportWarning(
            export_batch_id=export_id,
            code=code,
            severity=severity,
            message=message,
            employee_id=employee_id,
            field_name=field_name,
        )
    )


def create_export(
    db: Session, period_id: int, subject_id: int | None, request_id: str
) -> dict[str, Any]:
    ledger, versions, blockers, empty = _scope(db, period_id, subject_id, lock=True)
    existing = db.scalar(
        select(ExportBatch).where(
            ExportBatch.payroll_period_id == period_id,
            ExportBatch.output_type == "payroll_sheet",
            ExportBatch.parameters["request_id"].astext == request_id,
        )
    )
    if existing:
        if existing.parameters["subject_id"] != subject_id:
            raise PayrollExportError(409, "重试编号对应的导出范围不同")
        export_id = existing.id
        db.commit()
        return export_report(db, export_id)
    export = ExportBatch(
        payroll_period_id=period_id,
        output_type="payroll_sheet",
        template_version=TEMPLATE_VERSION,
        status="started",
        parameters={
            "request_id": request_id,
            "subject_id": subject_id,
            "period": ledger["period"],
            "versions": versions,
            "employee_count": ledger["employee_count"],
            "record_count": ledger["record_count"],
            "untaxed_amount": ledger["totals"]["untaxed_amount"],
            "skipped_subjects": empty,
        },
    )
    db.add(export)
    db.flush()
    export_id = export.id
    _warning(db, export_id, "TAX_UNKNOWN", TAX_NOTICE, field_name="tax")
    _warning(db, export_id, "TEMPLATE_ADAPTED", TEMPLATE_NOTICE)
    for name in empty:
        _warning(db, export_id, "EMPTY_SUBJECT", f"{name}无工资批次，已跳过")
    for row in ledger["records"]:
        if row["amounts"]["untaxed_amount"] == "0.00":
            _warning(db, export_id, "ZERO_AMOUNT", "零工资记录保留", employee_id=row["employee_id"])
        if not row["snapshot"].get("bank_account"):
            _warning(
                db,
                export_id,
                "BANK_MISSING",
                "工资表银行卡无来源，留空；本文件不是银行代发文件",
                employee_id=row["employee_id"],
                field_name="bank_account",
            )
    if blockers:
        export.status = "failed"
        export.completed_at = datetime.now(UTC)
        for blocker in blockers:
            _warning(db, export_id, "EXPORT_BLOCKED", blocker, severity="error")
        db.commit()
        return export_report(db, export_id)
    db.commit()
    path = Path(get_settings().export_directory) / f"payroll-{export_id}.xlsx"
    temporary = path.with_suffix(".tmp")
    try:
        content = render_payroll(ledger)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary.write_bytes(content)
        _, current_versions, current_blockers, _ = _scope(db, period_id, subject_id, lock=True)
        if current_blockers or versions != current_versions:
            raise PayrollExportError(409, "文件生成期间工资版本发生变化，请重新生成")
        export = db.get(ExportBatch, export_id)
        temporary.replace(path)
        export.output_path = str(path)
        export.parameters = {**export.parameters, "file_sha256": sha256(content).hexdigest()}
        export.status = "completed"
        export.completed_at = datetime.now(UTC)
        db.commit()
    except Exception as exc:
        db.rollback()
        temporary.unlink(missing_ok=True)
        path.unlink(missing_ok=True)
        export = db.get(ExportBatch, export_id)
        export.status = "failed"
        export.output_path = None
        export.completed_at = datetime.now(UTC)
        _warning(
            db,
            export_id,
            "GENERATION_FAILED",
            exc.detail
            if isinstance(exc, PayrollExportError)
            else f"文件生成失败（{type(exc).__name__}），请重新生成",
            severity="error",
        )
        db.commit()
    return export_report(db, export_id)


def download_export(db: Session, export_id: int) -> tuple[bytes, str]:
    report = export_report(db, export_id)
    if report["status"] != "completed":
        raise PayrollExportError(409, "文件尚未成功生成，不能下载；中断或失败后请重新生成")
    params = report["parameters"]
    _, versions, blockers, _ = _scope(db, report["period_id"], params["subject_id"], lock=True)
    if blockers or versions != params["versions"]:
        raise PayrollExportError(409, "工资有效版本已变化，旧导出报告保留；请重新生成文件")
    export = db.get(ExportBatch, export_id)
    try:
        content = Path(export.output_path).read_bytes()
    except (OSError, TypeError) as exc:
        raise PayrollExportError(409, "导出文件缺失，请重新生成") from exc
    if sha256(content).hexdigest() != params["file_sha256"]:
        raise PayrollExportError(409, "导出文件校验失败，请重新生成")
    db.commit()
    return content, f"工资表-{params['period']}-{export_id}-未扣个税.xlsx"
