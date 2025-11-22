## `intents/kb-meta-registry-v1/ACCEPTANCE.md`

```markdown
# Acceptance Criteria

1) kbMeta GraphQL returns required entries  
   - Type: contract  
   - Evidence: Query includes node types (catalog.dataset, metadata.endpoint, doc.page) and edge types (DEPENDENCY_OF, DOCUMENTED_BY), each with label+synonyms.

2) Nodes filter uses human labels but applies canonical values  
   - Type: e2e  
   - Evidence: Selecting “Datasets” filters lists/graph by `catalog.dataset`.

3) Facets labeled from kbMeta  
   - Type: e2e  
   - Evidence: `kbFacets` displays human labels from kbMeta; choosing a label yields correct results.

4) Scenes/Edges show humanized labels  
   - Type: e2e  
   - Evidence: Edge chips show “Documented by” while the copied value remains `DOCUMENTED_BY`.

5) Synonym search works  
   - Type: e2e  
   - Evidence: Searching “table” narrows to `catalog.dataset`.

6) Failure fallback  
   - Type: integration  
   - Evidence: When kbMeta returns an error, the UI renders canonical values and filters still operate (with a warning toast).
````

---

