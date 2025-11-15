from __future__ import annotations

import logging
from typing import Iterable, Mapping, MutableMapping, Optional

import requests
from runtime_core import MetadataContext, MetadataEmitter, MetadataRecord

from .utils import to_serializable

LOGGER = logging.getLogger(__name__)

UPSERT_MUTATION = """
mutation UpsertMetadataRecord($input: MetadataRecordInput!) {
  upsertMetadataRecord(input: $input) {
    id
  }
}
""".strip()


class GraphQLMetadataEmitter(MetadataEmitter):
    """Emit metadata records to the metadata GraphQL API."""

    def __init__(
        self,
        endpoint: str,
        *,
        api_key: Optional[str] = None,
        default_project: str = "global",
        timeout: float = 10.0,
        headers: Optional[Mapping[str, str]] = None,
    ) -> None:
        self._endpoint = endpoint
        self._default_project = default_project or "global"
        self._timeout = timeout
        self._session = requests.Session()
        merged_headers: MutableMapping[str, str] = {"Content-Type": "application/json"}
        if api_key:
            merged_headers["Authorization"] = f"Bearer {api_key}"
        if headers:
            merged_headers.update(headers)
        self._headers = merged_headers

    def emit(self, context: MetadataContext, record: MetadataRecord) -> None:
        payload = self._build_payload(context, record)
        self._execute_mutation(payload)

    def emit_many(self, context: MetadataContext, records: Iterable[MetadataRecord]) -> None:
        for record in records:
            self.emit(context, record)

    # ------------------------------------------------------------------ helpers --
    def _build_payload(self, context: MetadataContext, record: MetadataRecord) -> Mapping[str, object]:
        extras = context.extras if isinstance(context.extras, Mapping) else {}
        artifact = extras.get("artifact") if isinstance(extras, Mapping) else None
        project_hint = extras.get("metadata_project_id")
        if not project_hint and isinstance(artifact, Mapping):
            project_hint = artifact.get("metadata_project_id") or artifact.get("project_id")
        project_id = (
            project_hint
            or context.namespace
            or getattr(record.target, "namespace", None)
            or context.source_id
            or getattr(record.target, "source_id", None)
            or self._default_project
        )
        domain = record.kind or getattr(record.target, "entity", None) or "catalog_snapshot"
        labels = {domain}
        if getattr(record.target, "entity", None):
            labels.add(str(record.target.entity))
        if context.source_id:
            labels.add(str(context.source_id))
        payload = to_serializable(record.payload)
        if isinstance(payload, dict):
            wrapper_payload: MutableMapping[str, object] = dict(payload)
        else:
            wrapper_payload = {"value": payload}
        metadata_context = {
            "source_id": context.source_id,
            "run_id": context.run_id,
            "job_id": context.job_id,
        }
        wrapper_payload.setdefault("_metadata", metadata_context)
        return {
            "projectId": str(project_id),
            "domain": str(domain),
            "labels": sorted(label for label in labels if label),
            "payload": wrapper_payload,
          }

    def _execute_mutation(self, input_payload: Mapping[str, object]) -> None:
        try:
            response = self._session.post(
                self._endpoint,
                json={"query": UPSERT_MUTATION, "variables": {"input": input_payload}},
                headers=self._headers,
                timeout=self._timeout,
            )
            response.raise_for_status()
            payload = response.json()
            errors = payload.get("errors")
            if errors:
                LOGGER.warning(
                    "metadata_emit_failed",
                    extra={"endpoint": self._endpoint, "errors": errors},
                )
        except Exception as exc:  # pragma: no cover - network/HTTP errors
            LOGGER.warning(
                "metadata_emit_exception",
                extra={"endpoint": self._endpoint, "error": str(exc)},
            )
