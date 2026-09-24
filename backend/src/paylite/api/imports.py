from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from paylite.api.deps import get_db
from paylite.excel.attendance_template import (
    TEMPLATE_VERSION as ATTENDANCE_TEMPLATE_VERSION,
)
from paylite.excel.attendance_template import (
    make_template as make_attendance_template,
)
from paylite.excel.employee_template import MAX_FILE_SIZE, TEMPLATE_VERSION, make_template
from paylite.excel.performance_template import (
    TEMPLATE_VERSION as PERFORMANCE_TEMPLATE_VERSION,
)
from paylite.excel.performance_template import make_template as make_performance_template
from paylite.services import attendance_import, performance_import
from paylite.services.employee_import import (
    ImportFailure,
    correct_row,
    get_batch,
    list_batches,
    upload_batch,
)

router = APIRouter(prefix="/imports", tags=["imports"])


class RowCorrection(BaseModel):
    values: dict[str, str] = Field(min_length=1)


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


@router.post("/performance", status_code=201)
async def upload_performance(
    payroll_batch_id: int = Query(...), file: UploadFile = File(...), db: Session = Depends(get_db)
) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "绩效导入仅支持 .xlsx 固定模板")
    content = await file.read(MAX_FILE_SIZE + 1)
    if not content or len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "文件为空或超过 20MB")
    return _run(
        lambda: performance_import.upload_batch(db, payroll_batch_id, file.filename or "", content)
    )


@router.get("/performance")
def list_performance_imports(
    company_id: int = Query(...), db: Session = Depends(get_db)
) -> list[dict[str, Any]]:
    return performance_import.list_batches(db, company_id)


@router.get("/performance/{batch_id}")
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


@router.post("/performance/{batch_id}/rows/{row_id}/correct")
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
                f'attachment; filename="attendance-template-{ATTENDANCE_TEMPLATE_VERSION}.xlsx"'
            )
        },
    )


@router.post("/attendance", status_code=201)
async def upload_attendance(
    payroll_batch_id: int = Query(...), file: UploadFile = File(...), db: Session = Depends(get_db)
) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "考勤导入仅支持 .xlsx 固定模板")
    content = await file.read(MAX_FILE_SIZE + 1)
    if not content or len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "文件为空或超过 20MB")
    return _run(
        lambda: attendance_import.upload_batch(db, payroll_batch_id, file.filename or "", content)
    )


@router.get("/attendance")
def list_attendance_imports(
    company_id: int = Query(...), db: Session = Depends(get_db)
) -> list[dict[str, Any]]:
    return attendance_import.list_batches(db, company_id)


@router.get("/attendance/{batch_id}")
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


@router.post("/attendance/{batch_id}/rows/{row_id}/correct")
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


@router.post("/employee-master", status_code=201)
async def upload_employee_master(
    company_id: int = Query(...), file: UploadFile = File(...), db: Session = Depends(get_db)
) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "员工导入仅支持 .xlsx 固定模板")
    content = await file.read(MAX_FILE_SIZE + 1)
    if not content or len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "文件为空或超过 20MB")
    return _run(lambda: upload_batch(db, company_id, file.filename or "", content))


@router.get("")
def list_employee_imports(
    company_id: int = Query(...), db: Session = Depends(get_db)
) -> list[dict[str, Any]]:
    return _run(lambda: list_batches(db, company_id))


@router.get("/{batch_id}")
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


@router.post("/{batch_id}/rows/{row_id}/correct")
def correct_employee_import_row(
    batch_id: int, row_id: int, payload: RowCorrection, db: Session = Depends(get_db)
) -> dict[str, Any]:
    return _run(lambda: correct_row(db, batch_id, row_id, payload.values))
