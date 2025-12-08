from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional

from ingestion_models.endpoints import SourceEndpoint
from metadata_service.ingestion.planning.base import Probe


@dataclass
class RowCountProbe(Probe):
    lower: str
    upper: Optional[str] = None

    def run(self, endpoint: SourceEndpoint) -> Dict[str, int | str | None]:
        count = endpoint.count_between(lower=self.lower, upper=self.upper)
        return {"rows": count, "lower": self.lower, "upper": self.upper}
