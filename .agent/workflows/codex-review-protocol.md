---
description: Protocol for handling Codex code reviews via agent interaction
---

# Codex Review Protocol

This workflow defines the standard process for Agents to read, address, and reply to Codex review comments on GitHub Pull Requests.

## 1. Trigger
This protocol is triggered when:
- A new PR is opened and Codex (or a human reviewer) posts comments.
- The user requests "Check PR comments".

## 2. Process
The Agent should perform the following steps:

### A. Read Comments
1.  **Navigate** to the PR URL (e.g., `https://github.com/org/repo/pull/123`).
2.  **Capture** the page state (screenshot or DOM dump) to identify comment threads.
3.  **Extract** key feedback:
    -   File path & line number
    -   Issue description
    -   Severity (if mentioned)

### B. Address Feedback
1.  **Locate** the code in the local workspace using the file path and line number.
2.  **Verify** the issue by analyzing the code context.
3.  **Implement** the fix (edit code, run tests).
4.  **Confirm** the fix locally (build/test).

### C. Reply & Resolve
1.  **Return** to the PR page in the browser.
2.  **Locate** the specific comment thread.
3.  **Reply** to the comment:
    -   "Fixed in [commit hash]: [Brief explanation of fix]"
    -   Or: "Acknowledged: [Reason for wont-fix]"
4.  **Resolve** the conversation (if applicable/authorized).

## 3. Automation (Future)
Future iterations can automate the "Read" step by parsing GitHub API responses if the environment allows `gh` CLI access.

## 4. Example Interaction
**User**: "Check PR #4 for comments."
**Agent**:
1.  Opens `github.com/.../pull/4`
2.  Sees comment on `main.go:50`: "Handle nil pointer here."
3.  Edits `main.go`, adds check.
4.  Commits and pushes.
5.  Replies on GitHub: "Fixed in a1b2c3d. Added nil check."
