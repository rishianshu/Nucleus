"""Shared ingestion models: metadata, schema, CDM, endpoint contracts."""

from __future__ import annotations

from ingestion_models import cdm  # type: ignore
from ingestion_models import metadata  # type: ignore
from ingestion_models import schema  # type: ignore
from ingestion_models import endpoints  # type: ignore
from ingestion_models import requests  # type: ignore

__all__ = ["cdm", "metadata", "schema", "endpoints", "requests"]
