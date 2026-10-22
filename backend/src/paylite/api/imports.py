from datetime import datetime
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from paylite.api.deps import get_db
from paylite.excel.attendance_template import (
    make_template as make_attendance_template,
)
from paylite.excel.employee_template import MAX_FILE_SIZE, TEMPLATE_VERSION, make_template
from paylite.excel.performance_template import (
    TEMPLATE_VERSION as PERFORMANCE_TEMPLATE_VERSION,
)
from paylite.excel.performance_template import make_template as make_performance_template
from paylite.services import attendance_import, performance_import, workbook_import
from paylite.services.employee_import import (
    ImportFailure,
    correct_row,
    get_batch,
    list_batches,
    upload_batch,
)

router = APIRouter(prefix="/imports", tags=["imports"])


class ImportIssueOut(BaseModel):
    code: str
    field: str
    message: str
    column: str | None = None
    cell: str | None = None
    sheet_name: str | None = None


class ImportRowOut(BaseModel):
    id: int
    sheet_name: str
    source_row_number: int
    validation_status: str
    raw_data: dict[str, str]
    correction_values: dict[str, str] | None
    normalized_data: dict[str, Any] | None
    errors: list[ImportIssueOut] | None
    correction_history: list[dict[str, Any]]
    subject_id: int | None = None
    payroll_batch_id: int | None = None


class ImportBatchOut(BaseModel):
    id: int
    company_id: int
    import_type: str
    original_filename: str
    file_sha256: str
    template_version: str
    field_mapping: dict[str, str]
    status: str
    uploaded_at: datetime
    total_rows: int
    success_rows: int
    error_rows: int
    rows: list[ImportRowOut] | None


class SubjectImportOut(BaseModel):
    subject_id: int
    subject_name: str
    payroll_batch_id: int | None
    success_rows: int
    error_rows: int
    batch_created: bool


class MonthlyImportBatchOut(ImportBatchOut):
    payroll_period_id: int
    payroll_batch_id: int | None
    subject_name: str
    subjects: list[SubjectImportOut] = Field(default_factory=list)


class WorkbookImportOut(BaseModel):
    id: int
    company_id: int
    payroll_period_id: int
    period: str
    original_filename: str
    file_sha256: str
    template_version: str
    status: str
    revision: int
    uploaded_at: datetime
    evaluation: dict[str, Any]
    employee_import: ImportBatchOut
    attendance_import: MonthlyImportBatchOut


class RowCorrection(BaseModel):
    values: dict[str, str] = Field(min_length=1)


class WorkbookRowCorrection(RowCorrection):
    expected_revision: int = Field(gt=0)


@router.post("/workbook", status_code=201, response_model=WorkbookImportOut)
async def upload_workbook(
    company_id: int = Query(..., gt=0),
    payroll_period_id: int = Query(..., gt=0),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "整本导入仅支持 .xlsx 工作簿")
    content = await file.read(MAX_FILE_SIZE + 1)
    if not content or len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "文件为空或超过 20MB")
    return await run_in_threadpool(
        _run,
        lambda: workbook_import.upload_task(
            db,
            company_id,
            payroll_period_id,
            file.filename or "",
            content,
        ),
    )


@router.get("/workbook", response_model=list[WorkbookImportOut])
def list_workbooks(company_id: int = Query(..., gt=0), db: Session = Depends(get_db)):
    return workbook_import.list_tasks(db, company_id)


@router.get("/workbook/{task_id}", response_model=WorkbookImportOut)
def get_workbook(task_id: int, db: Session = Depends(get_db)):
    return _run(lambda: workbook_import.get_task(db, task_id))


@router.get("/workbook/{task_id}/file")
def download_workbook(task_id: int, db: Session = Depends(get_db)) -> Response:
    task = _run(lambda: workbook_import.get_task(db, task_id, include_file=True))
    return Response(
        content=task["original_file"],
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"workbook-{task_id}.xlsx\"; filename*=UTF-8''"
                + quote(task["original_filename"])
            )
        },
    )


@router.post("/workbook/{task_id}/rows/{row_id}/correct", response_model=WorkbookImportOut)
def correct_workbook_row(
    task_id: int, row_id: int, payload: WorkbookRowCorrection, db: Session = Depends(get_db)
):
    return _run(
        lambda: workbook_import.correct_task_row(
            db, task_id, row_id, payload.values, payload.expected_revision
        )
    )


@router.get("/performance-template")
def download_performance_template() -> Response:
    return Response(
        content=make_performance_template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": (
                f'attachment; filename="performance-template-{PERFORMANCE_TEMPLATE_VERSION}.xlsx"'
            )
        },
    )


@router.post("/performance", status_code=201, response_model=MonthlyImportBatchOut)
async def upload_performance(
    company_id: int = Query(..., gt=0),
    payroll_period_id: int = Query(..., gt=0),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "绩效导入仅支持 .xlsx 固定模板")
    content = await file.read(MAX_FILE_SIZE + 1)
    if not content or len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "文件为空或超过 20MB")
    return _run(
        lambda: performance_import.upload_batch(
            db, company_id, payroll_period_id, file.filename or "", content
        )
    )


@router.get("/performance", response_model=list[MonthlyImportBatchOut])
def list_performance_imports(
    company_id: int = Query(...), db: Session = Depends(get_db)
) -> list[dict[str, Any]]:
    return performance_import.list_batches(db, company_id)


@router.get("/performance/{batch_id}", response_model=MonthlyImportBatchOut)
def get_performance_import(batch_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    return _run(lambda: performance_import.get_batch(db, batch_id))


@router.get("/performance/{batch_id}/file")
def download_performance_file(batch_id: int, db: Session = Depends(get_db)) -> Response:
    batch = _run(lambda: performance_import.get_batch(db, batch_id, include_file=True))
    return Response(
        content=batch["original_file"],
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="performance-import-{batch_id}.xlsx"'
        },
    )


@router.post("/performance/{batch_id}/rows/{row_id}/correct", response_model=MonthlyImportBatchOut)
def correct_performance_row(
    batch_id: int, row_id: int, payload: RowCorrection, db: Session = Depends(get_db)
) -> dict[str, Any]:
    return _run(lambda: performance_import.correct_row(db, batch_id, row_id, payload.values))


@router.get("/attendance-template")
def download_attendance_template() -> Response:
    return Response(
        content=make_attendance_template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": (
                "attachment; filename=\"attendance-template.xlsx\"; filename*=UTF-8''"
                + quote("考勤导入模版.xlsx")
            )
        },
    )


@router.post("/attendance", status_code=201, response_model=MonthlyImportBatchOut)
async def upload_attendance(
    company_id: int = Query(..., gt=0),
    payroll_period_id: int = Query(..., gt=0),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "考勤导入仅支持 .xlsx 固定模板")
    content = await file.read(MAX_FILE_SIZE + 1)
    if not content or len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "文件为空或超过 20MB")
    return _run(
        lambda: attendance_import.upload_batch(
            db, company_id, payroll_period_id, file.filename or "", content
        )
    )


@router.get("/attendance", response_model=list[MonthlyImportBatchOut])
def list_attendance_imports(
    company_id: int = Query(...), db: Session = Depends(get_db)
) -> list[dict[str, Any]]:
    return attendance_import.list_batches(db, company_id)


@router.get("/attendance/{batch_id}", response_model=MonthlyImportBatchOut)
def get_attendance_import(batch_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    return _run(lambda: attendance_import.get_batch(db, batch_id))


@router.get("/attendance/{batch_id}/file")
def download_attendance_file(batch_id: int, db: Session = Depends(get_db)) -> Response:
    batch = _run(lambda: attendance_import.get_batch(db, batch_id, include_file=True))
    return Response(
        content=batch["original_file"],
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="attendance-import-{batch_id}.xlsx"'
        },
    )


@router.post("/attendance/{batch_id}/rows/{row_id}/correct", response_model=MonthlyImportBatchOut)
def correct_attendance_row(
    batch_id: int, row_id: int, payload: RowCorrection, db: Session = Depends(get_db)
) -> dict[str, Any]:
    return _run(lambda: attendance_import.correct_row(db, batch_id, row_id, payload.values))


def _run(action):
    try:
        return action()
    except ImportFailure as exc:
        raise HTTPException(exc.status_code, exc.message) from exc


@router.get("/employee-template")
def download_employee_template() -> Response:
    return Response(
        content=make_template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": (
                f'attachment; filename="employee-template-{TEMPLATE_VERSION}.xlsx"'
            )
        },
    )


@router.post("/employee-master", status_code=201, response_model=ImportBatchOut)
async def upload_employee_master(
    company_id: int = Query(...), file: UploadFile = File(...), db: Session = Depends(get_db)
) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "员工导入仅支持 .xlsx 固定模板")
    content = await file.read(MAX_FILE_SIZE + 1)
    if not content or len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "文件为空或超过 20MB")
    return _run(lambda: upload_batch(db, company_id, file.filename or "", content))


@router.get("", response_model=list[ImportBatchOut])
def list_employee_imports(
    company_id: int = Query(...), db: Session = Depends(get_db)
) -> list[dict[str, Any]]:
    return _run(lambda: list_batches(db, company_id))


@router.get("/{batch_id}", response_model=ImportBatchOut)
def get_employee_import(batch_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    return _run(lambda: get_batch(db, batch_id))


@router.get("/{batch_id}/file")
def download_original_file(batch_id: int, db: Session = Depends(get_db)) -> Response:
    batch = _run(lambda: get_batch(db, batch_id, include_file=True))
    return Response(
        content=batch["original_file"],
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="employee-import-{batch_id}.xlsx"'},
    )


@router.post("/{batch_id}/rows/{row_id}/correct", response_model=ImportBatchOut)
def correct_employee_import_row(
    batch_id: int, row_id: int, payload: RowCorrection, db: Session = Depends(get_db)
) -> dict[str, Any]:
    return _run(lambda: correct_row(db, batch_id, row_id, payload.values))
