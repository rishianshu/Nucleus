---
title: "Metadata Console – Login Loop Guardrail"
status: draft
owners:
  - platform-auth
lastUpdated: 2025-11-11
---

## Problem Statement

When the metadata console mounted without a cached Keycloak session it spammed
`keycloak.login()` on every render. The browser flashed between the product
gate and the Keycloak form before the first `check-sso` completed. In some
cases users authenticated successfully but the SPA kicked them back to the
unauthenticated gate (no deep link, no telemetry).

## Design Goals

1. **Single auto-login attempt per navigation.** Automatically redirect to
   Keycloak exactly once when a protected route loads and the user has never
   authenticated in this tab. Subsequent retries must be user initiated unless
   the developer explicitly resets the attempt counter.
2. **Deterministic phases.** Auth context must expose a finite state machine
   (`checking → authenticating → authenticated | anonymous | error`). UI
   decisions reference these phases instead of inferring from `user === null`.
3. **Structured telemetry.** Every redirect attempt and callback is logged
   (console + optional emitter) with a correlation id so loops can be
   reproduced from logs alone.
4. **Graceful fallback.** After two failed auto-attempts we freeze auto-login,
   surface a metadata-branded gate, and show the raw error plus a “Launch
   Keycloak” button.

## Required Instrumentation

| Event                       | Payload                                                         |
| --------------------------- | ---------------------------------------------------------------- |
| `auth:init`                | `{ phase: "checking", keycloak: boolean }`                       |
| `auth:auto_attempt`        | `{ attempt: number, route: string }`                             |
| `auth:auto_suppressed`     | `{ reason: "exceeded_attempts" | "phase_blocked" }`             |
| `auth:success`             | `{ subject: string, tenantId: string, projectId: string }`       |
| `auth:error`               | `{ message: string, code?: string }`                             |

Events may go to `console.info` locally and the future observability sink in
production.

## Auto-login FSM

```
checking --> authenticated
         \-> anonymous
anonymous --(auto attempt <=2)--> authenticating
authenticating --(success)--> authenticated
authenticating --(failure)--> error
error --(user click)--> authenticating
```

`autoAttempts` resets to `0` when we reach `authenticated` or after a manual
logout. Protected routes call `requireAuth()` which:

1. Shows a spinner while `phase in {checking, authenticating}`.
2. Triggers auto-login once (`autoAttempts < MAX_AUTO = 2`).
3. Falls back to the gate when `phase === "anonymous"` and `autoAttempts >= 2`
   or when `phase === "error"`.

## UI Requirements

* The metadata login gate must not reuse Jira++ marketing copy. It should:
  - Reference the metadata console brand (Nucleus Metadata Workspace).
  - Show the tenant/project being requested when available.
  - Include a “Troubleshoot” accordion with the last auth event + timestamp.
* The gate is the only element rendered when `phase === "error"` or
  `phase === "anonymous" && autoAttempts >= 2`.
* The nav bar should hide authenticated-only links until `phase === "authenticated"`.

## Definition of Done

1. The `AuthProvider` exposes `{ phase, error, autoAttempts, hasKeycloak }`.
   The default phase is `checking` when Keycloak config exists; otherwise
   `anonymous`.
2. `useAutoLogin` respects the FSM and logs attempts with a consistent prefix
   (`[AuthLoop]`).
3. Playwright spec (`tests/web-auth.spec.ts`) asserts:
   - No more than two `auth:auto_attempt` console logs before the Keycloak
     form appears.
   - After a successful credential submission the SPA remains on the protected
     route with the nav links visible.
4. The metadata landing page shows the metadata gate (not Jira++) when a user
   lacks a session, and it references Keycloak only as the IdP (“Continue with
   Keycloak” button).
