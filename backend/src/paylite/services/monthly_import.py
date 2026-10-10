"""Resolve company-wide monthly inputs and retain each row's payroll destination."""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from paylite.db.models import (
    Company,
    Employee,
    EmployeeAssignment,
    ImportBatch,
    ImportRow,
    PayrollBatch,
    PayrollPeriod,
    Subject,
)
from paylite.services.employee_import import ImportFailure
from paylite.services.payroll_workbench import _active_assignment_query


@dataclass
class ImportScope:
    period: PayrollPeriod
    company_id: int
    subjects: dict[int, Subject]
    identities: dict[str, int]
    scope_ids: set[int]
    ambiguous_ids: set[int]
    batches: dict[int, PayrollBatch]
    has_confirmed_batches: bool

    def subject_for(self, identity: str) -> Subject | None:
        subject_id = self.identities.get(identity.upper())
        return self.subjects.get(subject_id)

    def batch_error(self, subject: Subject | None) -> str | None:
        if subject is None:
            return None
        batch = self.batches.get(subject.id)
        if batch is not None and (not batch.is_effective or batch.status not in {"draft", "trial"}):
            return "该主体本期批次已确认、锁定或不可编辑，请使用受控更正"
        if batch is None and self.has_confirmed_batches:
            return "本期已有确认工资，不能通过自动补建主体批次扩张期间范围"
        return None

    def ensure_batch(self, db: Session, subject: Subject) -> tuple[PayrollBatch, bool]:
        batch = self.batches.get(subject.id)
        if batch is not None:
            return batch, False
        batch = PayrollBatch(
            subject_id=subject.id,
            payroll_period_id=self.period.id,
            batch_type="normal",
            batch_no=1,
            status="draft",
            is_effective=True,
        )
        db.add(batch)
        db.flush()
        self.batches[subject.id] = batch
        return batch, True


def load_scope(db: Session, company_id: int, period_id: int) -> ImportScope:
    if db.get(Company, company_id) is None:
        raise ImportFailure(404, "目标公司不存在")
    # 与建批次、确认和锁定使用同一期间锁，考勤与绩效并发导入不会重复建批次。
    period = db.get(PayrollPeriod, period_id, with_for_update=True)
    if period is None:
        raise ImportFailure(404, "工资期间不存在")
    subjects = {
        subject.id: subject
        for subject in db.scalars(select(Subject).where(Subject.company_id == company_id))
    }
    assignments: dict[int, set[int]] = {}
    identities: dict[int, str] = {}
    for employee_id, identity, subject_id in db.execute(
        _active_assignment_query(period)
        .add_columns(Employee.id_number, EmployeeAssignment.subject_id)
        .where(Employee.company_id == company_id, EmployeeAssignment.subject_id.in_(subjects))
    ):
        assignments.setdefault(employee_id, set()).add(subject_id)
        identities[employee_id] = identity
    batches = list(
        db.scalars(
            select(PayrollBatch)
            .where(
                PayrollBatch.payroll_period_id == period.id,
                PayrollBatch.subject_id.in_(subjects),
                PayrollBatch.batch_type == "normal",
            )
            .order_by(
                PayrollBatch.is_effective.desc(),
                PayrollBatch.batch_no.desc(),
                PayrollBatch.id.desc(),
            )
        )
    )
    by_subject = {}
    for batch in batches:
        by_subject.setdefault(batch.subject_id, batch)
    return ImportScope(
        period,
        company_id,
        subjects,
        {
            identities[employee_id]: next(iter(destinations))
            for employee_id, destinations in assignments.items()
            if len(destinations) == 1
        },
        set(assignments),
        {employee_id for employee_id, destinations in assignments.items() if len(destinations) > 1},
        by_subject,
        any(batch.status in {"confirmed", "locked", "exported"} for batch in batches),
    )


def existing_file(
    db: Session, company_id: int, period_id: int, kind: str, digest: str
) -> ImportBatch | None:
    return db.scalar(
        select(ImportBatch).where(
            ImportBatch.company_id == company_id,
            ImportBatch.payroll_period_id == period_id,
            ImportBatch.import_type == kind,
            ImportBatch.file_sha256 == digest,
        )
    )


def rows(db: Session, batch_id: int) -> list[ImportRow]:
    return list(
        db.scalars(
            select(ImportRow)
            .where(ImportRow.import_batch_id == batch_id)
            .order_by(ImportRow.source_row_number)
        )
    )


def get_batch(
    db: Session, batch_id: int, kind: str, *, include_file: bool = False
) -> dict[str, Any]:
    batch = db.get(ImportBatch, batch_id)
    if batch is None or batch.import_type != kind:
        raise ImportFailure(404, "月度导入批次不存在")
    items = rows(db, batch.id)
    subject_names = dict(
        db.execute(
            select(Subject.id, Subject.name).where(
                Subject.id.in_({row.subject_id for row in items if row.subject_id is not None})
            )
        ).all()
    )
    summary: dict[int, dict[str, Any]] = {}
    serialized = []
    for row in items:
        if row.subject_id is not None:
            item = summary.setdefault(
                row.subject_id,
                {
                    "subject_id": row.subject_id,
                    "subject_name": subject_names[row.subject_id],
                    "payroll_batch_id": row.payroll_batch_id,
                    "success_rows": 0,
                    "error_rows": 0,
                    "batch_created": False,
                },
            )
            if row.payroll_batch_id is not None:
                item["payroll_batch_id"] = row.payroll_batch_id
            item["success_rows"] += row.validation_status == "imported"
            item["error_rows"] += row.validation_status == "invalid"
            item["batch_created"] |= bool((row.normalized_data or {}).get("batch_created"))
        serialized.append(
            {
                "id": row.id,
                "sheet_name": row.sheet_name,
                "source_row_number": row.source_row_number,
                "subject_id": row.subject_id,
                "payroll_batch_id": row.payroll_batch_id,
                "validation_status": row.validation_status,
                "raw_data": row.raw_data,
                "correction_values": row.correction_values,
                "normalized_data": row.normalized_data,
                "errors": row.errors,
                "correction_history": row.correction_history,
            }
        )
    legacy_subject = (
        db.get(PayrollBatch, batch.payroll_batch_id) if batch.payroll_batch_id else None
    )
    result = {
        "id": batch.id,
        "company_id": batch.company_id,
        "payroll_period_id": batch.payroll_period_id,
        "payroll_batch_id": batch.payroll_batch_id,
        "subject_name": db.get(Subject, legacy_subject.subject_id).name
        if legacy_subject and len(summary) <= 1
        else "全公司",
        "subjects": sorted(summary.values(), key=lambda item: item["subject_id"]),
        "import_type": kind,
        "original_filename": batch.original_filename,
        "file_sha256": batch.file_sha256,
        "template_version": batch.template_version,
        "field_mapping": batch.field_mapping,
        "status": batch.status,
        "uploaded_at": batch.uploaded_at,
        "total_rows": len(items),
        "success_rows": sum(row.validation_status == "imported" for row in items),
        "error_rows": sum(row.validation_status == "invalid" for row in items),
        "rows": serialized,
    }
    if include_file:
        result["original_file"] = batch.original_file
    return result


def list_batches(db: Session, company_id: int, kind: str) -> list[dict[str, Any]]:
    return [
        get_batch(db, batch_id, kind) | {"rows": None}
        for batch_id in db.scalars(
            select(ImportBatch.id)
            .where(ImportBatch.company_id == company_id, ImportBatch.import_type == kind)
            .order_by(ImportBatch.uploaded_at.desc(), ImportBatch.id.desc())
        )
    ]
