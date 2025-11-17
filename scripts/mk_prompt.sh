#!/usr/bin/env bash
set -euo pipefail
slug="${1:?usage: mk_prompt.sh <slug>}"
mkdir -p "runs/$slug"
sed "s/{{slug}}/$slug/g" docs/meta/PROMT_GENERIC_START.template.md  > "runs/$slug/START_PROMPT.md"
echo "Prompts generated in runs/$slug/"
