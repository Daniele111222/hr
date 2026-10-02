"""Snapshot in a short transaction, render outside it, then recheck the version."""

import json
from datetime import UTC, datetime
from decimal import Decimal
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
from paylite.excel import bank_export, labor_cost_export
from paylite.excel.payroll_export import (
    TAX_NOTICE,
    TEMPLATE_NOTICE,
    TEMPLATE_VERSION,
    render_payroll,
)
from paylite.services.payroll_ledger import get_ledger

TEMPLATES = {
    "payroll_sheet": (TEMPLATE_VERSION, TEMPLATE_NOTICE),
    "bank_payment": (bank_export.TEMPLATE_VERSION, bank_export.TEMPLATE_NOTICE),
    "labor_cost": (labor_cost_export.TEMPLATE_VERSION, labor_cost_export.TEMPLATE_NOTICE),
}


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


def bank_record_blockers(ledger: dict[str, Any]) -> list[str]:
    blockers = []
    for row in ledger["records"]:
        label = (
            f"{row['subject_name']} 员工 #{row['employee_id']} / 批次 #{row['payroll_batch_id']}"
        )
        if not (row["snapshot"].get("bank_account") or "").strip():
            blockers.append(f"{label} 缺少银行卡，整次代发导出已阻断")
        if Decimal(row["amounts"]["untaxed_amount"]) < 0:
            blockers.append(f"{label} 未扣个税金额为负，整次代发导出已阻断")
    return blockers


def prepare_bank_rows(ledger: dict[str, Any], subject_templates: dict[str, str] | None = None):
    blockers = bank_record_blockers(ledger)
    grouped = {}
    for record in sorted(
        ledger["records"], key=lambda r: (r["subject_id"], r["employee_id"], r["payroll_batch_id"])
    ):
        snapshot = record["snapshot"]
        key = (record["subject_id"], record["employee_id"])
        identity = {
            "name": snapshot["name"],
            "id_number": snapshot["id_number"],
            "bank_account": snapshot.get("bank_account"),
        }
        if key not in grouped:
            grouped[key] = {
                "subject_id": record["subject_id"],
                **identity,
                "amount": Decimal(0),
                "sources": [],
            }
        row = grouped[key]
        if any(row[k] != v for k, v in identity.items()):
            blockers.append(
                f"{record['subject_name']} 员工 #{record['employee_id']} "
                "的锁定账户或身份快照不一致，不能合并代发"
            )
        row["amount"] += Decimal(record["amounts"]["untaxed_amount"])
        source = "独立补发" if record["batch_type"] == "supplement" else "正常工资"
        source += f" #{record['payroll_batch_id']}（批次号 {record['batch_no']}）"
        if record["batch_type"] == "supplement":
            source += f"：{record['batch_name']}"
        if record.get("correction_of_batch_id"):
            source += f"；整批更正替代 #{record['correction_of_batch_id']}"
        source += f"；发放日期 {record.get('payment_date') or '未填写'}"
        row["sources"].append(source)
        if (
            subject_templates is not None
            and subject_templates.get(str(record["subject_id"])) not in bank_export.TEMPLATE_SHEETS
        ):
            blockers.append(f"{record['subject_name']} 未选择有效代发模板")
    names = {r["subject_id"]: r["subject_name"] for r in ledger["records"]}
    rows = []
    for row in grouped.values():
        row["amount"] = f"{row['amount']:.2f}"
        row["remark"] = (
            f"{names[row['subject_id']]}；{ledger['period']}；未扣个税金额，需线下人工扣税核对后用于实际发薪；"
            + "；".join(row.pop("sources"))
        )
        if len(row["remark"]) > 32767:
            blockers.append(
                f"主体 #{row['subject_id']} 的来源备注超过 Excel 单元格上限，不能截断导出"
            )
        rows.append(row)
    return rows, list(dict.fromkeys(blockers))


def _bank_fingerprint(rows):
    return sha256(json.dumps(rows, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def preview_export(
    db: Session, period_id: int, subject_id: int | None, output_type: str = "payroll_sheet"
) -> dict[str, Any]:
    ledger, versions, blockers, empty = _scope(db, period_id, subject_id)
    is_bank = output_type == "bank_payment"
    if is_bank:
        _, bank_blockers = prepare_bank_rows(ledger)
        blockers.extend(bank_blockers)
    return {
        "period": ledger["period"],
        "employee_count": ledger["employee_count"],
        "record_count": ledger["record_count"],
        "untaxed_amount": ledger["totals"]["untaxed_amount"],
        "employer_cost": ledger["totals"]["employer_cost"],
        "template_version": TEMPLATES[output_type][0],
        "can_export": not blockers,
        "blockers": blockers,
        "skipped_subjects": empty,
        "versions": versions,
        "subjects": [
            {"id": id, "name": name}
            for id, name in {r["subject_id"]: r["subject_name"] for r in ledger["records"]}.items()
        ],
        "template_sheets": list(bank_export.TEMPLATE_SHEETS) if is_bank else [],
    }


def export_report(
    db: Session, export_id: int, output_type: str = "payroll_sheet"
) -> dict[str, Any]:
    export = db.get(ExportBatch, export_id)
    if export is None or export.output_type != output_type:
        raise PayrollExportError(404, "导出记录不存在")
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


def list_exports(
    db: Session, period_id: int, output_type: str = "payroll_sheet"
) -> list[dict[str, Any]]:
    ids = db.scalars(
        select(ExportBatch.id)
        .where(ExportBatch.payroll_period_id == period_id, ExportBatch.output_type == output_type)
        .order_by(ExportBatch.id.desc())
        .limit(100)
    ).all()
    return [export_report(db, id, output_type) for id in ids]


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
    db: Session,
    period_id: int,
    subject_id: int | None,
    request_id: str,
    *,
    output_type: str = "payroll_sheet",
    subject_templates: dict[str, str] | None = None,
) -> dict[str, Any]:
    ledger, versions, blockers, empty = _scope(db, period_id, subject_id, lock=True)
    is_bank = output_type == "bank_payment"
    subject_templates = subject_templates or {}
    bank_rows = []
    if is_bank:
        bank_rows, bank_blockers = prepare_bank_rows(ledger, subject_templates)
        blockers.extend(bank_blockers)
    existing = db.scalar(
        select(ExportBatch).where(
            ExportBatch.payroll_period_id == period_id,
            ExportBatch.output_type == output_type,
            ExportBatch.parameters["request_id"].astext == request_id,
        )
    )
    if existing:
        if existing.parameters["subject_id"] != subject_id or (
            is_bank and existing.parameters.get("subject_templates") != subject_templates
        ):
            raise PayrollExportError(409, "重试编号对应的导出范围不同")
        export_id = existing.id
        db.commit()
        return export_report(db, export_id, output_type)
    export = ExportBatch(
        payroll_period_id=period_id,
        output_type=output_type,
        template_version=TEMPLATES[output_type][0],
        status="started",
        parameters={
            "request_id": request_id,
            "subject_id": subject_id,
            "period": ledger["period"],
            "versions": versions,
            "employee_count": ledger["employee_count"],
            "record_count": ledger["record_count"],
            "untaxed_amount": ledger["totals"]["untaxed_amount"],
            "employer_cost": ledger["totals"]["employer_cost"],
            "skipped_subjects": empty,
            **(
                {
                    "subject_templates": subject_templates,
                    "payment_count": len(bank_rows),
                    "bank_fingerprint": _bank_fingerprint(bank_rows),
                }
                if is_bank
                else {}
            ),
        },
    )
    db.add(export)
    db.flush()
    export_id = export.id
    _warning(db, export_id, "TAX_UNKNOWN", TAX_NOTICE, field_name="tax")
    _warning(
        db,
        export_id,
        "TEMPLATE_ADAPTED",
        TEMPLATES[output_type][1],
    )
    for name in empty:
        _warning(db, export_id, "EMPTY_SUBJECT", f"{name}无工资批次，已跳过")
    for row in ledger["records"]:
        if output_type == "labor_cost":
            unmapped = [
                item["code"]
                for item in row["items"]
                if item["code"].startswith(("social_employee_", "social_company_"))
                and item["code"] not in labor_cost_export.SOCIAL_COLUMNS.values()
            ]
            if unmapped:
                _warning(
                    db,
                    export_id,
                    "SOCIAL_ITEM_UNMAPPED",
                    "险种代码无法映射模板分项："
                    + "、".join(unmapped)
                    + "；金额已计入个人/公司社保合计，不猜测险种归属。",
                    employee_id=row["employee_id"],
                    field_name="social_items",
                )
        if row["amounts"]["untaxed_amount"] == "0.00":
            _warning(db, export_id, "ZERO_AMOUNT", "零工资记录保留", employee_id=row["employee_id"])
        if output_type == "payroll_sheet" and not row["snapshot"].get("bank_account"):
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
        return export_report(db, export_id, output_type)
    db.commit()
    path = Path(get_settings().export_directory) / f"{output_type}-{export_id}.xlsx"
    temporary = path.with_suffix(".tmp")
    try:
        if is_bank:
            content = bank_export.render_bank(bank_rows, subject_templates)
        elif output_type == "labor_cost":
            content = labor_cost_export.render_labor_cost(ledger)
        else:
            content = render_payroll(ledger)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary.write_bytes(content)
        current_ledger, current_versions, current_blockers, _ = _scope(
            db, period_id, subject_id, lock=True
        )
        if is_bank:
            current_rows, bank_blockers = prepare_bank_rows(current_ledger, subject_templates)
            if bank_blockers or current_rows != bank_rows:
                current_blockers.append("代发快照发生变化")
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
        for failed_path in (temporary, path):
            try:
                failed_path.unlink(missing_ok=True)
            except OSError:
                pass  # The failed report must survive an unavailable output directory.
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
    return export_report(db, export_id, output_type)


def download_export(
    db: Session, export_id: int, output_type: str = "payroll_sheet"
) -> tuple[bytes, str]:
    report = export_report(db, export_id, output_type)
    if report["status"] != "completed":
        raise PayrollExportError(409, "文件尚未成功生成，不能下载；中断或失败后请重新生成")
    params = report["parameters"]
    ledger, versions, blockers, _ = _scope(db, report["period_id"], params["subject_id"], lock=True)
    if output_type == "bank_payment":
        rows, bank_blockers = prepare_bank_rows(ledger, params["subject_templates"])
        if bank_blockers or _bank_fingerprint(rows) != params["bank_fingerprint"]:
            blockers.append("代发快照发生变化")
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
    label = {"bank_payment": "代发工资表", "labor_cost": "人工成本表", "payroll_sheet": "工资表"}[
        output_type
    ]
    return content, f"{label}-{params['period']}-{export_id}-未扣个税.xlsx"
