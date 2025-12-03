from __future__ import annotations

from typing import Any, Dict

from metadata_service.ingestion.planning import AdaptivePlanner, PlannerRequest
from metadata_service.ingestion.planning.base import REGISTRY as PLANNER_REGISTRY


def plan_ingestion(
    *,
    cfg: Dict[str, Any],
    table_cfg: Dict[str, Any],
    mode: str,
    load_date: str,
    last_watermark: str | None = None,
    ingestion_strategy: str | None = None,
    incremental_column: str | None = None,
    incremental_literal: str | None = None,
):
    _ = AdaptivePlanner  # ensure default planner is registered
    try:
        planner = PLANNER_REGISTRY.get("default")
    except KeyError:
        planner = AdaptivePlanner()
        PLANNER_REGISTRY.register("default", planner)
    planner_request = PlannerRequest(
        schema=table_cfg.get("schema") or "default",
        table=table_cfg.get("table") or table_cfg.get("dataset") or "unknown",
        load_date=load_date,
        mode=mode,
        last_watermark=last_watermark,
        ingestion_strategy=ingestion_strategy,
        incremental_column=incremental_column,
        incremental_literal=incremental_literal,
        table_cfg={"slicing": cfg.get("runtime", {}).get("scd1_slicing", {}), "runtime": cfg.get("runtime", {}), "table": table_cfg},
    )
    return planner.build_plan(endpoint=cfg.get("endpoint"), request=planner_request)
