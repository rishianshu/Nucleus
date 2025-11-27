"""Capability-driven metadata planning helpers."""

from __future__ import annotations

from typing import Any, Dict, Optional

from metadata_service.models import MetadataConfigValidationResult, MetadataPlanningResult
from runtime_common.endpoints.registry import get_endpoint_class


def plan_metadata_jobs(request: Any, logger) -> MetadataPlanningResult:
    """Plan metadata collection jobs for the given request via subsystem hooks."""

    config = getattr(request, "config", None) or {}
    template_id = _resolve_template_id(config)
    parameters = _normalize_parameters(config)
    connection_url = getattr(request, "connectionUrl", None)
    if connection_url and "connection_url" not in parameters:
        parameters["connection_url"] = connection_url

    endpoint_cls = get_endpoint_class(template_id) if template_id else None
    if not endpoint_cls:
        logger.warn(
            event="metadata_planning_template_unresolved",
            template=template_id,
            endpoint=getattr(request, "endpointId", None),
        )
        return MetadataPlanningResult(jobs=[])

    endpoint = _instantiate_endpoint(endpoint_cls, parameters, logger, request, template_id)
    if endpoint is None:
        return MetadataPlanningResult(jobs=[])

    subsystem = _resolve_metadata_subsystem(endpoint)
    if subsystem is None:
        logger.info(
            event="metadata_planning_unsupported",
            endpoint=getattr(request, "endpointId", None),
            template=template_id,
        )
        return MetadataPlanningResult(jobs=[])

    normalized_parameters = _validate_parameters(
        subsystem=subsystem,
        parameters=dict(parameters),
        logger=logger,
        request=request,
        template_id=template_id,
    )
    if normalized_parameters is None:
        return MetadataPlanningResult(jobs=[])

    planner_hook = getattr(subsystem, "plan_metadata_jobs", None)
    if not callable(planner_hook):
        logger.info(
            event="metadata_planning_unsupported",
            endpoint=getattr(request, "endpointId", None),
            template=template_id,
        )
        return MetadataPlanningResult(jobs=[])

    try:
        result = planner_hook(parameters=normalized_parameters, request=request, logger=logger)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error(
            event="metadata_planning_hook_failed",
            endpoint=getattr(request, "endpointId", None),
            template=template_id,
            error=str(exc),
        )
        return MetadataPlanningResult(jobs=[])

    if not isinstance(result, MetadataPlanningResult):
        logger.warn(
            event="metadata_planning_invalid_result",
            endpoint=getattr(request, "endpointId", None),
            template=template_id,
            result_type=type(result).__name__,
        )
        return MetadataPlanningResult(jobs=[])

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


def _instantiate_endpoint(endpoint_cls, parameters: Dict[str, Any], logger, request, template_id: Optional[str]):
    table_cfg = {"schema": "catalog", "table": "dataset"}
    try:
        return endpoint_cls(tool=None, endpoint_cfg=parameters, table_cfg=table_cfg)
    except Exception as exc:
        logger.error(
            event="metadata_planning_endpoint_init_failed",
            endpoint=getattr(request, "endpointId", None),
            template=template_id,
            error=str(exc),
        )
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


__all__ = ["plan_metadata_jobs"]
