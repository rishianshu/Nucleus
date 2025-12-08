# AGENTS.md - Codex Review Configuration

## Repository Overview
This is the Nucleus UCL (Universal Connectivity Layer) codebase containing:
- `platform/ucl-core/` - Go implementation of unified data connectors
- `docs/` - Architecture and specification documents

## Review Focus Areas

### 1. Interface Compliance
- Verify types match `internal/endpoint/*.go` definitions
- Check connectors implement required interfaces (`SourceEndpoint`, `SliceCapable`, etc.)
- Ensure endpoint IDs follow `{family}.{endpoint}` convention (e.g., `http.jira`, `jdbc.postgres`)

### 2. Test Coverage
- Unit tests for all public functions
- Integration tests with clear skip conditions
- Assertions on expected behavior

### 3. Error Handling
- Proper error wrapping with context
- No swallowed errors
- Graceful degradation

### 4. Code Quality
- No hardcoded credentials
- Consistent naming conventions
- Proper documentation comments

## Review Output

Write review artifacts to: `.agent/reviews/REVIEW-{identifier}.md`

## Review Checklist

```markdown
- [ ] Types align with endpoint/* definitions
- [ ] Endpoint ID follows {family}.{endpoint} pattern
- [ ] All public functions have doc comments
- [ ] Unit tests exist and pass
- [ ] Integration tests have skip guards
- [ ] Errors are wrapped with context
- [ ] No hardcoded secrets
```

## Package-Specific Guidelines

### `internal/endpoint/`
- Core interfaces - changes require careful review
- Type definitions must be backward compatible

### `internal/connector/*`
- Must implement `endpoint.Endpoint` at minimum
- Semantic sources should register CDM mappings
- Include factory registration in `register.go`

### `internal/core/`
- Shared models - coordinate with endpoint/ types
- CDM models must match Nucleus docs

## Sprint Stories

Codex should validate PRs against sprint requirements in `.agent/stories/`:

| Sprint | File | Status |
|--------|------|--------|
| 6 | [`sprint-6-hdfs-onedrive.md`](.agent/stories/sprint-6-hdfs-onedrive.md) | ✅ Complete |

When reviewing, check commits against the linked story's acceptance criteria.

## Commit Message Convention

Commits should follow this format for Codex to understand context:

```
<type>(<scope>): <subject>

[optional body]

Story: .agent/stories/<sprint>.md
Closes: #<issue>
```

**Types**: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`
**Scopes**: `ucl`, `jira`, `confluence`, `hdfs`, `onedrive`, etc.

**Example**:
```
feat(hdfs): Add WebHDFS connector

- Implements SourceEndpoint interface
- Datasets: hdfs.file, hdfs.directory
- Pure REST API (no Spark)

Story: .agent/stories/sprint-6-hdfs-onedrive.md
```

## Severity Levels

| Level | Description |
|-------|-------------|
| ERROR | Must fix before merge |
| WARN | Should fix, can defer |
| INFO | Suggestion for improvement |

