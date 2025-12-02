from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from temporalio.exceptions import ApplicationError  # type: ignore

from runtime_common.endpoints.base import IngestionCapableEndpoint, SupportsIngestionUnits
from runtime_common.endpoints.registry import build_endpoint
from runtime_common.tools.sqlalchemy import SQLAlchemyTool

from cdm_registry import apply_cdm


def _build_sqlalchemy_tool(connection_url: str) -> SQLAlchemyTool:
    cfg = {
        "runtime": {
            "sqlalchemy": {
                "url": connection_url,
            },
        },
    }
    return SQLAlchemyTool.from_config(cfg)


def run_ingestion_unit(
    *,
    endpoint_id: str,
    unit_id: str,
    template_id: str,
    policy: Optional[Dict[str, Any]],
    checkpoint: Optional[Dict[str, Any]],
    mode: Optional[str],
    data_mode: Optional[str],
    filter: Optional[Dict[str, Any]],
    transient_state: Optional[Dict[str, Any]],
    cdm_model_id: Optional[str],
    logger: Any,
) -> Dict[str, Any]:
    completed_at = datetime.now(timezone.utc).isoformat()
    endpoint_cfg = _resolve_parameters_from_policy(policy)
    table_cfg = {"schema": "ingestion", "table": unit_id, "endpoint_id": endpoint_id}
    tool = _maybe_build_sqlalchemy_tool(endpoint_cfg)
    try:
        endpoint = build_endpoint(template_id, tool=tool, endpoint_cfg=endpoint_cfg or {}, table_cfg=table_cfg)
    except Exception as exc:
        _safe_stop_tool(tool)
        raise ApplicationError(
            f"Unable to initialize endpoint for template {template_id}: {exc}",
            type="IngestionEndpointInitFailed",
            non_retryable=True,
        )

    if isinstance(endpoint, SupportsIngestionUnits):
        units = endpoint.list_units()
        valid_units = {u.unit_id for u in units}
        if unit_id not in valid_units:
            _safe_stop_tool(tool)
            stats = {"note": "unit_not_found", "unitId": unit_id, "completedAt": completed_at}
            return {"result": None, "stats": stats}

    if not isinstance(endpoint, IngestionCapableEndpoint):
        _safe_stop_tool(tool)
        raise ApplicationError(
            f"Endpoint template {template_id} does not support ingestion execution",
            type="IngestionNotSupported",
            non_retryable=True,
        )

    try:
        result = endpoint.run_ingestion_unit(
            unit_id,
            endpoint_id=endpoint_id,
            policy=policy or {},
            checkpoint=checkpoint,
            mode=mode,
            filter=filter,
            transient_state=transient_state,
        )
        records = result.records or []
        if str(data_mode or "").lower() == "cdm":
            resolved_cdm = cdm_model_id or _resolve_cdm_model_id(unit_id, endpoint)
            if not resolved_cdm:
                raise ApplicationError(
                    f"CDM mode requested but cdm_model_id missing for unit {unit_id}",
                    type="CdmModelMissing",
                    non_retryable=True,
                )
            records = apply_cdm(_infer_family(template_id, unit_id), unit_id, resolved_cdm, records, dataset_id=unit_id, endpoint_id=endpoint_id)
        return {"result": result, "records": records}
    finally:
        _safe_stop_tool(tool)


def _resolve_parameters_from_policy(policy: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(policy, dict):
        return None
    params = policy.get("parameters") if isinstance(policy.get("parameters"), dict) else policy
    return params if isinstance(params, dict) else None


def _maybe_build_sqlalchemy_tool(endpoint_cfg: Optional[Dict[str, Any]], connection_url: Optional[str] = None) -> Optional[SQLAlchemyTool]:
    url = connection_url
    if not url and isinstance(endpoint_cfg, dict):
        url = endpoint_cfg.get("url") or endpoint_cfg.get("connection_url")
    if not url:
        return None
    try:
        return _build_sqlalchemy_tool(str(url))
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


def _resolve_cdm_model_id(unit_id: str, endpoint: Any) -> Optional[str]:
    if endpoint and isinstance(endpoint, SupportsIngestionUnits):
        try:
            for unit in endpoint.list_units():
                if unit.unit_id == unit_id and getattr(unit, "cdm_model_id", None):
                    return unit.cdm_model_id
        except Exception:
            return None
    return None


def _infer_family(template_id: Optional[str], unit_id: str) -> str:
    if template_id and "." in template_id:
        return template_id.split(".", 1)[0]
    if unit_id and "." in unit_id:
        return unit_id.split(".", 1)[0]
    return "unknown"
