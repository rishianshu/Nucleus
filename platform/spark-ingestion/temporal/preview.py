from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from temporalio.exceptions import ApplicationError  # type: ignore

from runtime_common.endpoints.base import SupportsPreview
from runtime_common.endpoints.registry import build_endpoint
from runtime_common.tools.sqlalchemy import SQLAlchemyTool

from metadata_service.utils import collect_rows, to_serializable


def preview_dataset(
    *,
    template_id: str,
    parameters: Dict[str, Any],
    dataset_id: str,
    schema: str,
    table: str,
    limit: int,
    connection_url: Optional[str],
) -> Dict[str, Any]:
    if not template_id:
        raise ApplicationError("templateId is required for preview", type="PreviewTemplateMissing", non_retryable=True)

    limit = max(1, min(int(limit or 50), 500))
    table_cfg = {"schema": schema, "table": table, "dataset": dataset_id}

    tool = _maybe_build_sqlalchemy_tool(parameters, connection_url)
    try:
        endpoint = build_endpoint(template_id, tool=tool, endpoint_cfg=parameters, table_cfg=table_cfg)
        if isinstance(endpoint, SupportsPreview):
            rows = endpoint.preview(unit_id=dataset_id, limit=limit)
        else:
            subsystem = _resolve_subsystem(endpoint)
            if subsystem is None or not hasattr(subsystem, "preview_dataset"):
                raise ApplicationError(
                    f"Endpoint template '{template_id}' does not expose preview capabilities",
                    type="PreviewNotSupported",
                    non_retryable=True,
                )
            rows = subsystem.preview_dataset(dataset_id=dataset_id, limit=limit, config=parameters)
    finally:
        _safe_stop_tool(tool)

    return {
        "rows": to_serializable(rows),
        "sampledAt": datetime.now(timezone.utc).isoformat(),
    }


def _resolve_subsystem(endpoint):
    metadata_subsystem = getattr(endpoint, "metadata_subsystem", None)
    return metadata_subsystem() if callable(metadata_subsystem) else metadata_subsystem


def _maybe_build_sqlalchemy_tool(parameters: Optional[Dict[str, Any]], connection_url: Optional[str]) -> Optional[SQLAlchemyTool]:
    url = connection_url
    if not url and isinstance(parameters, dict):
        url = parameters.get("url") or parameters.get("connection_url")
    if not url:
        return None
    try:
        cfg = {"runtime": {"sqlalchemy": {"url": url}}}
        return SQLAlchemyTool.from_config(cfg)
    except Exception:
        return None


def _safe_stop_tool(tool) -> None:
    if tool is None:
        return
    stop = getattr(tool, "stop", None)
    if callable(stop):
        try:
            stop()
        except Exception:
            pass
