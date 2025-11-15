from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Mapping, Optional

from .types import MetadataRecord, MetadataTarget


@dataclass
class BaseRecord:
    target: MetadataTarget
    kind: str = ""
    payload: Mapping[str, Any] = field(default_factory=dict)
    produced_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    producer_id: str = "metadata.sdk"
    version: Optional[str] = None
    quality: Mapping[str, Any] = field(default_factory=dict)
    extras: Mapping[str, Any] = field(default_factory=dict)

    def to_metadata_record(self) -> MetadataRecord:
        return MetadataRecord(
            target=self.target,
            kind=self.kind,
            payload=dict(self.payload),
            produced_at=self.produced_at,
            producer_id=self.producer_id,
            version=self.version,
            quality=dict(self.quality),
            extras=dict(self.extras),
        )


@dataclass
class DataVolumeMetric(BaseRecord):
    kind: str = "ingestion_volume"
    rows: Optional[int] = None
    bytes_written: Optional[int] = None
    mode: Optional[str] = None
    load_date: Optional[str] = None

    def __post_init__(self) -> None:
        payload = dict(self.payload)
        if self.rows is not None:
            payload.setdefault("rows", self.rows)
        if self.bytes_written is not None:
            payload.setdefault("bytes", self.bytes_written)
        if self.mode is not None:
            payload.setdefault("mode", self.mode)
        if self.load_date is not None:
            payload.setdefault("load_date", self.load_date)
        payload.setdefault("collected_at", self.produced_at.isoformat())
        self.payload = payload
        self.kind = self.kind or "ingestion_volume"


@dataclass
class RuntimeMetric(BaseRecord):
    kind: str = "ingestion_runtime"
    status: str = "success"
    duration_seconds: Optional[float] = None
    error: Optional[str] = None

    def __post_init__(self) -> None:
        payload = dict(self.payload)
        payload.setdefault("status", self.status)
        if self.duration_seconds is not None:
            payload.setdefault("duration_seconds", round(self.duration_seconds, 3))
        if self.error:
            payload.setdefault("error", self.error)
        payload.setdefault("observed_at", self.produced_at.isoformat())
        self.payload = payload
        self.kind = self.kind or "ingestion_runtime"


@dataclass
class SchemaProfile(BaseRecord):
    kind: str = "schema_profile"
    snapshot_version: Optional[str] = None

    def __post_init__(self) -> None:
        payload = dict(self.payload)
        if self.snapshot_version:
            payload.setdefault("snapshot_version", self.snapshot_version)
        payload.setdefault("profiled_at", self.produced_at.isoformat())
        self.payload = payload
        self.kind = self.kind or "schema_profile"


def build_custom_record(
    *,
    target: MetadataTarget,
    kind: str,
    payload: Mapping[str, Any],
    produced_at: Optional[datetime] = None,
    producer_id: str = "metadata.sdk",
    version: Optional[str] = None,
    quality: Optional[Mapping[str, Any]] = None,
    extras: Optional[Mapping[str, Any]] = None,
) -> MetadataRecord:
    record = MetadataRecord(
        target=target,
        kind=kind,
        payload=dict(payload),
        produced_at=produced_at or datetime.now(timezone.utc),
        producer_id=producer_id,
        version=version,
        quality=dict(quality or {}),
        extras=dict(extras or {}),
    )
    return record
