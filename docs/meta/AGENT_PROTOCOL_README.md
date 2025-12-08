# Agent Protocol - Portable Package

## Quick Setup

```bash
# Copy to new workspace
cp docs/meta/AGENT_PROTOCOL.md /path/to/new-workspace/docs/meta/
cp docs/meta/HUMAN_ROLE.md /path/to/new-workspace/docs/meta/
cp AGENTS.md /path/to/new-workspace/
cp -r .agent /path/to/new-workspace/
mkdir -p /path/to/new-workspace/.github/workflows
cp .github/workflows/codex-review.yml /path/to/new-workspace/.github/workflows/
```

---

## Files Included

| File | Purpose |
|------|---------|
| `docs/meta/AGENT_PROTOCOL.md` | Full workflow spec |
| `docs/meta/HUMAN_ROLE.md` | How to invoke agents |
| `AGENTS.md` | Codex review configuration |
| `.agent/stories/_TEMPLATE.md` | Story template |
| `.github/workflows/codex-review.yml` | Auto PR review |

---

## The Workflow

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

---

## How to Use

### Starting a Story
```
YOU: "GPT Pro story: {paste requirements from ChatGPT Pro}"
```

### Implementation
```
YOU: "Implement this"
```

### Request Review
```
YOU: "Run Codex review"
```

### Relay Feedback
```
YOU: "Codex says: {paste review feedback}"
```

### Submit
```
YOU: "Submit PR"
```

---

## Customize for Your Repo

1. Edit `AGENTS.md` - Update package paths and review guidelines
2. Edit story template - Add project-specific sections
3. Edit GitHub workflow - Adjust review focus areas

---

## Multi-Workspace Collaboration

Currently using **Option 2: Human as Message Broker**

```
Antigravity-A ←→ YOU ←→ Antigravity-B
```

You relay messages between workspaces manually. Future: shared artifact directory.
