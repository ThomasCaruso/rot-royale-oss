"""Category schemas (categories milestone)."""

from __future__ import annotations

from pydantic import BaseModel


class CategoryOut(BaseModel):
    name: str
    count: int  # number of servable questions in this category


class CategoriesResponse(BaseModel):
    categories: list[CategoryOut]
