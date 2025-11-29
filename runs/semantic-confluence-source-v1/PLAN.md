# Plan — semantic-confluence-source-v1

1. **Baseline & scope confirmation**
   - Re-read INTENT/SPEC/ACCEPTANCE plus existing HTTP/Jira endpoint + metadata plumbing to mirror descriptor/capabilities/contracts.
   - Capture concrete tasks in TODO.md (endpoint template, metadata planner hooks, catalog/preview, tests).
2. **Endpoint + metadata subsystem**
   - Implement `ConfluenceEndpoint` + metadata subsystem (spaces/pages/attachments) with descriptor, config validation, and preview helpers.
   - Add unit tests/stubs verifying descriptor fields, metadata normalization, and preview output.
3. **Planner/worker + API/UI integration**
   - Register the template in endpoint registry, extend planner/worker to call the Confluence subsystem, expose template via GraphQL schema/resolvers, and surface datasets in catalog queries.
4. **Preview UX, tests, docs**
   - Update catalog UI to show Confluence datasets/preview, add TS/Python/Playwright tests, refresh docs (endpoint HLD, INGESTION_AND_SINKS, CDM docs refs), and run ci-check.
