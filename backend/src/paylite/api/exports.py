from datetime import datetime
from typing import Any, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from paylite.api.deps import get_db
from paylite.excel import bank_export, labor_cost_export
from paylite.excel.payroll_export import TEMPLATE_PATH
from paylite.services import payroll_export

router = APIRouter(prefix="/exports", tags=["exports"])
ExportKind = Literal["payroll", "bank", "labor-cost"]
OUTPUT_TYPES = {"payroll": "payroll_sheet", "bank": "bank_payment", "labor-cost": "labor_cost"}
MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class ExportCreate(BaseModel):
    period_id: int = Field(gt=0)
    subject_id: int | None = Field(default=None, gt=0)
    request_id: UUID
    subject_templates: dict[str, str] = Field(default_factory=dict)


class ExportReport(BaseModel):
    id: int
    period_id: int
    status: str
    template_version: str
    parameters: dict[str, Any]
    created_at: datetime
    completed_at: datetime | None
    warnings: list[dict[str, Any]]


@router.get("/{kind}/preview")
def preview(
    kind: ExportKind,
    period_id: int = Query(gt=0),
    subject_id: int | None = Query(None, gt=0),
    db: Session = Depends(get_db),
):
    try:
        return payroll_export.preview_export(db, period_id, subject_id, OUTPUT_TYPES[kind])
    except payroll_export.PayrollExportError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.get("/{kind}/template")
def template(kind: ExportKind):
    return Response(
        {
            "payroll": TEMPLATE_PATH,
            "bank": bank_export.TEMPLATE_PATH,
            "labor-cost": labor_cost_export.TEMPLATE_PATH,
        }[kind].read_bytes(),
        media_type=MIME,
        headers={"Content-Disposition": f'attachment; filename="{kind}-template.xlsx"'},
    )


@router.get("/{kind}", response_model=list[ExportReport])
def history(kind: ExportKind, period_id: int = Query(gt=0), db: Session = Depends(get_db)):
    return payroll_export.list_exports(db, period_id, OUTPUT_TYPES[kind])


@router.post("/{kind}", response_model=ExportReport)
def create(kind: ExportKind, body: ExportCreate, db: Session = Depends(get_db)):
    try:
        return payroll_export.create_export(
            db,
            body.period_id,
            body.subject_id,
            str(body.request_id),
            output_type=OUTPUT_TYPES[kind],
            subject_templates=body.subject_templates,
        )
    except payroll_export.PayrollExportError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.get("/{kind}/{export_id}", response_model=ExportReport)
def report(kind: ExportKind, export_id: int, db: Session = Depends(get_db)):
    try:
        return payroll_export.export_report(db, export_id, OUTPUT_TYPES[kind])
    except payroll_export.PayrollExportError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.get("/{kind}/{export_id}/file")
def download(kind: ExportKind, export_id: int, db: Session = Depends(get_db)):
    try:
        content, filename = payroll_export.download_export(db, export_id, OUTPUT_TYPES[kind])
        return Response(
            content,
            media_type=MIME,
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
        )
    except payroll_export.PayrollExportError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
