from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Protocol

from temporalio import activity


class StagingProvider(Protocol):
    id: str

    def stage(self, records: List[dict]) -> Optional[str]:
        ...


class FileStagingProvider:
    id = "file"

    def stage(self, records: List[dict]) -> Optional[str]:
        try:
            fd, path = tempfile.mkstemp(prefix="ingestion_", suffix=".json")
            with os.fdopen(fd, "w") as fp:
                json.dump(records, fp, default=str)
            return path
        except Exception as exc:  # pragma: no cover
            activity.logger.warning({"event": "staging_failed", "provider": self.id, "error": str(exc)})
            return None


STAGING_PROVIDERS: Dict[str, StagingProvider] = {
    "file": FileStagingProvider(),
    # Default alias to file until a non-file provider is added.
    "in_memory": FileStagingProvider(),
}


@dataclass
class StagingHandle:
    providerId: str
    path: str


class StagingSession:
    """Lightweight staging session that buffers records and persists them via a provider."""

    def __init__(self, provider: StagingProvider, provider_id: str) -> None:
        self.provider = provider
        self.provider_id = provider_id
        self._records: List[dict] = []
        self._path: Optional[str] = None

    def writer(self) -> "StagingSession":
        return self

    def write_batch(self, records: List[dict]) -> None:
        if not records:
            return
        self._records.extend(records)

    def complete(self) -> Optional[StagingHandle]:
        if self._path is not None:
            return StagingHandle(providerId=self.provider_id, path=self._path)
        self._path = self.provider.stage(self._records or [])
        if self._path is None:
            return None
        return StagingHandle(providerId=self.provider_id, path=self._path)

    def reader(self) -> Iterable[List[dict]]:
        if not self._path or not os.path.exists(self._path):
            return iter(())

        def _iter():
            with open(self._path, "r") as fp:
                try:
                    data = json.load(fp)
                except Exception:
                    data = []
            yield data if isinstance(data, list) else []

        return _iter()


def allocate_session(provider_id: Optional[str] = None) -> StagingSession:
    pid = (provider_id or "file").lower()
    provider = STAGING_PROVIDERS.get(pid) or STAGING_PROVIDERS["file"]
    return StagingSession(provider=provider, provider_id=provider.id)


def stage_records(records: Optional[List[dict]], provider_id: Optional[str]) -> Optional[StagingHandle]:
    if records is None:
        return None
    session = allocate_session(provider_id)
    session.write_batch(records)
    return session.complete()
