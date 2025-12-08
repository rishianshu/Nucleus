from __future__ import annotations

from typing import Any, Dict, List, Type, cast

from ingestion_models.endpoints import ConfigurableEndpoint, EndpointDescriptor
from endpoint_service.endpoints.jdbc.jdbc import JdbcEndpoint
from endpoint_service.endpoints.jdbc.jdbc_mssql import MSSQLEndpoint
from endpoint_service.endpoints.oracle.jdbc_oracle import OracleEndpoint
from endpoint_service.endpoints.postgres.jdbc_postgres import PostgresEndpoint
from endpoint_service.endpoints.http.http_rest import HttpApiEndpoint
from endpoint_service.endpoints.jira.jira_http import JiraEndpoint
from endpoint_service.endpoints.kafka.stream_kafka import KafkaStreamEndpoint
from endpoint_service.endpoints.confluence.confluence_http import ConfluenceEndpoint
from endpoint_service.endpoints.onedrive.onedrive_http import OneDriveEndpoint


REGISTERED_ENDPOINTS: List[type] = [
    PostgresEndpoint,
    OracleEndpoint,
    MSSQLEndpoint,
    JdbcEndpoint,
    HttpApiEndpoint,
    JiraEndpoint,
    ConfluenceEndpoint,
    KafkaStreamEndpoint,
    OneDriveEndpoint,
]

_CLASS_MAP: Dict[str, type] = {}


def collect_endpoint_descriptors() -> List[EndpointDescriptor]:
    descriptors: List[EndpointDescriptor] = []
    for endpoint_cls in REGISTERED_ENDPOINTS:
        descriptor_fn = getattr(endpoint_cls, "descriptor", None)
        if callable(descriptor_fn):
            descriptor = descriptor_fn()
            descriptors.append(descriptor)
            _CLASS_MAP.setdefault(descriptor.id, endpoint_cls)
    return descriptors


def get_endpoint_class(template_id: str) -> type | None:
    if not _CLASS_MAP:
        collect_endpoint_descriptors()
    return _CLASS_MAP.get(template_id)


def build_endpoint(
    template_id: str,
    *,
    tool: Any,
    endpoint_cfg: Dict[str, Any],
    table_cfg: Dict[str, Any],
) -> ConfigurableEndpoint:
    """
    Construct an endpoint instance by template id using the registered classes.

    Ensures a single instantiation path for metadata/ingestion/UI flows.
    """
    endpoint_cls = get_endpoint_class(template_id)
    if endpoint_cls is None:
        raise ValueError(f"Unknown endpoint template '{template_id}'")
    endpoint_ctor = cast(Type[ConfigurableEndpoint], endpoint_cls)
    try:
        if issubclass(endpoint_ctor, JdbcEndpoint):
            return endpoint_ctor(tool, endpoint_cfg, table_cfg)
        return endpoint_ctor(tool, endpoint_cfg, table_cfg)
    except Exception as exc:
        raise RuntimeError(f"Failed to build endpoint '{template_id}': {exc}") from exc
