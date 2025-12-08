## Blocking

- Resolved: we will **not** use real Graph creds in CI/Codex. Implement OneDrive endpoint/metadata/ingestion against a **stubbed Graph harness** controlled by `ONEDRIVE_GRAPH_BASE_URL`. In CI/Codex runs, point to a local stub with static fixtures; real Graph + secrets will be configured manually by a human out-of-band.
