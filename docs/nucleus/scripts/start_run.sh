#!/usr/bin/env bash
set -euo pipefail
slug="${1:?usage: start_run.sh <slug>}"
run="runs/$slug"; state="sync/STATE.md"
ts="$(date +"%Y-%m-%d %H:%M")"
mkdir -p "$(dirname "$state")"
echo "- $ts — run started" >> "$run/LOG.md"
cat > "$state" <<EOF
# STATE SYNC (auto-updated)

## Focus Feature
$slug (status: in-progress)

## Last Run
- slug: $slug
- status: in-progress
- duration: (n/a)
- tests: (n/a)
- commits: (n/a)
- decisions: 0
- next_step: (n/a)

## Global Queue
TODAY:
- $slug
NEXT:
- 
LATER:
- 

## Events (last 24h)
- $ts run started ($slug)
EOF
