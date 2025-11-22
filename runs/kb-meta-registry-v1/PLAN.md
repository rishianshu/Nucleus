## kb-meta-registry-v1 Plan

1. **Meta-KB Defaults + GraphQL**
   - Author bundled defaults JSON (node + edge types w/ labels, synonyms, actions).
   - Add loader/cache in metadata API, GraphQL schema/types, and resolver `kbMeta(scope)` including overlay + fallback behavior.
   - Unit tests verifying required entries + scope overlay precedence.

2. **Console Data Layer**
   - Build `useKbMeta()` hook with keep-previous-data + TTL cache, label helpers, and error fallback (canonical values + toast).
   - Wire synonym expansion + label lookup for queries (filters + search).

3. **UI Integration**
   - Update Nodes/Edges explorers, Scenes, chips, and facets to consume kbMeta labels/actions.
   - Ensure fallback path renders canonical values when kbMeta missing.

4. **Testing + Verification**
   - Update/api contract tests for kbMeta.
   - Extend Vitest + Playwright to cover AC2–AC6 (filters, scenes, synonym search, fallback).
   - Document decisions/questions as needed.
