#!/usr/bin/env bash
set -euo pipefail
fail=0
for d in intents/*; do
  [ -d "$d" ] || continue
  for f in INTENT.md SPEC.md ACCEPTANCE.md; do
    if [ ! -f "$d/$f" ]; then
      echo "MISSING: $d/$f"; fail=1
    fi
  done
  # quick INTENT keys check
  if ! grep -q "^- title:" "$d/INTENT.md"; then echo "INTENT missing title in $d"; fail=1; fi
  if ! grep -q "^- slug:" "$d/INTENT.md"; then echo "INTENT missing slug in $d"; fail=1; fi
  if ! grep -q "^- status:" "$d/INTENT.md"; then echo "INTENT missing status in $d"; fail=1; fi
done
exit $fail
