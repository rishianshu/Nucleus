from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from ingestion_models.endpoints import EndpointCapabilities, SourceEndpoint
from metadata_service.ingestion.planning.base import IngestionPlan, Planner, PlannerRequest, REGISTRY
from metadata_service.ingestion.planning.probe import RowCountProbe


class AdaptivePlanner(Planner):
    """Default planner used for incremental pulls with slice planning."""

    def build_plan(
        self,
        endpoint: SourceEndpoint,
        request: PlannerRequest,
    ) -> IngestionPlan:
        plan = IngestionPlan(schema=request.schema, table=request.table, mode=request.mode)
        caps = endpoint.capabilities()
        desc = endpoint.describe()
        incr_col = request.incremental_column or desc.get("incremental_column")
        literal = request.incremental_literal or caps.incremental_literal
        strategy = (request.ingestion_strategy or "").lower()
        supports_incremental = strategy in {"scd1", "incremental"} or caps.supports_incremental
        if not incr_col or not supports_incremental or request.last_watermark is None:
            plan.metadata["reason"] = "incremental_not_supported"
            return plan

        now_lit = self._current_literal(literal)
        slice_info = self._plan_slices(endpoint, literal, request, incr_col, now_lit)
        plan = plan.with_slices(slice_info["slices"])
        plan.metadata.update(
            {
                "now_literal": now_lit,
                "incremental_column": incr_col,
                "probe_results": slice_info.get("probe_results", []),
            }
        )
        if slice_info.get("total_rows") is not None:
            plan.metadata["estimated_rows"] = slice_info["total_rows"]
        return plan

    def _current_literal(self, literal: str) -> str:
        if literal.startswith("epoch") or literal == "numeric":
            return str(int(time.time()))
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def _plan_slices(
        self,
        endpoint: SourceEndpoint,
        literal: str,
        request: PlannerRequest,
        incr_col: str,
        now_lit: str,
    ) -> Dict[str, Any]:
        last_wm = request.last_watermark
        slicing_cfg = request.table_cfg.get("slicing", {})
        enabled = slicing_cfg.get("enabled", False)
        lower = last_wm
        upper = now_lit
        probe_results: List[Dict[str, Any]] = []
        total_rows = None
        if getattr(caps, "supports_count_probe", False):
            probe = RowCountProbe(lower=lower, upper=upper)
            result = probe.run(endpoint)
            probe_results.append(result)
            total_rows = result["rows"]
        if not enabled:
            return {
                "slices": [{"lower": lower, "upper": upper}],
                "probe_results": probe_results,
                "total_rows": total_rows,
            }

        slices = self._adaptive_slice_logic(
            lower=lower,
            upper=upper,
            literal=literal,
            total_rows=total_rows,
            slicing_cfg=slicing_cfg,
        )
        return {"slices": slices, "probe_results": probe_results, "total_rows": total_rows}

    def _adaptive_slice_logic(
        self,
        *,
        lower: str,
        upper: str,
        literal: str,
        total_rows: Optional[int],
        slicing_cfg: Dict[str, Any],
    ) -> List[Dict[str, str]]:
        max_dur_h = int(slicing_cfg.get("max_duration_hours", 168))
        max_count = int(slicing_cfg.get("max_count", 10_000_000))
        target = int(slicing_cfg.get("target_rows_per_slice", 1_000_000))
        max_parts = int(slicing_cfg.get("max_partitions", 24))
        if total_rows is None or total_rows <= max_count:
            return [{"lower": lower, "upper": upper}]

        parts = min(max_parts, max(2, (total_rows + target - 1) // target))
        if literal.startswith("epoch") or literal == "numeric":
            lo_int = int(float(lower))
            hi_int = int(float(upper))
            step = max(1, (hi_int - lo_int) // parts)
            bounds = [lo_int + i * step for i in range(parts)] + [hi_int]
            return [
                {"lower": str(bounds[i]), "upper": str(bounds[i + 1])}
                for i in range(parts)
            ]
        fmt = "%Y-%m-%d %H:%M:%S"
        t0 = datetime.strptime(lower[:19], fmt)
        t1 = datetime.strptime(upper[:19], fmt)
        duration_hours = ((t1 - t0).total_seconds() / 3600.0)
        if duration_hours <= max_dur_h and total_rows <= max_count:
            return [{"lower": lower, "upper": upper}]
        step = (t1 - t0) / parts
        bounds = [t0 + i * step for i in range(parts)] + [t1]
        lits = [b.strftime(fmt) for b in bounds]
        return [{"lower": lits[i], "upper": lits[i + 1]} for i in range(parts)]


REGISTRY.register("default", AdaptivePlanner())
