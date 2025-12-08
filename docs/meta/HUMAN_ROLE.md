# Human Role in Agent Workflow

## You Are: The Orchestrator

```
┌──────────┐       ┌──────────────┐       ┌──────────┐
│   YOU    │──────▶│  Antigravity │──────▶│  Codex   │
│Orchestr. │       │  Executor    │       │ Reviewer │
└──────────┘       └──────────────┘       └──────────┘
     │                    ▲                    │
     │  (relay GPT Pro)   │   (relay review)   │
     └────────────────────┴────────────────────┘
```

---

## Your Responsibilities

| Action | How to Invoke |
|--------|---------------|
| **Start new story** | Paste GPT Pro's story/requirements |
| **Request implementation** | "Implement STORY-XXX" |
| **Request review** | "Run Codex review" |
| **Provide feedback** | "GPT Pro says: {feedback}" |
| **Submit PR** | "Submit PR" → triggers auto Codex review |

---

## Invocation Patterns

### 1. New Story from ChatGPT Pro
```
USER: "GPT Pro story:
  Goal: Add Confluence connector
  Acceptance Criteria:
  - Implements SourceEndpoint
  - Uses http base connector
"
```
→ Antigravity creates `.agent/stories/STORY-XXX.md` and starts planning

---

### 2. Start Implementation
```
USER: "Implement this"
```
→ Antigravity creates `implementation_plan.md`, executes, tests

---

### 3. Request Codex Review
```
USER: "Run Codex review on the changes"
```
→ Antigravity invokes `codex review --path ./` and writes output to `.agent/reviews/`

---

### 4. Relay Codex Feedback
```
USER: "Codex says: {review output}"
```
→ Antigravity incorporates feedback

---

### 5. Progressive Refinement
```
USER: "GPT Pro adds: also support incremental sync"
```
→ Antigravity updates story and extends implementation

---

## Workflow Example

```
YOU: "GPT Pro says: Add MetadataCapable to Jira"
  ↓
ANTIGRAVITY: Creates story, plans, implements, tests ✅
  ↓
YOU: "Run Codex review"
  ↓
ANTIGRAVITY: Invokes Codex CLI, writes review artifact
  ↓
YOU: "Codex approved" or "Codex says fix X"
  ↓
ANTIGRAVITY: Incorporates or proceeds to PR
```

---

## Quick Reference

| You Say | Antigravity Does |
|---------|------------------|
| "GPT Pro story: {text}" | Creates `.agent/stories/STORY-XXX.md` |
| "Implement this" | Creates plan, executes, tests |
| "Run Codex review" | Invokes `codex review`, writes output |
| "Codex says: {feedback}" | Incorporates feedback |
| "Submit PR" | Commits and pushes |
| "GPT Pro adds: {more}" | Updates story, extends impl |
