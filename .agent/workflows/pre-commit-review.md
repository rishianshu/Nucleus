---
description: Local Codex review before committing changes
---

# Pre-Commit Codex Review Workflow

**IMPORTANT**: Always run a local Codex review before committing any changes.

## When to Use
- Before any `git commit` command
- After making code changes to TypeScript, Go, Python, or other core files

## Steps

1. **Stage changes for review**
```bash
git add -A
```

2. **Run local Codex review**
```bash
# turbo
codex exec "Review the staged changes for:
- Code quality issues
- Missing error handling
- Type mismatches
- Logic errors
- Security concerns

Focus on the files modified in this session."
```

3. **Wait for Codex findings**
- If Codex finds issues, fix them before committing
- If Codex passes, proceed with commit

4. **Commit with detailed message**
```bash
git commit -m "type(scope): description

Details of changes made.
Codex review: passed"
```

## Notes
- This workflow ensures code quality before pushing to PR
- Codex review catches issues that may not be caught by linters
- Always address Codex findings before committing
