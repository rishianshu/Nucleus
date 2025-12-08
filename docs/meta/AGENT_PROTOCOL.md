# Antigravity Development Protocol

## Overview
This protocol defines how to work with Antigravity for **scalable, artifact-driven development**. It's optimized for a single agent (Antigravity) handling the full cycle, with optional escalation to reasoning models when needed.

---

## Core Principles

1. **Right-Size Artifacts**: Match documentation depth to task complexity
2. **Single Agent, Full Cycle**: Antigravity plans, implements, and verifies
3. **Human as Quality Gate**: You approve, unblock, and merge
4. **Traceable Decisions**: All assumptions logged, ADRs for big changes

---

## Artifact Tiers

### Tier 1: Small Tasks (< 1 hour)
**When**: Bug fixes, small refactors, config changes

**Artifacts**:
- `DECISIONS.md` - Log assumptions made
- `TODO.md` - Follow-ups discovered

**Flow**:
```
You: "Fix the null check in validateConfig"
Antigravity: Implements, logs decision if ambiguous
You: Review diff, merge
```

### Tier 2: Stories (1 hour - 1 day)
**When**: Features, significant changes, new modules

**Artifacts**:
- `INTENT.md` - What & why (lightweight YAML)
- `ACCEPTANCE.md` - Testable criteria (numbered list)
- `DECISIONS.md` - Assumptions during implementation
- `TODO.md` - Deferred items

**Flow**:
```
You: "Add retry logic to the Jira connector"
Antigravity: Creates INTENT + ACCEPTANCE, requests review
You: "LGTM" or feedback
Antigravity: Implements, logs decisions
You: Review, merge
```

### Tier 3: Epics / Architecture (> 1 day)
**When**: System design, major refactors, new services

**Artifacts**:
- `INTENT.md` - Problem & scope
- `SPEC.md` - Contracts, data, constraints (only when needed)
- `ACCEPTANCE.md` - Verification criteria
- `ADR-*.md` - Architectural decisions
- `LLD-*.md` - Low-level design (optional)

**Flow**:
```
You: "Design the CDM service"
Antigravity: Creates INTENT + SPEC + ADRs, requests review
You: Deep review, iterate
Antigravity: Implements incrementally
You: Review, merge
```

---

## Artifact Formats

### INTENT.md (Lightweight)
```yaml
title: <one line>
slug: <kebab-case>
type: feature | bug | techdebt
why: <one sentence>
scope:
  in: [list]
  out: [list]
acceptance:
  1. <testable criterion>
  2. <testable criterion>
```

### ACCEPTANCE.md
```markdown
1) <Observable check>
   - Type: unit | integration | e2e
2) <Observable check>
   - Type: ...
```

### DECISIONS.md
```markdown
## DEC-001: <Title>
**Context**: <why>
**Decision**: <what>
**Rationale**: <why this>
```

### TODO.md
```markdown
- [ ] <Deferred item> (reason: <why deferred>)
```

### ADR-*.md (For Architectural Changes)
```markdown
# ADR-XXX: <Title>
## Status: proposed | accepted | deprecated
## Context
<problem/trigger>
## Decision
<what we chose>
## Consequences
<positive/negative impacts>
```

---

## Workflow

### Normal Flow (Most Work)
```
┌────────────────────────────────────────┐
│           ANTIGRAVITY FLOW             │
├────────────────────────────────────────┤
│                                        │
│  You: Rough idea / request             │
│    ↓                                   │
│  Antigravity: Assess tier              │
│    ├─ Tier 1: Implement directly       │
│    ├─ Tier 2: INTENT + ACCEPTANCE      │
│    └─ Tier 3: INTENT + SPEC + ADR      │
│    ↓                                   │
│  You: Review artifacts (if Tier 2/3)   │
│    ↓                                   │
│  Antigravity: Implement + verify       │
│    ↓                                   │
│  You: Merge                            │
│                                        │
└────────────────────────────────────────┘
```

### Escalation to Reasoning Models
**When**: Complex architectural decisions, novel algorithms, uncertain trade-offs

**How**:
1. Antigravity identifies need for deeper reasoning
2. Creates `ESCALATION.md` with context + options
3. You consult o1/pro model with ESCALATION.md
4. Return decision to Antigravity

```markdown
# ESCALATION.md
## Question
<what needs deeper reasoning>

## Context
<relevant background>

## Options
A: <option>
B: <option>

## Antigravity's Lean
<if any>

## For Human
Copy this to o1/Claude Pro and return the decision.
```

---

## Directory Structure

```
<project>/
├── .agent/
│   └── workflows/           # Slash command definitions
├── intents/
│   └── <slug>/
│       ├── INTENT.md        # What & why
│       ├── ACCEPTANCE.md    # Done criteria
│       ├── SPEC.md          # Contracts (Tier 3 only)
│       └── ESCALATION.md    # For reasoning model (rare)
├── decisions/
│   ├── DECISIONS.md         # Running log
│   └── adr/
│       └── ADR-001-*.md     # Architectural decisions
└── todo/
    └── TODO.md              # Backlog of deferred items
```

---

## Your Role (Human)

### Time Investment
| Activity | % Time | Frequency |
| :--- | :--- | :--- |
| Capture ideas | 5% | As needed |
| Review artifacts | 20% | Per story |
| Answer questions | 15% | When blocked |
| Review & merge | 10% | Per completion |
| **Hands-off** | **50%** | Agent working |

### Decision Points
| Artifact | Your Action |
| :--- | :--- |
| INTENT | Verify scope is correct |
| ACCEPTANCE | Verify criteria are testable |
| SPEC (rare) | Verify contracts are sound |
| ADR | Approve architectural decision |
| ESCALATION | Consult reasoning model |
| Code | Review, then merge |

---

## Slash Commands

| Command | Tier | Creates |
| :--- | :--- | :--- |
| `/fix <desc>` | 1 | Direct implementation |
| `/story <desc>` | 2 | INTENT + ACCEPTANCE |
| `/design <desc>` | 3 | INTENT + SPEC + ADR |
| `/ucl-connector` | 2 | Connector INTENT |
| `/ucl-action` | 2 | Action INTENT |

---

## Migration from Old Docs

| Old Pattern | New Pattern |
| :--- | :--- |
| RUNCARD.md | Removed (Antigravity works from INTENT) |
| LOG.md | Replaced by task_boundary + notify_user |
| QUESTIONS.md | Replaced by notify_user |
| ChatGPT → Codex handoff | Single Antigravity session |
| STATE.md | Antigravity maintains internally |
| STORY.md | Git history is the story |
