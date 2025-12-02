from __future__ import annotations

from typing import Any, Dict, List, Type

from runtime_common.endpoints.base import ConfigurableEndpoint, EndpointDescriptor
from runtime_common.endpoints.jdbc import JdbcEndpoint
from runtime_common.endpoints.jdbc_mssql import MSSQLEndpoint
from runtime_common.endpoints.jdbc_oracle import OracleEndpoint
from runtime_common.endpoints.jdbc_postgres import PostgresEndpoint
from runtime_common.endpoints.http_rest import HttpApiEndpoint
from runtime_common.endpoints.jira_http import JiraEndpoint
from runtime_common.endpoints.stream_kafka import KafkaStreamEndpoint
from runtime_common.endpoints.confluence_http import ConfluenceEndpoint


REGISTERED_ENDPOINTS: List[Type[ConfigurableEndpoint]] = [
    PostgresEndpoint,
    OracleEndpoint,
    MSSQLEndpoint,
    JdbcEndpoint,
    HttpApiEndpoint,
    JiraEndpoint,
    ConfluenceEndpoint,
    KafkaStreamEndpoint,
]

_CLASS_MAP: Dict[str, Type[ConfigurableEndpoint]] = {}


def collect_endpoint_descriptors() -> List[EndpointDescriptor]:
    descriptors: List[EndpointDescriptor] = []
    for endpoint_cls in REGISTERED_ENDPOINTS:
        descriptor_fn = getattr(endpoint_cls, "descriptor", None)
        if callable(descriptor_fn):
            descriptor = descriptor_fn()
            descriptors.append(descriptor)
            _CLASS_MAP.setdefault(descriptor.id, endpoint_cls)
    return descriptors


def get_endpoint_class(template_id: str) -> Type[ConfigurableEndpoint] | None:
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
    try:
        if issubclass(endpoint_cls, JdbcEndpoint):
            return endpoint_cls(tool, endpoint_cfg, table_cfg)
        return endpoint_cls(tool=tool, endpoint_cfg=endpoint_cfg, table_cfg=table_cfg)
    except Exception as exc:
        raise RuntimeError(f"Failed to build endpoint '{template_id}': {exc}") from exc
