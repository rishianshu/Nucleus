from typing import Any, Dict, Optional, Sequence

from endpoint_service.orchestration.modes import build_orchestration_plan as _core_build_plan


def build_orchestration_plan(cfg: Dict[str, Any], argv: Optional[Sequence[str]] = None) -> Any:
    """
    Delegate to the shared orchestration plan builder in endpoint_service.
    """
    return _core_build_plan(cfg, argv)
