#!/usr/bin/env python3
"""Execute a lightweight SELECT preview using SQLAlchemy."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict


SCRIPT_DIR = Path(__file__).resolve().parent
SPARK_ROOT = SCRIPT_DIR.parent
RUNTIME_COMMON_SRC = SPARK_ROOT / "packages" / "runtime-common" / "src"
if str(RUNTIME_COMMON_SRC) not in sys.path:
    sys.path.insert(0, str(RUNTIME_COMMON_SRC))

from endpoint_service.tools.sqlalchemy import SQLAlchemyTool  # type: ignore  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a dataset preview query.")
    parser.add_argument("--config", required=True, help="Path to preview config JSON.")
    args = parser.parse_args()

    config_path = Path(args.config)
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    preview_cfg = cfg.get("preview") or {}
    runtime_cfg = cfg.get("runtime") or {}
    sqlalchemy_cfg = runtime_cfg.get("sqlalchemy") or {}
    url = sqlalchemy_cfg.get("url")
    if not url:
        raise SystemExit("runtime.sqlalchemy.url is required for dataset preview.")

    schema = str(preview_cfg.get("schema") or "public")
    table = str(preview_cfg.get("table") or "*")
    limit = int(preview_cfg.get("limit") or 50)
    query = preview_cfg.get("query") or build_query(schema, table, limit)

    tool_cfg: Dict[str, Any] = {
        "runtime": {
            "sqlalchemy": sqlalchemy_cfg,
        },
    }
    tool = SQLAlchemyTool.from_config(tool_cfg)
    try:
        rows = tool.execute_sql(query)
    finally:
        tool.stop()

    print(json.dumps({"rows": rows}))


def build_query(schema: str, table: str, limit: int) -> str:
    if table == "*":
        raise SystemExit("preview.table must be an explicit table or view name.")
    quoted_schema = quote_ident(schema)
    quoted_table = quote_ident(table)
    safe_limit = max(1, min(limit, 500))
    return f"SELECT * FROM {quoted_schema}.{quoted_table} LIMIT {safe_limit}"


def quote_ident(value: str) -> str:
    escaped = value.replace('"', '""')
    return f'"{escaped}"'


if __name__ == "__main__":
    main()
