# Acceptance Criteria

### Shared Setup (AC1–AC5)

Use JDBC Postgres template with:

```json
{
  "parameters": {
    "host": "localhost",
    "port": "5432",
    "database": "jira_plus_plus",
    "username": "postgres",
    "password": "postgres",
    "role": "",
    "schemas": "",
    "ssl_mode": "",
    "version_hint": "",
    "ssl_root_cert": "",
    "ssl_client_key": "",
    "ssl_client_cert": "",
    "application_name": "",
    "connect_timeout_ms": "",
    "statement_timeout_ms": "",
    "additional_parameters": ""
  },
  "templateId": "jdbc.postgres"
}
```

---

### **1) Create → auto collection → datasets**

* Type: integration + e2e
* Evidence: `registerEndpoint` creates endpoint & immediately triggers a collection run. Run reaches `SUCCEEDED`. Catalog displays new tables/datasets.

### **2) Manual Trigger Collection**

* Type: integration + e2e
* Evidence: From UI, “Trigger collection” calls mutation → new run appears → run finishes → detail + catalog reflect updated metadata.

### **3) Wrong credentials → test/trigger fail**

* Type: integration + e2e
* Evidence:

  * Update endpoint: change password to a wrong value.
  * `testEndpoint` returns `ok=false` + `E_CONN_TEST_FAILED`.
  * Manual trigger fails: either `E_CONN_INVALID` or Temporal run `FAILED`.
  * UI shows error banner (no infinite loading).

### **4) Correct credentials → test/trigger succeed**

* Type: integration + e2e
* Evidence: restore password, run `testEndpoint` → `ok=true`; manual trigger succeeds → run appears and finishes successfully.

### **5) Soft delete semantics**

* Type: integration + e2e
* Evidence:

  * `deleteEndpoint` sets `deletedAt`
  * Endpoint removed from list
  * Manual trigger blocked with `E_ENDPOINT_DELETED`
  * Catalog no longer shows datasets for this endpoint
  * Historical runs remain accessible

### **6) UI State Contract (ADR-0001)**

* Type: e2e
* Evidence:

  * Loading indicator removed ≤ 1s after GraphQL settles
  * Empty state shown when no endpoints (no spinner)
  * GraphQL errors → banner with code (no spinner)
  * `E_AUTH_REQUIRED` → Sign-in CTA
  * `E_ROLE_FORBIDDEN` → Insufficient permissions
  * Retry/refresh always resolves to one of: data / empty / error / auth (never infinite loading)
