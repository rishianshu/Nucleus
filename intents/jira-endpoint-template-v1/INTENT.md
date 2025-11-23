Absolutely—we’re aligned: **ingestion is a generic, first‑class feature**; “semantic‑aware” sources (like Jira) are just drivers that ship with a CDM and smart defaults. Every source goes through the **same pipeline**: *Driver → (optional) CDM normalizer → Sink(s)*, with **KV checkpoints**, **Temporal runs**, and **GraphQL control/status** shared across the board. The UI follows the same ADR patterns we already locked for Catalog/KB (debounced inputs, keep‑previous‑data, cursor pagination, action toasts).

You’ve landed **`ingestion-core-v1`** ✅, so the next minimal step (one‑slug cadence) is to introduce a **Jira endpoint template + units discovery** on top of that core—leaving the full ingest (sync) for the following slug. This keeps things incremental and avoids mixing responsibilities.

Below are **copy‑paste–ready artifacts** for the next slug:

---

## `intents/jira-endpoint-template-v1/INTENT.md`

```markdown
- title: Jira Endpoint Template v1 (HTTP connector + units discovery)
- slug: jira-endpoint-template-v1
- type: feature
- context:
  - apps/metadata-api (endpoint templates, test-connection)
  - apps/metadata-console (Endpoints → Register + Test)
  - ingestion-core-v1 (driver registry, `ingestionUnits`)
- why_now: With `ingestion-core-v1` live, we need a Jira endpoint that fits the generic ingestion pipeline. This slug adds a first-class Jira template (auth/config), validates connectivity, and exposes ingestion units (projects) so the Ingestion page can operate. Actual per-unit syncing happens next.
- scope_in:
  - Metadata endpoint template **`http.jira`** with fields:
    - `baseUrl` (e.g., `https://your-domain.atlassian.net`)
    - `authType` (`apitoken` | `oauth2`) — v1 supports API token
    - `email` (for API token auth)
    - `apiToken` (secret)
    - Optional: `projectAllowlist` (comma-separated keys), `pageSize`, `concurrency`
  - Capabilities: `ingest.pull`, `metadata.api`, `semantic:work`
  - **Test connection** workflow invokes `/rest/api/3/myself` and returns vendor/account info.
  - **Driver registration (units only)**: implement `listUnits()` for Jira projects; wire to generic `ingestionUnits(endpointId)`.
- scope_out:
  - `syncUnit()` (actual ingestion), schedules/cron, vector indexing (separate slugs).
- acceptance:
  1. Template appears in “Register Endpoint → Jira”, fields validate, secrets stored.
  2. **Test connection** succeeds for valid creds and fails with sanitized message for invalid creds.
  3. `ingestionUnits(endpointId)` returns Jira projects (unitId=projectKey, kind=`work.project`).
  4. Ingestion page shows Jira endpoint’s units with **Run** disabled (until next slug).
  5. Additive only—existing Catalog/KB/Ingress UIs remain green and ADR‑compliant. :contentReference[oaicite:1]{index=1}
- constraints:
  - Additive GraphQL only; no breaking changes.
  - UI follows ADR-UI & ADR-Data-Loading (no flicker, debounced input, cursor pagination). 
- non_negotiables:
  - Scope/provenance recorded on any future writes (this slug does not write data).
  - Secrets redacted in logs and status.
- refs:
  - ingestion-core-v1 (driver/units/contracts)
  - catalog/console ADRs (loading & actions). :contentReference[oaicite:3]{index=3}
- status: ready
```

---

## `intents/jira-endpoint-template-v1/SPEC.md`

```markdown
# SPEC — Jira Endpoint Template v1

## Problem
We need a first-class Jira connector that plugs into the generic ingestion core without special-cases: register the endpoint, validate auth, and enumerate ingestion units (projects), so the Ingestion page can operate.

## Interfaces / Contracts

### A) Endpoint Template (`http.jira`)
- Stored in `MetadataEndpointTemplate` with `id="http.jira"`, `family="http"`, `vendor="jira"`.
- Descriptor/config schema:
  - `baseUrl` (string, required, https)
  - `authType` (enum: `apitoken` default)
  - `email` (string) — required when `authType=apitoken`
  - `apiToken` (secret) — required when `authType=apitoken`
  - Optional tuning: `pageSize` (default 100), `concurrency` (default 2), `projectAllowlist` (string)
- Capabilities array: `["ingest.pull","metadata.api","semantic:work"]`.

### B) Test Connection (additive)
- Mutation (reuse existing “test endpoint” surface): call Jira `/rest/api/3/myself`.
- Success ⇒ return `{ accountId, displayName }` (sanitized); Failure ⇒ `E_CONN_AUTH` or `E_CONN_URL` with redaction.

### C) Ingestion Units (driver binding)
- Register a Jira `IngestionDriver` that implements:
  - `listUnits(endpointId)` ⇒ GET `/rest/api/3/project/search` (paged) → `[ { unitId: project.key, kind: "work.project", displayName: project.name } ]`.
  - `estimateLag` can return 0 in v1 or compute from project updated timestamps if cheap.
  - `syncUnit` is a stub (implemented next slug).
- Wire `listUnits` to generic GraphQL `ingestionUnits(endpointId)` (from ingestion-core-v1).

### D) Console behavior
- Endpoints → Register → pick “Jira” (template `http.jira`) and test.
- Ingestion page: shows discovered units under the Jira endpoint; **Run** button is disabled or shows a tooltip “Sync not implemented yet” (acceptable for this slug).

## Data & State
- No new DB tables. Secrets live in endpoint config (secure storage you already use).
- No writes to KB in this slug.

## Constraints
- Additive GraphQL only.
- p95 test-connection < 1s on healthy networks (single call).
- Respect ADR-UI + ADR-Data-Loading (predictable feedback). :contentReference[oaicite:4]{index=4}

## Acceptance Mapping
- AC1 → Template visible & fields validated.
- AC2 → Test connection success/failure paths.
- AC3 → Units returned via `ingestionUnits`.
- AC4 → Ingestion UI presents units; run disabled.
- AC5 → No regressions (ADR patterns on existing screens hold). 

## Risks / Open Questions
- Server vs Cloud Jira: we support Cloud (`/rest/api/3`) first; Server (`/rest/api/2`) can be added later via a template variant.
- OAuth2: out of scope in v1; keep API token path minimal and safe.
```

---

## `intents/jira-endpoint-template-v1/ACCEPTANCE.md`

```markdown
# Acceptance Criteria

1) Template & validation  
   - Type: e2e  
   - Evidence: “Jira” appears under Register Endpoint; submitting invalid URL/email/token yields inline validation errors or sanitized server error.

2) Test connection  
   - Type: integration + e2e  
   - Evidence: Valid creds return account info; invalid creds return `E_CONN_AUTH` (no secrets). Button uses ADR action states/toasts. :contentReference[oaicite:6]{index=6}

3) Units discovery (projects)  
   - Type: integration  
   - Evidence: `ingestionUnits(endpointId)` returns `[ { unitId:"ABC", kind:"work.project", displayName:"Alpha" }, … ]` (paged).

4) Ingestion page visibility  
   - Type: e2e  
   - Evidence: Jira endpoint shows units in the Ingestion table; Run is disabled or guarded in this slug.

5) No UI regressions  
   - Type: e2e  
   - Evidence: Existing Catalog/KB pages retain ADR data-loading behaviors (keep-previous-data, cursor pagination, toasts). 
```

---

