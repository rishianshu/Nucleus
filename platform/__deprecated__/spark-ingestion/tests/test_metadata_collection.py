import importlib.util
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
WORKER_PATH = ROOT / "temporal" / "metadata_worker.py"
SPEC = importlib.util.spec_from_file_location("metadata_worker_test_module", WORKER_PATH)
metadata_worker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = metadata_worker
SPEC.loader.exec_module(metadata_worker)  # type: ignore[arg-type]


def test_collect_catalog_snapshots_confluence(monkeypatch, tmp_path):
    planned_jobs = [
        SimpleNamespace(
            target=SimpleNamespace(namespace="CONFLUENCE", entity="PAGE"),
            artifact={"dataset": "confluence.page"},
        )
    ]
    plan_result = SimpleNamespace(jobs=planned_jobs, cleanup_callbacks=[])
    monkeypatch.setattr(metadata_worker, "plan_metadata_jobs", lambda request, logger: plan_result)

    class StubMetadataCollectionService:
        def __init__(self, service_cfg, cache_manager, logger, emitter):
            self.cache_manager = cache_manager
            self.logger = logger
            self.emitter = emitter
            self.runs = 0

        def run(self, jobs):
            self.runs += len(list(jobs))

    monkeypatch.setattr(metadata_worker, "MetadataCollectionService", StubMetadataCollectionService)

    class StubCacheManager:
        def __init__(self, cfg, logger, spark):
            self.cache_path = cfg.cache_path
            self.logger = logger
            self.spark = spark

    monkeypatch.setattr(metadata_worker, "MetadataCacheManager", StubCacheManager)

    class StubRepository:
        def __init__(self, cache_manager):
            self.cache_manager = cache_manager

        def latest(self, target):
            return SimpleNamespace(
                payload={
                    "id": f"{target.namespace.lower()}_{target.entity.lower()}",
                    "labels": ["confluence"],
                    "dataset": {"id": "sample_catalog_confluence_pages"},
                }
            )

    monkeypatch.setattr(metadata_worker, "CacheMetadataRepository", StubRepository)

    request = metadata_worker.CollectionJobRequest(
        runId="run-123",
        endpointId="endpoint-1",
        sourceId="endpoint-1",
        endpointName="Confluence Endpoint",
        connectionUrl="https://example.atlassian.net/wiki",
        schemas=["CONFLUENCE"],
        projectId="global",
        labels=["confluence"],
        config={"templateId": "http.confluence"},
    )

    result = metadata_worker._collect_catalog_snapshots_sync(request)
    assert result["recordCount"] == 1
    assert result["recordsPath"]
    with open(result["recordsPath"], encoding="utf-8") as handle:
        payload = json.load(handle)
    assert payload[0]["id"] == "confluence_page"
    assert "confluence" in payload[0]["labels"]
    os.remove(result["recordsPath"])
