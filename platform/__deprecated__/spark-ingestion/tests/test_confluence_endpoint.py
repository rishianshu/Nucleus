import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_COMMON_SRC = ROOT / "packages" / "runtime-common" / "src"
sys.path.insert(0, str(RUNTIME_COMMON_SRC))

from endpoint_service.endpoints.confluence_http import ConfluenceEndpoint


def test_confluence_descriptor_fields():
    descriptor = ConfluenceEndpoint.descriptor()
    assert descriptor.id == "http.confluence"
    assert descriptor.family == "HTTP"
    assert any(field.key == "base_url" for field in descriptor.fields)
    capability_keys = [cap.key for cap in descriptor.capabilities]
    assert "metadata" in capability_keys
    dataset_ids = [entry.get("datasetId") for entry in descriptor.extras.get("datasets", [])]
    assert "confluence.space" in dataset_ids


def test_confluence_build_connection_normalizes_url():
    result = ConfluenceEndpoint.build_connection({"base_url": "https://example.atlassian.net/wiki/"})
    assert result.url == "https://example.atlassian.net/wiki"
    assert "confluence" in result.labels


def test_confluence_list_units_matches_definitions():
    endpoint = ConfluenceEndpoint(tool=None, endpoint_cfg={"base_url": "https://example/wiki"}, table_cfg={"schema": "confluence", "table": "space"})
    units = endpoint.list_units()
    unit_ids = sorted(unit.unit_id for unit in units)
    assert unit_ids == ["confluence.attachment", "confluence.page", "confluence.space"]
