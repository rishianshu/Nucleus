"""Project-level site customisation to expose local packages without installation."""

from __future__ import annotations

import sys
from pathlib import Path
import site

ROOT = Path(__file__).resolve().parent
for pkg in (
    "core",
    "metadata-gateway",
    "metadata-sdk",
    "metadata-service",
    "runtime-common",
    "ingestion-runtime",
    "recon-runtime",
    "runtime-orchestration",
):
    src = ROOT / "packages" / pkg / "src"
    if src.exists():
        path = str(src)
        site.addsitedir(path)
        if path not in sys.path:
            sys.path.append(path)
