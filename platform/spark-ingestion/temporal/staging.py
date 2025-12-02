from __future__ import annotations

import json
import os
import tempfile
from typing import Dict, List, Optional, Protocol, Tuple

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
                json.dump(records, fp)
            return path
        except Exception as exc:  # pragma: no cover
            activity.logger.warning({"event": "staging_failed", "provider": self.id, "error": str(exc)})
            return None


STAGING_PROVIDERS: Dict[str, StagingProvider] = {
    "file": FileStagingProvider(),
    # Default alias to file until a non-file provider is added.
    "in_memory": FileStagingProvider(),
}


def stage_records(records: Optional[List[dict]], provider_id: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    if records is None:
        return None, None
    pid = (provider_id or "file").lower()
    provider = STAGING_PROVIDERS.get(pid) or STAGING_PROVIDERS["file"]
    handle = provider.stage(records)
    return handle, provider.id
