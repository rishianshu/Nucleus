## Plan — semantic-jira-source-v1

1. **Context sync & spec alignment**
   - Re-read INTENT/SPEC/ACCEPTANCE plus latest docs (`endpoint-HLD.md`, `ENDPOINTS.md`) to keep the Jira endpoint + ingestion catalog expectations fresh.
   - Review the recent Jira catalog/endpoint code (`jira_catalog.py`, `jira_http.py`, metadata normalizer/adapter) so we know exactly what is already implemented vs. open questions.

2. **Infra + seed data**
   - Bring up the dev stack via `scripts/start-dev-stack.sh` (Keycloak, Postgres, Temporal, metadata API/UI) and ensure Prisma migrations (including `IngestionUnitState`) are applied.
   - Seed or register a Jira endpoint instance (fake creds) so ingestion units are available via GraphQL/UI.

3. **Workflow + worker verification**
   - Ensure Temporal ingestion workflow invokes the Python worker using the catalog-derived units (no hard-coded lists) and persists checkpoints/state.
   - Add/update regression tests (TS + Python) that cover the worker consuming catalog metadata, returning normalized records, and KB sink writes.

4. **End-to-end ingestion validation**
   - Execute a Jira ingestion unit through the workflow (non-bypass) and verify KV + `IngestionUnitState` updates, along with KB node creation via the KnowledgeBase sink.
   - Capture evidence (logs/screenshots) and ensure acceptance bullets about Jira data surfacing in KB Admin are satisfied.

5. **Automation + CI**
   - Extend automated coverage (unit/integration + targeted Playwright scenario) so Jira ingestion flow stays green.
   - Run `pnpm ci-check` and document the outcome; update run artifacts/STATE accordingly.
