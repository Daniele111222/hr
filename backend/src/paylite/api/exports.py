from datetime import datetime
from typing import Any
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from paylite.api.deps import get_db
from paylite.excel.payroll_export import TEMPLATE_PATH
from paylite.services import payroll_export

router = APIRouter(prefix="/exports", tags=["exports"])
MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class ExportCreate(BaseModel):
    period_id: int = Field(gt=0)
    subject_id: int | None = Field(default=None, gt=0)
    request_id: UUID


class ExportReport(BaseModel):
    id: int
    period_id: int
    status: str
    template_version: str
    parameters: dict[str, Any]
    created_at: datetime
    completed_at: datetime | None
    warnings: list[dict[str, Any]]


@router.get("/payroll/preview")
def preview(
    period_id: int = Query(gt=0),
    subject_id: int | None = Query(None, gt=0),
    db: Session = Depends(get_db),
):
    try:
        return payroll_export.preview_export(db, period_id, subject_id)
    except payroll_export.PayrollExportError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.get("/payroll/template")
def template():
    return Response(
        TEMPLATE_PATH.read_bytes(),
        media_type=MIME,
        headers={"Content-Disposition": 'attachment; filename="payroll-template.xlsx"'},
    )


@router.get("/payroll", response_model=list[ExportReport])
def history(period_id: int = Query(gt=0), db: Session = Depends(get_db)):
    return payroll_export.list_exports(db, period_id)


@router.post("/payroll", response_model=ExportReport)
def create(body: ExportCreate, db: Session = Depends(get_db)):
    try:
        return payroll_export.create_export(
            db, body.period_id, body.subject_id, str(body.request_id)
        )
    except payroll_export.PayrollExportError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.get("/payroll/{export_id}", response_model=ExportReport)
def report(export_id: int, db: Session = Depends(get_db)):
    try:
        return payroll_export.export_report(db, export_id)
    except payroll_export.PayrollExportError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@router.get("/payroll/{export_id}/file")
def download(export_id: int, db: Session = Depends(get_db)):
    try:
        content, filename = payroll_export.download_export(db, export_id)
        return Response(
            content,
            media_type=MIME,
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
        )
    except payroll_export.PayrollExportError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
