from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ROOT / "packages"
for rel in ("runtime-common/src", "core/src"):
    sys.path.insert(0, str(PACKAGES / rel))

from endpoint_service.endpoints.jdbc.jdbc import JdbcEndpoint
from endpoint_service.endpoints.jira.jira_http import JiraEndpoint
from endpoint_service.endpoints.confluence.confluence_http import ConfluenceEndpoint
from ingestion_models.endpoints import EndpointUnitDescriptor, IngestionPlan


class StubTool:
    pass


def test_jdbc_planner_returns_range_slice():
    endpoint = JdbcEndpoint(
        tool=StubTool(),
        jdbc_cfg={"url": "jdbc:postgresql://example.net/db"},
        table_cfg={"schema": "public", "table": "items", "incremental_column": "updated", "incr_col_type": "timestamp"},
        metadata_access=None,
        emitter=None,
    )
    unit = EndpointUnitDescriptor(
        unit_id="public.items",
        supports_incremental=True,
        incremental_column="updated",
        incremental_literal="timestamp",
    )
    plan = endpoint.plan_incremental_slices(unit=unit, checkpoint={"watermark": "2024-01-01 00:00:00"}, policy={}, target_slice_size=1000)
    assert isinstance(plan, IngestionPlan)
    assert plan.strategy == "jdbc-range"
    assert plan.slices
    first_slice = plan.slices[0]
    assert first_slice.lower == "2024-01-01 00:00:00" or first_slice.params.get("lower") == "2024-01-01 00:00:00"
    assert first_slice.upper is not None


def test_jira_planner_creates_project_windows():
    endpoint = JiraEndpoint(
        tool=None,
        endpoint_cfg={"base_url": "https://example.atlassian.net", "auth_type": "basic"},
        table_cfg={"schema": "ingestion", "table": "jira.issues"},
    )
    unit = EndpointUnitDescriptor(unit_id="jira.issues", supports_incremental=True)
    plan = endpoint.plan_incremental_slices(
        unit=unit,
        checkpoint={"cursor": {"lastUpdated": "2024-01-01T00:00:00Z"}},
        policy={"parameters": {"project_keys": ["ENG", "OPS"]}},
        target_slice_size=500,
    )
    assert isinstance(plan, IngestionPlan)
    assert plan.strategy == "jira-project-window"
    assert len(plan.slices) == 2
    assert all(slice_obj.params.get("lower") and slice_obj.params.get("upper") for slice_obj in plan.slices)


def test_confluence_planner_uses_space_windows():
    endpoint = ConfluenceEndpoint(
        tool=None,
        endpoint_cfg={"base_url": "https://example.atlassian.net/wiki", "auth_type": "api_token", "username": "bot", "api_token": "token"},
        table_cfg={"schema": "ingestion", "table": "confluence.page"},
    )
    unit = EndpointUnitDescriptor(unit_id="confluence.page", supports_incremental=True)
    plan = endpoint.plan_incremental_slices(
        unit=unit,
        checkpoint={"cursor": {"spaces": {"DOCS": {"lastUpdatedAt": "2024-01-02T00:00:00Z"}}}},
        policy={"parameters": {"space_keys": ["DOCS"]}},
        target_slice_size=250,
    )
    assert isinstance(plan, IngestionPlan)
    assert plan.strategy == "confluence-space-window"
    assert plan.slices
    assert plan.slices[0].params.get("lower")
    assert plan.slices[0].params.get("upper")
