from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional

from metadata_service.cache import MetadataCacheConfig, MetadataCacheManager
from metadata_service.guardrails import PrecisionGuardrailEvaluator
from metadata_service.repository import CacheMetadataRepository
from ingestion_models.schema import SchemaDriftPolicy, SchemaDriftValidator, SchemaSnapshot, SchemaSnapshotColumn
from metadata_service.utils import safe_upper, to_serializable
from ingestion_models.metadata import MetadataRepository, MetadataTarget
from pyspark.sql import SparkSession
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from metadata_service.collector import MetadataCollectionService, MetadataJob, MetadataServiceConfig


def _log(logger, level: str, msg: str, **payload: Any) -> None:
    """Helper to log structured messages without depending on runtime emitters."""
    if logger is None:
        return
    method = getattr(logger, level.lower(), None)
    if callable(method):
        method(msg, **payload)
        return
    log_method = getattr(logger, "log", None)
    if callable(log_method):
        log_method(level.upper(), msg, **payload)


def _build_default_tool(cfg: Dict[str, Any], logger):
    runtime_cfg = cfg.get("runtime", {}) if cfg else {}
    sqlalchemy_cfg = runtime_cfg.get("sqlalchemy") or {}
    if not sqlalchemy_cfg.get("url"):
        return None
    try:
        from endpoint_service.tools.sqlalchemy import SQLAlchemyTool
    except Exception as exc:  # pragma: no cover - optional dependency
        _log(logger, "WARN", "metadata_tool_init_failed", error=str(exc), driver="sqlalchemy")
        return None
    try:
        return SQLAlchemyTool.from_config(cfg)
    except Exception as exc:
        _log(logger, "WARN", "metadata_tool_init_failed", error=str(exc), driver="sqlalchemy")
        return None


def _build_metadata_configs(
    cfg: Dict[str, Any],
    logger,
    spark: Optional[SparkSession] = None,
) -> tuple["MetadataServiceConfig", MetadataCacheManager, str]:
    from metadata_service.collector import MetadataServiceConfig
    meta_cfg = cfg.get("metadata", cfg.get("catalog", {})) or {}
    runtime_cfg = cfg.get("runtime", {})
    jdbc_cfg = cfg.get("jdbc", {})
    dialect = (jdbc_cfg.get("dialect") or "default").lower()

    cache_root = meta_cfg.get("cache_path") or meta_cfg.get("root") or "cache/catalog"
    ttl_hours = int(meta_cfg.get("ttl_hours", meta_cfg.get("ttlHours", 24)))
    enabled = bool(meta_cfg.get("enabled", True))
    source_id = (
        meta_cfg.get("source_id")
        or meta_cfg.get("source")
        or runtime_cfg.get("job_name")
        or dialect
    )
    cache_cfg = MetadataCacheConfig(
        cache_path=cache_root,
        ttl_hours=ttl_hours,
        enabled=enabled,
        source_id=str(source_id).lower().replace(" ", "_"),
    )
    cache_manager = MetadataCacheManager(cache_cfg, logger, spark)

    endpoint_defaults = meta_cfg.get("endpoint") if isinstance(meta_cfg.get("endpoint"), dict) else {}
    service_cfg = MetadataServiceConfig(endpoint_defaults=endpoint_defaults)
    return service_cfg, cache_manager, str(source_id)


def _build_remote_emitter(meta_cfg: Dict[str, Any], cache: MetadataCacheManager):
    if GraphQLMetadataEmitter is None:
        return None
    remote_cfg = meta_cfg.get("remote") if isinstance(meta_cfg.get("remote"), dict) else {}
    endpoint = (
        meta_cfg.get("graphql_endpoint")
        or remote_cfg.get("endpoint")
        or os.getenv("METADATA_GRAPHQL_ENDPOINT")
    )
    if not endpoint:
        return None
    api_key = remote_cfg.get("api_key") or os.getenv("METADATA_GRAPHQL_API_KEY")
    default_project = (
        meta_cfg.get("project_id")
        or remote_cfg.get("project_id")
        or os.getenv("METADATA_DEFAULT_PROJECT")
        or cache.cfg.source_id
    )
    headers = remote_cfg.get("headers") if isinstance(remote_cfg.get("headers"), dict) else None
    return GraphQLMetadataEmitter(
        endpoint=str(endpoint),
        api_key=str(api_key) if api_key else None,
        default_project=str(default_project),
        headers=headers,
    )


def _extract_value(source: Any, *keys: str) -> Any:
    if isinstance(source, Mapping):
        for key in keys:
            if key in source:
                return source[key]
    for key in keys:
        if hasattr(source, key):
            return getattr(source, key)
    return None


def _snapshot_columns_from_payload(payload: Mapping[str, Any]):
    columns: Dict[str, SchemaSnapshotColumn] = {}
    raw_columns: Iterable[Any] = payload.get("schema_fields") or payload.get("columns") or []
    for entry in raw_columns:
        name = _extract_value(entry, "name", "column_name")
        if not name:
            continue
        col = SchemaSnapshotColumn(
            name=str(name),
            data_type=_extract_value(entry, "data_type", "type", "dataType"),
            nullable=_extract_value(entry, "nullable"),
            precision=_extract_value(entry, "precision", "data_precision"),
            scale=_extract_value(entry, "scale", "data_scale"),
        )
        columns[col.name.lower()] = col
    return columns


def build_schema_snapshot(record):
    if record is None:
        return None
    payload = record.payload
    if isinstance(payload, Mapping):
        payload_dict: Mapping[str, Any] = payload
    else:
        payload_serialized = to_serializable(payload)
        payload_dict = payload_serialized if isinstance(payload_serialized, Mapping) else {}
    columns = _snapshot_columns_from_payload(payload_dict)
    namespace = safe_upper(record.target.namespace)
    entity = safe_upper(record.target.entity)
    collected_at = payload_dict.get("collected_at") or payload_dict.get("produced_at")
    version = record.version or payload_dict.get("version") or payload_dict.get("version_hint")
    return SchemaSnapshot(
        namespace=namespace,
        entity=entity,
        columns=columns,
        version=version,
        collected_at=collected_at,
        raw=payload,
    )


def collect_metadata(
    cfg: Dict[str, Any],
    tables: List[Dict[str, Any]],
    tool,
    logger,
) -> None:
    """Collect metadata snapshots for the provided tables using their endpoints."""

    # Imported lazily to avoid circular dependency during module import
    from endpoint_service.endpoints.factory import EndpointFactory
    from ingestion_models.endpoints import MetadataCapableEndpoint
    from metadata_service.collector import MetadataCollectionService, MetadataJob

    spark = getattr(tool, "spark", None) if tool is not None else SparkSession.getActiveSession()
    service_cfg, cache_manager, default_namespace = _build_metadata_configs(cfg, logger, spark)
    meta_conf = cfg.get("metadata") or cfg.get("catalog") or {}
    remote_emitter = _build_remote_emitter(meta_conf, cache_manager)
    metadata_service = MetadataCollectionService(service_cfg, cache_manager, logger, emitter=remote_emitter)

    if not cache_manager.cfg.enabled:
        _log(logger, "INFO", "metadata_collection_disabled")
        return
    tool = tool or _build_default_tool(cfg, logger)
    if tool is None:
        _log(logger, "WARN", "metadata_collection_skipped", reason="no_execution_tool")
        return

    jobs: List[MetadataJob] = []
    for tbl in tables:
        try:
            endpoint = EndpointFactory.build_source(cfg, tbl, tool)
        except Exception as exc:  # pragma: no cover - defensive logging
            _log(
                logger,
                "WARN",
                "metadata_endpoint_build_failed",
                schema=tbl.get("schema"),
                dataset=tbl.get("table"),
                error=str(exc),
            )
            continue
        if not isinstance(endpoint, MetadataCapableEndpoint):
            _log(
                logger,
                "INFO",
                "metadata_capability_missing",
                schema=tbl.get("schema"),
                dataset=tbl.get("table"),
            )
            continue
        namespace = safe_upper(str(tbl.get("schema") or tbl.get("namespace") or default_namespace))
        entity = safe_upper(str(tbl.get("table") or tbl.get("dataset") or tbl.get("name") or tbl.get("entity") or "unknown"))
        target = MetadataTarget(namespace=namespace, entity=entity)
        jobs.append(MetadataJob(target=target, artifact=tbl, endpoint=endpoint))

    if not jobs:
        return

    try:
        metadata_service.run(jobs)
    except Exception as exc:  # pragma: no cover - defensive logging
        _log(logger, "WARN", "metadata_collection_failed", error=str(exc))


@dataclass
class MetadataAccess:
    cache_manager: MetadataCacheManager
    repository: MetadataRepository
    gateway: MetadataGateway
    sdk: MetadataSDK
    precision_guardrail: Optional[Any] = None
    guardrail_defaults: Dict[str, Any] = field(default_factory=dict)
    schema_policy: Any = None
    schema_validator: Any = None

    def snapshot_for(self, schema: str, table: str) -> Optional[SchemaSnapshot]:
        target = MetadataTarget(namespace=safe_upper(schema), entity=safe_upper(table))
        record = self.repository.latest(target)
        return build_schema_snapshot(record)


def build_metadata_access(cfg: Dict[str, Any], logger) -> Optional[MetadataAccess]:
    """Prepare repository and evaluators for metadata consumers."""

    meta_conf = cfg.get("metadata") or {}
    spark = getattr(logger, "spark", None) or SparkSession.getActiveSession()
    _, cache_manager, _ = _build_metadata_configs(cfg, logger, spark)
    if not cache_manager.cfg.enabled:
        return None
    repository = CacheMetadataRepository(cache_manager)
    emitter = _build_remote_emitter(meta_conf, cache_manager)
    gateway = MetadataGateway(repository, emitter=emitter)
    sdk = MetadataSDK.with_embedded(
        repository,
        gateway=gateway,
        source_id=cache_manager.cfg.source_id,
    )
    guardrail = PrecisionGuardrailEvaluator(repository)
    guardrail_defaults = meta_conf.get("guardrails", {})
    policy_cfg = meta_conf.get("schema_policy") or meta_conf.get("schemaPolicy")
    schema_policy = SchemaDriftPolicy.from_config(policy_cfg)
    schema_validator = SchemaDriftValidator(schema_policy)
    return MetadataAccess(
        cache_manager=cache_manager,
        repository=repository,
        gateway=gateway,
        sdk=sdk,
        precision_guardrail=guardrail,
        guardrail_defaults=guardrail_defaults,
        schema_policy=schema_policy,
        schema_validator=schema_validator,
    )
