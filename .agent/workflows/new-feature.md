# New Feature Development Workflow

---
description: Develop a new feature using spec-driven approach with agent collaboration
---

## Workflow: `/story <description>`

### Step 1: You Request
Tell Antigravity what you want:
```
"Add retry logic with exponential backoff to JDBC connector"
```

### Step 2: Antigravity Creates Artifacts
- `intents/<slug>/INTENT.md` - scope
- `intents/<slug>/ACCEPTANCE.md` - done criteria
- Requests your review

### Step 3: You Review
- Check scope is correct
- Check acceptance criteria are testable
- Reply "LGTM" or provide feedback

### Step 4: Antigravity Implements
- Writes code + tests
- Logs decisions in `DECISIONS.md`
- Defers items to `TODO.md`

### Step 5: You Merge
- Review code changes
- Verify tests pass
- Merge PR

---

## Artifact Templates

### INTENT.md
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
2) ...
```

---

## For Small Tasks
If the task is small (< 1 hour), skip artifacts:
```
"Fix the null check in validateConfig"
→ Antigravity implements directly
→ You review and merge
```
