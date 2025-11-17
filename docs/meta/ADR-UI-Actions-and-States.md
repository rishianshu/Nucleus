# ADR: UI Actions & Async States

- Date: 2025-11-xx
- Status: Active
- Context:
  Nucleus console (and later Workspace) has many async actions: trigger collections, navigate between views, run preview/profile, etc. Today they often feel opaque: no feedback, no clear success/error state. We need a consistent pattern so users always know what is happening, and developers don’t re-invent ad-hoc handling.

- Decision:
  All async actions in Nucleus/Workspace UIs MUST follow a common "Action State" pattern with:
  - a **local indicator** (near the action site), and
  - a **global indicator** (app-level feedback: toast/banner/icons).

## Action State Model

Each async action has a finite state machine:

- `idle` → `pending` → `success` | `error`.

### Local indicator

- While `pending`:
  - The initiating control (button/link/menu item) is disabled.
  - A small spinner or loading icon is shown inline.
- On `success`:
  - Local context shows a brief "success" cue:
    - updated text (e.g. "Run queued"),
    - updated status chip (e.g. last run timestamp),
    - or subtle "checkmark" icon.
- On `error`:
  - Inline error text or icon near the action (e.g. below the button or in the card footer).

### Global indicator

- A shared notification mechanism (e.g. toast manager or top status bar) shows:
  - Action name, e.g. "Trigger collection".
  - Result:
    - success: "Collection triggered successfully."
    - error: short, sanitized message.

Global indicators are optional for ultra-frequent actions (e.g. search debounces) but mandatory for:
- mutations to server state (trigger run, update endpoint),
- navigation that can fail (open endpoint, open dataset).

## Implementation Guidelines

- Provide a shared hook (e.g. `useAsyncAction`) that:
  - wraps a promise-returning function,
  - exposes `state: "idle" | "pending" | "success" | "error"`,
  - provides callbacks / helpers to show toasts.
- Do not manually juggle booleans like `isLoadingTrigger` in multiple places; always go through the shared pattern.

## Applicability

- MUST apply to:
  - Endpoint "Trigger collection" actions.
  - Collections → Endpoint or Collections → Dataset navigation.
  - Preview/Profile actions (when implemented).
- SHOULD apply to:
  - Any other mutation or navigation where a user might be confused if nothing happens.

- Consequences:
  - Consistent UX across console and Workspace.
  - Easier testing (we can test the state machine + notifications in one place).