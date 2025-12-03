"""Utilities for shaping metadata payloads and query results.

These helpers live alongside the endpoint implementations so services can import
from a stable place without pulling in heavy dependencies.
"""
from __future__ import annotations

import dataclasses
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable, Mapping, Sequence


def safe_upper(value: Any) -> str:
    """Upper-case a value safely, returning an empty string for falsy inputs."""
    if value is None:
        return ""
    try:
        return str(value).upper()
    except Exception:
        return ""


def escape_literal(value: Any) -> str:
    """Escape a value for direct use in SQL string literals."""
    if value is None:
        return ""
    return str(value).replace("'", "''")


def collect_rows(rows: Any) -> list[dict[str, Any]]:
    """Normalize row-like results to a list of plain dicts.

    Supports SQLAlchemy Result, Spark Row, or any mapping/sequence of mappings.
    """
    normalized: list[dict[str, Any]] = []
    if rows is None:
        return normalized

    # SQLAlchemy 1.4/2.0 Result
    if hasattr(rows, "mappings"):
        rows = rows.mappings().all()

    # Spark DataFrame collect
    if hasattr(rows, "collect"):
        rows = rows.collect()

    for row in rows:
        if row is None:
            continue
        if isinstance(row, Mapping):
            normalized.append(dict(row))
            continue
        if hasattr(row, "_asdict"):
            normalized.append(dict(row._asdict()))
            continue
        if hasattr(row, "asDict"):
            normalized.append(dict(row.asDict()))  # type: ignore[attr-defined]
            continue
        # Fallback: try attribute dict
        if hasattr(row, "__dict__"):
            normalized.append(dict(row.__dict__))
            continue
        # Last resort: attempt to treat as sequence of pairs
        try:
            normalized.append(dict(row))
        except Exception:
            normalized.append({"value": row})
    return normalized


def to_serializable(value: Any) -> Any:
    """Recursively convert objects into JSON-serializable structures."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if dataclasses.is_dataclass(value):
        return to_serializable(dataclasses.asdict(value))
    if isinstance(value, Mapping):
        return {k: to_serializable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):  # keep order for list/tuple
        return [to_serializable(v) for v in value]
    if isinstance(value, Iterable):
        return [to_serializable(v) for v in value]
    try:
        json.dumps(value)
        return value
    except Exception:
        return str(value)
