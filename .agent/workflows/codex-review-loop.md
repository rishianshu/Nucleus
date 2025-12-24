---
description: Chunk-based development with local codex-cli review loop
---

# Development with Local Codex Review

This workflow describes the iterative development cycle using local codex-cli for code review before proceeding to the next chunk.

## Cycle Overview

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ 1. Develop   │────▶│ 2. Submit    │────▶│ 3. Review    │
│    Chunk     │     │    Review    │     │    Feedback  │
└──────────────┘     └──────────────┘     └──────┬───────┘
       ▲                                         │
       │         ┌──────────────┐                │
       │         │ 4. Address   │◀───────────────┘
       │         │    Comments  │
       │         └──────┬───────┘
       │                │
       │         ┌──────▼───────┐
       └─────────│ 5. Cleared?  │──▶ Pick next chunk
                 └──────────────┘
```

## Steps

### 1. Identify Chunk
- Pick a logical unit of work from the implementation plan
- Chunk should be reviewable in isolation (50-200 lines ideal)
- Document what the chunk accomplishes

### 2. Develop Chunk
- Implement the feature/fix
- Ensure builds pass locally
- Add minimal tests if applicable

### 3. Submit for Local Review
// turbo
```bash
codex review --local --files <changed-files>
```

Or for specific files:
```bash
codex review --local --files platform/store-core/pkg/hybridsearch/search.go
```

### 4. Review Feedback
- Read codex review output
- Note any critical, warning, or suggestion comments
- Prioritize: Critical > Warning > Suggestion

### 5. Address Comments
- Fix critical and warning issues
- Consider suggestions based on time/impact
- Update code accordingly

### 6. Resubmit Review
// turbo
```bash
codex review --local --files <changed-files>
```

### 7. Review Cleared?
- If no critical/warning issues remain: **Proceed to next chunk**
- If issues remain: Go back to step 5

### 8. Commit Chunk
// turbo
```bash
git add <files>
git commit -m "feat(<scope>): <description>"
```

## Best Practices

- **Small chunks**: Easier to review, faster cycles
- **Single responsibility**: Each chunk does one thing well
- **Clear commit messages**: Document what and why
- **Don't skip review**: Even for "obvious" changes

## Example Session

```
Chunk 1: Hybrid search RRF fusion
  ├── Develop: pkg/hybridsearch/search.go
  ├── Review: codex review --local
  ├── Fix: Address 2 warnings
  ├── Resubmit: Cleared ✅
  └── Commit: feat(search): add hybrid search with RRF fusion

Chunk 2: Search gRPC service
  ├── Develop: pkg/hybridsearch/service.go
  ├── Review: codex review --local
  └── ...
```
