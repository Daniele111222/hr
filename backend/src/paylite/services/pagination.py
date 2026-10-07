"""Read a bounded SQL page and its total without loading the complete result."""

from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session


def paginate(db: Session, statement: Select, *, page_no: int, page_size: int) -> dict[str, Any]:
    # 调用方选择 DTO 所需列，并提供包含唯一键的稳定排序。
    total = db.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    rows = db.execute(statement.offset((page_no - 1) * page_size).limit(page_size)).mappings()
    return {"items": list(rows), "total": total, "page_no": page_no, "page_size": page_size}
