# Plan
- Read SPEC/INTENT/ACCEPTANCE to confirm scope and inputs.
- Implement OneDrive endpoint template + descriptor (http.onedrive) with test_connection CLI wiring.
- Add stub Graph harness (local server + fixtures) gated by ONEDRIVE_GRAPH_BASE_URL for CI/hermetic tests.
- Build OneDrive metadata subsystem to emit catalog datasets for docs (incl. UI/CLI exposure).
- Wire OneDrive ingestion units into unified planner + staging + CDM docs mapping; ensure KV watermarks.
- Add/adjust GraphQL/TS/Python/Playwright tests and run `pnpm ci-check`.
