from typing import Any

from sqlalchemy import BigInteger, DateTime, Identity, Numeric, column, func, literal_column, text
from sqlalchemy.orm import mapped_column

Money = Numeric(18, 2)
Ratio = Numeric(12, 8)
Coefficient = Numeric()


def primary_key() -> Any:
    return mapped_column(BigInteger, Identity(), primary_key=True)


def created_at_column() -> Any:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def empty_json_default() -> Any:
    return text("'{}'::jsonb")


def effective_date_range() -> Any:
    return func.daterange(
        column("effective_from"),
        func.coalesce(column("effective_to"), literal_column("'infinity'::date")),
        literal_column("'[)'"),
    )


__all__ = [
    "Coefficient",
    "Money",
    "Ratio",
    "created_at_column",
    "effective_date_range",
    "empty_json_default",
    "primary_key",
]
