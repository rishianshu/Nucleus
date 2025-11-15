"""
High-level helpers for the Spark ingestion framework.

This package exposes the public entry points that the old monolithic
`ingestion.py` script offered, while keeping the implementation split across
focused modules.
"""

from runtime_common.common import RUN_ID, next_event_seq, PrintLogger, with_ingest_cols
from runtime_common.orchestrator_helpers import validate_config, suggest_singlestore_ddl


def main(*args, **kwargs):
    """
    Lazily import the orchestrator entry point so runtime_orchestration can
    depend on ingestion_runtime without circular imports.
    """
    from runtime_orchestration import orchestrator

    return orchestrator.main(*args, **kwargs)


def run_cli(*args, **kwargs):
    """
    CLI wrapper that defers importing runtime_orchestration until invocation.
    """
    from runtime_orchestration import orchestrator

    return orchestrator.run_cli(*args, **kwargs)

__all__ = [
    "RUN_ID",
    "PrintLogger",
    "main",
    "next_event_seq",
    "run_cli",
    "suggest_singlestore_ddl",
    "validate_config",
    "with_ingest_cols",
]
