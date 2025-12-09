# Agent Instructions & Protocols

This document defines the standard operating procedures for Agents working on the Nucleus codebase. Follow these protocols to ensure consistency, quality, and smooth collaboration.

## 1. Onboarding & Context Discovery
**Goal**: Quickly understand the project state and your objectives.

When starting a new conversation or task:
1.  **Read `task.md`**: Located in `<appDataDir>/brain/<id>/` (or project root). This is the source of truth for current sprint progress.
2.  **Read `implementation_plan.md`**: Understand the active technical design.
3.  **Check `.agent/workflows/`**: Look for standardized workflows (e.g., `codex-review-protocol.md`).
4.  **Check `README.md`**: For general project structure and setup.

## 2. Agent Workflow: Requirements to Code
**Goal**: Plan before you act. minimizing wasted effort.

### Step A: Requirements Analysis
-   Read the user request carefully.
-   Identify the "Definition of Done".
-   Update `task.md` with new items or status.

### Step B: Artifact Creation (Planning Mode)
-   **Create/Update `implementation_plan.md`**:
    -   Proposed Changes (by component/file).
    -   Verification Plan (tests to run).
    -   Key Assumptions.
-   **Notify User**: Request approval for the plan *before* writing significant code.
    -   *Exception*: Small bug fixes or trivial changes do not require a full plan.

### Step C: Execution (Coding Mode)
-   Implement changes following the *Development Cycle* (below).
-   Update `task.md` markers to `[/]` (in progress).

## 3. Development Cycle: Plan -> Code -> Review
**Goal**: Iterative quality assurance.

1.  **Plan**: (See Step B above).
2.  **Code**: Write functional code.
    -   Follow *Code Review Standards* (Section 4).
    -   Maintain parity with existing patterns (e.g., `{family}.{endpoint}` IDs).
3.  **Verify**:
    -   Run Unit Tests: `go test ./...`
    -   Run Integration Tests `apps/metadata-api-go/scripts/run-integration-tests.sh`.
4.  **Review (Codex Protocol)**:
    -   **Trigger**: Push to branch, open PR.
    -   **Listen**: Watch for Codex comments on GitHub.
    -   **Fix**: Address feedback locally.
    -   **Reply**: Comment on the PR thread ("Fixed in <commit>").
    -   **Resolve**: Close the comment thread.

## 4. Code Review Standards
(Originally from AGENTS.md)

### Interface Compliance
-   Verify types match `internal/endpoint/*.go` definitions.
-   Check connectors implement required interfaces (`SourceEndpoint`, `SliceCapable`).
-   Ensure endpoint IDs follow `{family}.{endpoint}` (e.g., `http.jira`).

### Test Coverage
-   Unit tests for all public functions.
-   Integration tests with clear skip conditions (checks for credentials).

### Error Handling
-   Proper error wrapping (`fmt.Errorf("context: %w", err)`).
-   No swallowed errors.

### Code Quality
-   No hardcoded credentials (use Environment Variables).
-   Consistent naming conventions (Go: `CamelCase`, TS: `camelCase`).

## 5. Artifacts Checklist
Maintain these artifacts throughout your session:
-   `task.md`: Living checklist of progress.
-   `implementation_plan.md`: Technical design doc.
-   `walkthrough.md`: Proof of work (screenshots, logs) for the final user handover.
