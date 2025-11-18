✅ intents/catalog-view-and-ux-v1/ACCEPTANCE.md

# Acceptance Criteria

1) Trigger collection shows proper action feedback
   - Type: e2e  
   - Evidence: Button transitions idle → pending → success/error; toast shows global status.

2) Catalog dataset list uses pagination (ADR-DataLoading)
   - Type: e2e  
   - Evidence: Default limit respected; next/prev or infinite-scroll loads additional pages; loading/error/empty states visible.

3) Endpoint filter is correct and ID-driven
   - Type: integration + e2e  
   - Evidence: Filter selects datasets strictly belonging to the chosen endpointId, not name matches.

4) Dataset detail page exists and loads metadata
   - Type: e2e  
   - Evidence: Clicking a dataset opens detail page showing schema.table, endpoint, labels, columns, last collection.

5) Preview capability states appear
   - Type: e2e  
   - Evidence:
     - If endpoint lacks preview → “Preview not supported”.
     - If supported but never run → “Run preview” button.
     - If mocked preview state = running/succeeded/failed → correct UI rendering.

6) Navigation robustness
   - Type: e2e  
   - Evidence:
     - Collections → Endpoint navigation always shows loading state.
     - If endpoint fetch fails, toast shows error; view remains stable.

7) Catalog filter/search resets pagination and reloads correctly
   - Type: e2e  
   - Evidence: Changing endpoint filter or search resets page to 1 and fetches correct filtered dataset list.


⸻

