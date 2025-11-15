#!/usr/bin/env bash
set -euo pipefail
slug="${1:?usage: promote.sh <slug>}"
src="intents/$slug"
dst="runs/$slug"
[ -d "$src" ] || { echo "No such intent: $slug"; exit 1; }
mkdir -p "$dst"
: > "$dst/PLAN.md"; : > "$dst/LOG.md"; : > "$dst/QUESTIONS.md"; : > "$dst/DECISIONS.md"; : > "$dst/TODO.md"
if [ -f "$src/INTENT.md" ]; then
  if command -v gsed >/dev/null 2>&1; then sed_bin=gsed; else sed_bin=sed; fi
  $sed_bin -i.bak 's/^- status: .*/- status: in-progress/' "$src/INTENT.md" || true
  rm -f "$src/INTENT.md.bak"
fi
echo "Promoted $slug"
