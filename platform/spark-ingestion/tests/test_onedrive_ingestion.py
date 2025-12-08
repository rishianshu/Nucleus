from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ROOT / "packages"
for rel in ("runtime-common/src", "core/src", "metadata-service/src"):
    sys.path.insert(0, str(PACKAGES / rel))

from endpoint_service.endpoints.onedrive import onedrive_http
from endpoint_service.endpoints.onedrive.onedrive_http import DEFAULT_ONEDRIVE_DATASET, OneDriveEndpoint
from ingestion_models.endpoints import EndpointUnitDescriptor, IngestionPlan
from ingestion_models.metadata import MetadataContext, MetadataRequest, MetadataTarget
from metadata_service.cdm_registry import apply_cdm


STUB_FILES = [
    {
        "id": "file-1",
        "name": "README.txt",
        "size": 128,
        "file": {"mimeType": "text/plain"},
        "lastModifiedDateTime": "2025-01-01T12:00:00Z",
        "webUrl": "https://stub.local/README.txt",
    },
    {
        "id": "file-2",
        "name": "notes.md",
        "size": 256,
        "file": {"mimeType": "text/markdown"},
        "lastModifiedDateTime": "2025-01-02T09:15:00Z",
        "webUrl": "https://stub.local/notes.md",
    },
]


def build_endpoint():
    return OneDriveEndpoint(
        tool=None,
        endpoint_cfg={"drive_id": "drive-stub", "base_url": "http://localhost:8805"},
        table_cfg={"schema": "ingestion", "table": DEFAULT_ONEDRIVE_DATASET},
    )


def test_onedrive_planner_creates_slice(monkeypatch):
    endpoint = build_endpoint()
    unit = EndpointUnitDescriptor(unit_id=DEFAULT_ONEDRIVE_DATASET, supports_incremental=True)
    plan = endpoint.plan_incremental_slices(unit=unit, checkpoint={"cursor": {"lastModified": "2025-01-01T00:00:00Z"}}, policy={}, target_slice_size=100)
    assert isinstance(plan, IngestionPlan)
    assert plan.strategy == "onedrive-lastmodified"
    assert plan.slices
    first_slice = plan.slices[0]
    assert first_slice.lower
    assert first_slice.upper


def test_onedrive_ingestion_and_cdm_mapping(monkeypatch):
    monkeypatch.setattr(onedrive_http, "_iter_drive_items", lambda *args, **kwargs: iter(STUB_FILES))
    endpoint = build_endpoint()
    result = endpoint.run_ingestion_unit(
        DEFAULT_ONEDRIVE_DATASET,
        endpoint_id="endpoint-1",
        policy={"parameters": {"drive_id": "drive-stub"}},
        checkpoint=None,
        mode=None,
        filter=None,
        transient_state=None,
    )
    assert result.records
    mapped = apply_cdm("onedrive", DEFAULT_ONEDRIVE_DATASET, "cdm.doc.item", result.records, dataset_id=DEFAULT_ONEDRIVE_DATASET, endpoint_id="endpoint-1")
    assert mapped
    assert mapped[0]["cdmModelId"] == "cdm.doc.item"
    assert mapped[0]["payload"]["properties"].get("path")


def test_onedrive_metadata_snapshot(monkeypatch):
    monkeypatch.setattr(onedrive_http, "_iter_drive_items", lambda *args, **kwargs: iter(STUB_FILES))
    monkeypatch.setattr(onedrive_http, "_onedrive_get", lambda *args, **kwargs: {"id": "drive-stub", "name": "Stub Drive"})
    endpoint = build_endpoint()
    subsystem = endpoint.metadata_subsystem()
    environment = subsystem.probe_environment(config={"drive_id": "drive-stub"})
    request = MetadataRequest(
        target=MetadataTarget(source_id="src", namespace="onedrive", entity=DEFAULT_ONEDRIVE_DATASET),
        artifact={"dataset": {"entity": DEFAULT_ONEDRIVE_DATASET}},
        context=MetadataContext(source_id="src"),
        refresh=True,
        config={"dataset": DEFAULT_ONEDRIVE_DATASET},
    )
    snapshot = subsystem.collect_snapshot(request=request, environment=environment)
    assert snapshot.dataset
    assert snapshot.dataset.name.startswith("OneDrive Docs")
    assert snapshot.fields[0].name == "id"
    assert snapshot.data_source
