from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class CollectionJobRequest:
    runId: str
    endpointId: str
    sourceId: str
    endpointName: str
    connectionUrl: str
    schemas: List[str]
    projectId: Optional[str] = None
    labels: Optional[List[str]] = None
    config: Optional[Dict[str, Any]] = None


@dataclass
class CatalogRecordOutput:
    id: str
    projectId: Optional[str]
    domain: str
    labels: List[str]
    payload: Dict[str, Any]


@dataclass
class CollectionJobResult:
    recordsPath: Optional[str]
    recordCount: int
    logs: List[Dict[str, Any]]


@dataclass
class PreviewRequest:
    datasetId: str
    schema: str
    table: str
    endpointId: str
    unitId: str
    templateId: Optional[str] = None
    parameters: Dict[str, Any] = field(default_factory=dict)
    connectionUrl: Optional[str] = None
    limit: Optional[int] = 50


@dataclass
class IngestionUnitRequest:
    endpointId: str
    unitId: str
    sinkId: Optional[str] = None
    checkpoint: Optional[Dict[str, Any]] = None
    stagingProviderId: Optional[str] = None
    policy: Optional[Dict[str, Any]] = None
    mode: Optional[str] = None
    dataMode: Optional[str] = None
    sinkEndpointId: Optional[str] = None
    cdmModelId: Optional[str] = None
    filter: Optional[Dict[str, Any]] = None
    transientState: Optional[Dict[str, Any]] = None
    transientStateVersion: Optional[str] = None


@dataclass
class IngestionUnitResult:
    newCheckpoint: Optional[Dict[str, Any]]
    stats: Dict[str, Any]
    records: Optional[List[Dict[str, Any]]] = None
    transientState: Optional[Dict[str, Any]] = None
    stagingPath: Optional[str] = None
    stagingProviderId: Optional[str] = None


__all__ = [
    "CollectionJobRequest",
    "CatalogRecordOutput",
    "CollectionJobResult",
    "PreviewRequest",
    "IngestionUnitRequest",
    "IngestionUnitResult",
]
