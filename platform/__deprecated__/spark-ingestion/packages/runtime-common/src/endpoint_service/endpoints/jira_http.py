"""Backward-compatible shim for moved Jira endpoint module."""
from importlib import import_module
from types import ModuleType
from typing import Any
from contextlib import contextmanager

_REAL_MODULE: ModuleType = import_module("endpoint_service.endpoints.jira.jira_http")
__all__ = getattr(_REAL_MODULE, "__all__", [])


def __getattr__(name: str) -> Any:  # pragma: no cover - compatibility shim
    return getattr(_REAL_MODULE, name)


@contextmanager
def _patched_runtime():
    """Apply any monkeypatched helpers from the shim into the real module during a call."""
    original_build = getattr(_REAL_MODULE, "_build_jira_session", None)
    original_get = getattr(_REAL_MODULE, "_jira_get", None)
    shim_build = globals().get("_build_jira_session", original_build)
    shim_get = globals().get("_jira_get", original_get)
    try:
        if shim_build is not None:
            setattr(_REAL_MODULE, "_build_jira_session", shim_build)
        if shim_get is not None:
            setattr(_REAL_MODULE, "_jira_get", shim_get)
        yield
    finally:
        if original_build is not None:
            setattr(_REAL_MODULE, "_build_jira_session", original_build)
        if original_get is not None:
            setattr(_REAL_MODULE, "_jira_get", original_get)


def run_jira_ingestion_unit(*args: Any, **kwargs: Any):
    with _patched_runtime():
        return _REAL_MODULE.run_jira_ingestion_unit(*args, **kwargs)


def __setattr__(name: str, value: Any) -> None:  # pragma: no cover - compatibility shim
    globals()[name] = value
