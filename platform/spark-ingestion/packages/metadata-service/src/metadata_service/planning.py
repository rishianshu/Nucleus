"""Capability-driven metadata planning helpers."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional, Tuple
from urllib.parse import urlparse

from endpoint_service.endpoints.jdbc import JdbcEndpoint
from endpoint_service.tools.sqlalchemy import SQLAlchemyTool
from ingestion_models.endpoints import MetadataCapableEndpoint  # type: ignore[unused-import]
from metadata_service.endpoints.registry import build_endpoint, get_endpoint_class
from metadata_service.models import MetadataConfigValidationResult, MetadataPlanningResult


def plan_metadata_jobs(request: Any, logger) -> MetadataPlanningResult:
    """Plan metadata collection jobs for the given request via subsystem hooks."""

    config = getattr(request, "config", None) or {}
    template_id = _resolve_template_id(config)
    parameters = _normalize_parameters(config)
    connection_url = getattr(request, "connectionUrl", None)
    if connection_url and "connection_url" not in parameters:
        parameters["connection_url"] = connection_url
    # Normalize schemas for planners (JDBC relies on request.schemas)
    schemas = _resolve_schemas(parameters, getattr(request, "schemas", None))
    if schemas is not None:
        try:
            setattr(request, "schemas", schemas)
        except Exception:
            # If request is frozen, fall back to parameters for planners that consume it
            parameters.setdefault("schemas", schemas)

    endpoint_cls = get_endpoint_class(template_id) if template_id else None
    if not endpoint_cls:
        logger.warn(
            event="metadata_planning_template_unresolved",
            template=template_id,
            endpoint=getattr(request, "endpointId", None),
        )
        return MetadataPlanningResult(jobs=[])

    endpoint, cleanup_callback = _instantiate_endpoint(template_id, endpoint_cls, parameters, logger, request)
    if endpoint is None:
        logger.info(
            event="metadata_planning_unsupported",
            endpoint=getattr(request, "endpointId", None),
            template=template_id,
        )
        return _planning_result([], cleanup_callback)

    subsystem = _resolve_metadata_subsystem(endpoint)
    if subsystem is None:
        logger.info(
            event="metadata_planning_unsupported",
            endpoint=getattr(request, "endpointId", None),
            template=template_id,
        )
        return _planning_result([], cleanup_callback)

    normalized_parameters = _validate_parameters(
        subsystem=subsystem,
        parameters=dict(parameters),
        logger=logger,
        request=request,
        template_id=template_id,
    )
    if normalized_parameters is None:
        return _planning_result([], cleanup_callback)

    planner_hook = getattr(subsystem, "plan_metadata_jobs", None)
    if not callable(planner_hook):
        logger.info(
            event="metadata_planning_unsupported",
            endpoint=getattr(request, "endpointId", None),
            template=template_id,
        )
        return _planning_result([], cleanup_callback)

    try:
        result = planner_hook(parameters=normalized_parameters, request=request, logger=logger)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error(
            event="metadata_planning_hook_failed",
            endpoint=getattr(request, "endpointId", None),
            template=template_id,
            error=str(exc),
        )
        return _planning_result([], cleanup_callback)

    if not isinstance(result, MetadataPlanningResult):
        logger.warn(
            event="metadata_planning_invalid_result",
            endpoint=getattr(request, "endpointId", None),
            template=template_id,
            result_type=type(result).__name__,
        )
        return _planning_result([], cleanup_callback)

    if cleanup_callback:
        result.cleanup_callbacks.append(cleanup_callback)

    return result


def _resolve_template_id(config: Dict[str, Any]) -> Optional[str]:
    for key in ("templateId", "template_id", "template"):
        value = config.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _normalize_parameters(config: Dict[str, Any]) -> Dict[str, Any]:
    params = config.get("parameters")
    if isinstance(params, dict):
        return dict(params)
    return {}


def _resolve_schemas(parameters: Dict[str, Any], requested: Optional[Any]) -> Optional[list[str]]:
    if isinstance(requested, (list, tuple)) and requested:
        return [str(entry).strip() for entry in requested if str(entry).strip()]
    candidate = parameters.get("schemas") if isinstance(parameters, dict) else None
    if isinstance(candidate, str):
        parsed = [part.strip() for part in candidate.split(",") if part.strip()]
        return parsed or None
    if isinstance(candidate, (list, tuple)) and candidate:
        return [str(entry).strip() for entry in candidate if str(entry).strip()]
    return None


def _instantiate_endpoint(
    template_id: str,
    endpoint_cls,
    parameters: Dict[str, Any],
    logger,
    request,
) -> Tuple[Any, Optional[Callable[[], None]]]:
    """
    Instantiate an endpoint for planning using a best-effort SQLAlchemy tool when a URL is available.
    """

    table_cfg = {
        "schema": "catalog",
        "table": "dataset",
        "endpoint_id": getattr(request, "endpointId", None),
    }
    cleanup: Optional[Callable[[], None]] = None
    try:
        connection_url = parameters.get("connection_url") or parameters.get("url") or getattr(request, "connectionUrl", None)
        tool = _maybe_build_sqlalchemy_tool(parameters, connection_url)
        if tool is not None:
            cleanup = getattr(tool, "stop", None)
        endpoint_cfg = (
            _merge_jdbc_parameters(parameters, connection_url)
            if issubclass(endpoint_cls, JdbcEndpoint)
            else parameters
        )
        if issubclass(endpoint_cls, JdbcEndpoint):
            endpoint = endpoint_cls(tool, endpoint_cfg, table_cfg)
        else:
            endpoint = endpoint_cls(tool=tool, endpoint_cfg=endpoint_cfg, table_cfg=table_cfg)
        return endpoint, cleanup
    except Exception as exc:
        logger.error(
            event="metadata_planning_endpoint_init_failed",
            endpoint=getattr(request, "endpointId", None),
            template=template_id,
            error=str(exc),
        )
        if cleanup:
            try:
                cleanup()
            except Exception:
                pass
        return None, None


def _build_sqlalchemy_tool(connection_url: str) -> SQLAlchemyTool:
    return SQLAlchemyTool.from_config({"runtime": {"sqlalchemy": {"url": connection_url}}})


def _maybe_build_sqlalchemy_tool(parameters: Dict[str, Any], connection_url: Optional[str]) -> Optional[SQLAlchemyTool]:
    url = connection_url
    if not url and isinstance(parameters, dict):
        url = parameters.get("connection_url") or parameters.get("url")
    if not url:
        return None
    try:
        return _build_sqlalchemy_tool(str(url))
    except Exception:
        return None


def _resolve_metadata_subsystem(endpoint):
    subsystem_factory = getattr(endpoint, "metadata_subsystem", None)
    if callable(subsystem_factory):
        return subsystem_factory()
    return subsystem_factory


def _validate_parameters(
    subsystem,
    parameters: Dict[str, Any],
    logger,
    request: Any,
    template_id: Optional[str],
) -> Optional[Dict[str, Any]]:
    validator = getattr(subsystem, "validate_metadata_config", None)
    if not callable(validator):
        return parameters
    try:
        validation = validator(parameters=dict(parameters))
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error(
            event="metadata_config_validation_failed",
            endpoint=getattr(request, "endpointId", None),
            template=template_id,
            error=str(exc),
        )
        return None
    if not isinstance(validation, MetadataConfigValidationResult):
        logger.warn(
            event="metadata_config_invalid",
            endpoint=getattr(request, "endpointId", None),
            template=template_id,
            errors=["validation hook returned unexpected result"],
        )
        return None
    if not validation.ok:
        logger.warn(
            event="metadata_config_invalid",
            endpoint=getattr(request, "endpointId", None),
            template=template_id,
            errors=validation.errors,
        )
        return None
    if validation.warnings:
        logger.warn(
            event="metadata_config_warning",
            endpoint=getattr(request, "endpointId", None),
            template=template_id,
            warnings=validation.warnings,
        )
    return validation.normalized_parameters or parameters


def _merge_jdbc_parameters(parameters: Dict[str, Any], connection_url: str) -> Dict[str, Any]:
    cfg = dict(parameters or {})
    if not connection_url:
        return cfg
    if "url" not in cfg:
        cfg["url"] = connection_url
    parsed = urlparse(connection_url)
    if "dialect" not in cfg:
        dialect = connection_url.split("://", 1)[0]
        if "+" in dialect:
            dialect = dialect.split("+", 1)[1]
        cfg["dialect"] = dialect.lower()
    cfg.setdefault("user", parsed.username or "")
    cfg.setdefault("password", parsed.password or "")
    cfg.setdefault("host", parsed.hostname)
    cfg.setdefault("port", parsed.port)
    database = parsed.path[1:] if parsed.path.startswith("/") else parsed.path or None
    cfg.setdefault("database", database)
    return cfg


def _planning_result(jobs, cleanup_callback: Optional[Callable[[], None]]) -> MetadataPlanningResult:
    result = MetadataPlanningResult(jobs=list(jobs))
    if cleanup_callback:
        result.cleanup_callbacks.append(cleanup_callback)
    return result


__all__ = ["plan_metadata_jobs"]
