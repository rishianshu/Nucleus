from __future__ import annotations

from typing import Dict, List, Type

from runtime_common.endpoints.base import DescribedEndpoint, EndpointDescriptor
from runtime_common.endpoints.jdbc import JdbcEndpoint
from runtime_common.endpoints.jdbc_mssql import MSSQLEndpoint
from runtime_common.endpoints.jdbc_oracle import OracleEndpoint
from runtime_common.endpoints.jdbc_postgres import PostgresEndpoint
from runtime_common.endpoints.http_rest import HttpApiEndpoint
from runtime_common.endpoints.jira_http import JiraEndpoint
from runtime_common.endpoints.stream_kafka import KafkaStreamEndpoint


REGISTERED_ENDPOINTS: List[Type[DescribedEndpoint]] = [
    PostgresEndpoint,
    OracleEndpoint,
    MSSQLEndpoint,
    JdbcEndpoint,
    HttpApiEndpoint,
    JiraEndpoint,
    KafkaStreamEndpoint,
]

_CLASS_MAP: Dict[str, Type[DescribedEndpoint]] = {}


def collect_endpoint_descriptors() -> List[EndpointDescriptor]:
    descriptors: List[EndpointDescriptor] = []
    for endpoint_cls in REGISTERED_ENDPOINTS:
        descriptor_fn = getattr(endpoint_cls, "descriptor", None)
        if callable(descriptor_fn):
            descriptor = descriptor_fn()
            descriptors.append(descriptor)
            _CLASS_MAP.setdefault(descriptor.id, endpoint_cls)
    return descriptors


def get_endpoint_class(template_id: str) -> Type[DescribedEndpoint] | None:
    if not _CLASS_MAP:
        collect_endpoint_descriptors()
    return _CLASS_MAP.get(template_id)
