#!/usr/bin/env bash
set -euo pipefail

# Starts store-core server, brain worker, and ucl ingestion worker.
# Use DEBUG=1 to run all under Delve (ports 40001/40002/40004).

ROOT_DIR="$(git rev-parse --show-toplevel)"

"$ROOT_DIR/scripts/start-store-core.sh"
"$ROOT_DIR/scripts/start-brain-worker.sh"
"$ROOT_DIR/scripts/start-ucl-worker.sh"
