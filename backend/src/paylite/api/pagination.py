"""Shared query parameters and response envelope for paginated APIs."""

from pydantic import BaseModel, Field


class PageParams(BaseModel):
    page_no: int = Field(default=1, ge=1, le=2_147_483_647)
    page_size: int = Field(default=10, ge=1, le=100)


class Page[T](BaseModel):
    items: list[T]
    total: int
    page_no: int
    page_size: int
