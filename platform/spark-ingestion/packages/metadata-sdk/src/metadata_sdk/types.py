"""Shared metadata data structures exposed via the SDK."""

from __future__ import annotations

try:  # pragma: no cover - fallback for editable installs
    from runtime_core import MetadataContext, MetadataRecord, MetadataTarget
except ModuleNotFoundError:  # pragma: no cover - local development fallback
    import sys
    from pathlib import Path

    _root = next((p for p in Path(__file__).resolve().parents if (p / "packages").exists()), None)
    if _root is not None:
        core_src = _root / "packages" / "core" / "src"
        if core_src.exists():
            sys.path.append(str(core_src))
            from runtime_core import MetadataContext, MetadataRecord, MetadataTarget  # type: ignore  # noqa: E402
        else:  # pragma: no cover - defensive
            raise
    else:  # pragma: no cover - defensive
        raise

__all__ = ["MetadataContext", "MetadataRecord", "MetadataTarget"]
