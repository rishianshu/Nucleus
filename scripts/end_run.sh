#!/usr/bin/env bash
set -euo pipefail
slug="${1:?usage: end_run.sh <slug> <status:success|failed|blocked> <tests> <commits_csv> <next_step>}"
status="$2"; tests="$3"; commits="$4"; next="$5"
run="runs/$slug"; state="sync/STATE.md"
ts="$(date +"%Y-%m-%d %H:%M")"
echo "- $ts — run $status | tests $tests | commits $commits" >> "$run/LOG.md"
cat > "$state" <<EOF
# STATE SYNC (auto-updated)

## Focus Feature
$slug (status: $status)

## Last Run
- slug: $slug
- status: $status
- duration: (fill by CI)
- tests: $tests
- commits: $commits
- decisions: $(wc -l < "$run/DECISIONS.md" 2>/dev/null || echo 0)
- next_step: $next

## Global Queue
TODAY:
- $slug
NEXT:
- 
LATER:
- 

## Events (last 24h)
- $ts run $status ($tests)
EOF
