# Agent Protocol: Multi-Agent Development Workflow

## Overview

```
┌──────────┐       ┌──────────────┐       ┌──────────┐
│  Human   │──────▶│  Antigravity │──────▶│  Codex   │
│Orchestr. │       │   Executor   │       │ Reviewer │
└──────────┘       └──────────────┘       └──────────┘
     │                                         │
     │ relays GPT Pro stories                  │
     │ relays Codex feedback                   │
     └─────────────────────────────────────────┘
```

## Roles

| Agent | Role | Trigger |
|-------|------|---------|
| **Human (You)** | Orchestrator - relays between agents | Always in control |
| **ChatGPT Pro** | Story writing (via Human relay) | Human pastes output |
| **Antigravity** | Implementation, testing, Codex invocation | Human request |
| **Codex** | Code review (CLI or auto on PR) | Human request or PR |

---

## Workflow Phases

### Phase 1: Story Writing (ChatGPT Pro)

```markdown
# Story: STORY-001-add-jdbc-metadata
## Goal
Add MetadataCapable interface to JDBC connector

## Acceptance Criteria
- [ ] ProbeEnvironment returns database version
- [ ] CollectMetadata returns CatalogSnapshot

## Constraints  
- Use information_schema for Postgres
```

Output: `.agent/stories/STORY-001.md`

---

### Phase 2: Implementation (Antigravity)

1. Receive story from user
2. Create `implementation_plan.md`
3. Execute code changes
4. Run tests
5. Commit with story reference

```bash
git commit -m "feat(jdbc): add MetadataCapable [STORY-001]"
```

---

### Phase 3: Review (Codex)

#### Option A: Autonomous Review (CLI)
Antigravity can invoke Codex directly:
```bash
codex review --path ./internal/connector/jdbc/
```

#### Option B: PR Review (GitHub)
On PR creation, Codex auto-reviews via GitHub Action.

---

## Artifact Structure

```
.agent/
├── stories/                 # ChatGPT Pro writes
│   ├── STORY-001.md
│   └── STORY-002.md
├── reviews/                 # Codex writes
│   ├── REVIEW-STORY-001.md
│   └── REVIEW-PR-42.md
└── workflows/               # Antigravity processes
    └── new-feature.md
```

---

## Feedback Loop

```
Codex Review → .agent/reviews/REVIEW-XXX.md → Antigravity reads → Incorporates → Resubmit
```

Max iterations: **3** before escalating to human.

---

## Invocation Methods

### Antigravity → Codex (Autonomous)
```bash
# Local review
codex review --path ./

# Specific file
codex review --file internal/endpoint/types.go
```

### GitHub → Codex (PR Trigger)
```yaml
# .github/workflows/codex-review.yml
on: [pull_request]
jobs:
  review:
    uses: openai/codex-action@v1
```

---

## Story Format

```markdown
# Story: {ID}-{title}

## Goal
{One sentence}

## Acceptance Criteria
- [ ] {Testable criterion}

## Technical Constraints
- {Constraint}

## Definition of Done
- Tests pass
- Codex review approved
```

---

## Review Format

```markdown
# Review: {STORY-ID}

## Summary
{Pass/Fail} - {One line}

## Issues
1. [ERROR] {file}:{line} - {issue}
2. [WARN] {file}:{line} - {suggestion}

## Suggestions
- {Improvement}

## Verdict
[ ] APPROVED
[ ] CHANGES_REQUESTED
```
