# Project Bootstrap Workflow

---
description: Bootstrap a new project following Nucleus standards (reusable template)
---

## Prerequisites
- [ ] Project scope defined
- [ ] Tech stack decided
- [ ] Repository structure approved

## Phase 1: Project Structure

### 1.1 Create Directory Structure
// turbo
```bash
mkdir -p <project-root>/{api,cmd,internal,docs,tests}
mkdir -p <project-root>/api/v1
mkdir -p <project-root>/docs/{adr,lld}
mkdir -p <project-root>/tests/{unit,integration,e2e}
```

### 1.2 Initialize Language Tools
For Go:
```bash
cd <project-root>
go mod init github.com/nucleus/<project-name>
```

For TypeScript:
```bash
cd <project-root>
pnpm init
```

### 1.3 Create Proto/API Contracts
```bash
touch api/v1/service.proto
```

Define service interface first (contract-driven).

### 1.4 Setup Build Tools
// turbo
```bash
touch Makefile
```

Standard targets:
- `make proto` - Generate code from protos
- `make build` - Compile
- `make test` - Run tests
- `make lint` - Run linters
- `make ci` - Full CI pipeline

---

## Phase 2: Documentation Bootstrap

### 2.1 Architecture Doc
Create `docs/architecture.md`:
- System overview
- Component diagram
- Data flow
- Integration points

### 2.2 ADR Template
Create `docs/adr/001-initial-architecture.md`:
```markdown
# ADR-001: Initial Architecture

## Status
Accepted

## Context
<why this project exists>

## Decision
<key architectural choices>

## Consequences
<what this means for development>
```

### 2.3 Project Layout
Create `docs/project_layout.md`:
- Directory structure explanation
- Key files and their purposes
- Development workflow

---

## Phase 3: Development Setup

### 3.1 Local Development
Create `docker-compose.yml` for dependencies.

### 3.2 CI Pipeline
Create `.github/workflows/ci.yml`:
```yaml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup
        run: <setup commands>
      - name: Test
        run: make test
      - name: Lint
        run: make lint
```

### 3.3 Code Quality
- Pre-commit hooks
- Linter configs
- Test coverage thresholds

---

## Phase 4: Agent Integration

### 4.1 Create Agent Workflows
```bash
mkdir -p .agent/workflows
```

Copy and customize from Nucleus templates:
- `new-feature.md`
- `bug-fix.md`
- `refactor.md`

### 4.2 Create Intent Structure
```bash
mkdir -p intents runs stories sync
touch sync/STATE.md
```

### 4.3 Create Initial Intent
Document the project bootstrap itself:
```bash
mkdir -p intents/project-bootstrap
touch intents/project-bootstrap/{INTENT,SPEC,ACCEPTANCE}.md
```
