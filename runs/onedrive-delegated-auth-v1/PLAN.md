# Plan
- Read INTENT/SPEC/ACCEPTANCE to confirm delegated auth scope and constraints.
- Update OneDrive endpoint descriptor/GraphQL schema for authMode + delegated status, keeping stub as default; implement delegated auth start/callback and token storage.
- Wire delegated tokens into preview/ingestion paths; add tests and run `pnpm ci-check` (likely with stub mode).
