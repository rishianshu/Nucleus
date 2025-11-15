#!/usr/bin/env bash
set -euo pipefail
slug="${1:?usage: summarize_run.sh <slug>}"
run="runs/$slug"
echo "### Summary for $slug"
echo
echo "PLAN:"
sed -n '1,80p' "$run/PLAN.md"
echo
echo "LAST 40 LOG LINES:"
tail -n 40 "$run/LOG.md" || true
echo
echo "OPEN QUESTIONS:"
grep -n "^- " "$run/QUESTIONS.md" || echo "(none)"
echo
echo "OPEN TODO:"
grep -n "^- \[ \]" "$run/TODO.md" || echo "(none)"
