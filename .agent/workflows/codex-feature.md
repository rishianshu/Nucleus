---
description: Scaffold and start a Codex feature (INTENT, SPEC, ACCEPTANCE, RUNCARD -> prompt/promote -> codex CLI)
---

# Codex Feature Workflow

This workflow automates the setup and handoff to the Codex agent for a new feature.

## Usage
`/codex-feature <slug> "<description>"`

## Steps

### 1. Scaffold Artifacts
Create the 4 required files based on the description:
- `intents/<slug>/INTENT.md`
- `intents/<slug>/SPEC.md`
- `intents/<slug>/ACCEPTANCE.md`
- `runs/<slug>/RUNCARD.md`

### 2. Generate Prompt
Run the make commands to generate the prompt file:
```bash
make prompt slug=<slug>
make promote slug=<slug>
```

### 3. Invoke Codex Agent
Read the generated `runs/<slug>/START_PROMPT.md` file, then invoke the codex CLI with the **content** of the file (not the path):

```bash
# Read file first to get content
cat runs/<slug>/START_PROMPT.md

# Then invoke codex with the content
codex "<content...>"
```
