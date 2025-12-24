# Acceptance Criteria

1. **Registry record is written on ingestion completion and is idempotent**

   * Type: integration
   * Evidence: test that completes an ingestion/sink run twice and asserts exactly one `materialized_artifacts` row exists for `(tenantId, sourceRunId, artifactKind)` and fields are stable.

2. **Indexing is triggered via registry handle (no large Temporal payload)**

   * Type: integration/e2e
   * Evidence: test that asserts the indexing workflow input is only `{ materializedArtifactId }`, and the indexer reads artifact content via `handle` and writes at least 1 `vector_index_entries` row.

3. **Canonical metadata keys exist and are source-independent**

   * Type: unit/integration
   * Evidence: tests for at least two source families (e.g., GitHub code + Confluence docs) asserting:

     * `canonicalMeta.projectKey` is set (repoKey/spaceKey mapped into it)
     * `canonicalMeta.sourceKind`, `sourceId`, `sourceUrl/title` populated when available
     * `sourceMeta.<family>` preserves raw source keys

4. **Tenant scoping is implicit and enforced for registry reads**

   * Type: integration
   * Evidence: resolver/service test that:

     * there is no tenantId argument on the query
     * querying as tenant A cannot see tenant B artifacts (seed two tenants).

5. **Failure updates registry status deterministically**

   * Type: integration
   * Evidence: force indexer failure; assert registry status becomes `FAILED` with `lastError` populated; rerun indexing transitions `FAILED → INDEXING → INDEXED` when fixed.
