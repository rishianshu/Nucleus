import json
from types import SimpleNamespace
from typing import Any, Dict, Optional, Sequence


def _build_schedule(orchestration: Dict[str, Any], mode: str) -> Dict[str, Any]:
    if mode == "plain_cron":
        cron = orchestration.get("cron", {}) if isinstance(orchestration, dict) else {}
        expr = cron.get("expression") if isinstance(cron, dict) else None
        return {"expression": expr or "0 * * * *"}
    if mode == "external_scheduler":
        external = orchestration.get("external", {}) if isinstance(orchestration, dict) else {}
        expr = external.get("expression") if isinstance(external, dict) else None
        return {"expression": expr} if expr else {}
    if mode == "temporal":
        temporal = orchestration.get("temporal", {}) if isinstance(orchestration, dict) else {}
        schedule = temporal.get("schedule") if isinstance(temporal, dict) else {}
        return schedule or {}
    return {}


def _build_execution_command(orchestration: Dict[str, Any], mode: str) -> Sequence[str]:
    if mode == "external_scheduler":
        external = orchestration.get("external", {}) if isinstance(orchestration, dict) else {}
        command = external.get("command") if isinstance(external, dict) else None
        if isinstance(command, (list, tuple)):
            return list(command)
    return ["spark-submit", "--class", "metadata_service.ingestion"]


def build_orchestration_plan(cfg: Dict[str, Any], argv: Optional[Sequence[str]] = None) -> Any:
    """
    Shared orchestration plan builder used by ingestion and endpoint layers.
    """
    orchestration = cfg.get("runtime", {}).get("orchestration", {}) if isinstance(cfg, dict) else {}
    raw_mode = orchestration.get("mode") if isinstance(orchestration, dict) else None
    mode = (raw_mode or "plain_cron").lower()
    mapped_mode = mode
    if mode in ("airflow", "external"):
        mapped_mode = "external_scheduler"

    plan = SimpleNamespace(
        mode=mapped_mode,
        config=cfg,
        argv=list(argv or []),
        schedule=_build_schedule(orchestration, mapped_mode),
        execution_command=_build_execution_command(orchestration, mapped_mode),
        retries=(orchestration.get("external", {}).get("retries") if isinstance(orchestration, dict) else {}) or {},
    )
    plan.to_json = lambda: json.dumps(
        {
            "mode": plan.mode,
            "schedule": plan.schedule,
            "execution_command": plan.execution_command,
            "retries": plan.retries,
        }
    )
    return plan
