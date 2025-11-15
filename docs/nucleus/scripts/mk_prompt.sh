#!/usr/bin/env bash
set -euo pipefail
slug="${1:?usage: mk_prompt.sh <slug>}"
mkdir -p "runs/$slug"
sed "s/{{slug}}/$slug/g" docs/meta/PROMT_GENERIC_START.template.md  > "runs/$slug/START_PROMPT.md"
sed "s/{{slug}}/$slug/g" docs/meta/PROMPT_RESUME.template.md > "runs/$slug/RESUME_PROMPT.md"
sed "s/{{slug}}/$slug/g" docs/meta/PROMPT_BLOCK.template.md  > "runs/$slug/BLOCK_PROMPT.md"
echo "Prompts generated in runs/$slug/"
