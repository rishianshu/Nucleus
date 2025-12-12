#!/usr/bin/env python3
"""Utility script to run metadata collection using the metadata-service runtime."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

REPO_ROOT = Path(__file__).resolve().parents[1]
PACKAGES_DIR = REPO_ROOT / "packages"

for package in ("runtime-common", "metadata-service"):
    package_src = PACKAGES_DIR / package / "src"
    if str(package_src) not in sys.path:
        sys.path.append(str(package_src))

from metadata_service.runtime import collect_metadata  # noqa: E402
from endpoint_service.common import PrintLogger  # noqa: E402
from endpoint_service.tools.sqlalchemy import SQLAlchemyTool  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Run metadata collection via SQLAlchemy tool.")
    parser.add_argument("--config", required=True, help="Path to a JSON config file describing the metadata job.")
    args = parser.parse_args()

    config_path = Path(args.config)
    if not config_path.exists():
        raise FileNotFoundError(f"Metadata job config not found: {config_path}")

    with config_path.open("r", encoding="utf-8") as handle:
        cfg = json.load(handle)

    logger = PrintLogger(job_name=cfg.get("runtime", {}).get("job_name", "metadata-job"))
    tool = SQLAlchemyTool.from_config(cfg)

    try:
        tables = expand_tables(tool, cfg.get("tables") or [])
        if not tables:
            raise RuntimeError("No tables discovered for metadata collection.")
        cfg["tables"] = tables
        collect_metadata(cfg, tables, tool, logger)
        logger.info("metadata_collection_complete", tables=len(tables))
    finally:
        tool.stop()


def expand_tables(tool: SQLAlchemyTool, table_specs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Expand wildcard table declarations into explicit schema.table entries."""
    expanded: List[Dict[str, Any]] = []
    for spec in table_specs:
        schema = spec.get("schema") or "public"
        table = spec.get("table")
        mode = spec.get("mode", "full")
        if table and table != "*":
            expanded.append({"schema": schema, "table": table, "mode": mode})
            continue
        discovered = discover_tables(tool, schema)
        for row in discovered:
            expanded.append({"schema": row["table_schema"], "table": row["table_name"], "mode": mode})
    return expanded


def discover_tables(tool: SQLAlchemyTool, schema: str) -> List[Dict[str, str]]:
    sql = """
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema = :schema
          AND table_type IN ('BASE TABLE', 'VIEW', 'MATERIALIZED VIEW')
          AND table_name NOT LIKE '_prisma%%'
        ORDER BY table_schema, table_name
    """
    rows = tool.execute_sql(sql, {"schema": schema})
    return [{"table_schema": row["table_schema"], "table_name": row["table_name"]} for row in rows]


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    main()
