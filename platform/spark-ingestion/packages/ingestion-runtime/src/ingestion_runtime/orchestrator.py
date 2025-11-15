"""Compatibility shim for legacy imports.

The orchestration entry points now live in ``runtime_orchestration.orchestrator``.
"""
from warnings import warn

from runtime_orchestration import orchestrator as _orchestrator

main = _orchestrator.main
parse_args = _orchestrator.parse_args
run_cli = _orchestrator.run_cli
validate_config = _orchestrator.validate_config
suggest_singlestore_ddl = _orchestrator.suggest_singlestore_ddl
__all__ = list(getattr(_orchestrator, "__all__", [])) + ["validate_config", "suggest_singlestore_ddl"]

warn(
    "ingestion_runtime.orchestrator is deprecated; import runtime_orchestration.orchestrator instead",
    DeprecationWarning,
    stacklevel=2,
)
