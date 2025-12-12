# Acceptance Criteria

1) CDM work/doc entities can be projected into KG nodes and edges via GraphWrite  
   - Type: integration  
   - Evidence:  
     - A test seeds at least one CDM work item and one CDM doc item via existing
       CDM stores (e.g., CdmWorkStore, CdmDocStore, or fixtures).  
     - The test calls `CdmToKgBridge.syncAllToKg` (or `syncWorkItemsToKg` /
       `syncDocItemsToKg`).  
     - Using KG read helpers or GraphStore queries, the test asserts that:  
       - a node with the expected nodeType (e.g., "cdm.work.item") and nodeId
         derived from the CDM `cdm_id` exists,  
       - a node with nodeType "cdm.doc.item" exists,  
       - each node has expected core properties (projectKey/spaceKey, summary/title,
         timestamps).  
     - Suggested path: `apps/metadata-api/src/kg/cdmToKgBridge.test.ts`.

2) Signal instances can be projected into KG with HAS_SIGNAL edges  
   - Type: integration  
   - Evidence:  
     - A test seeds at least one SignalInstance in the signal store whose
       `entityKind` refers to a CDM entity bridged in AC1.  
     - The test calls `SignalsToKgBridge.syncSignalsToKg`.  
     - Using KG read helpers/GraphStore, the test asserts that:  
       - a node of nodeType "signal.instance" exists with properties
         (`summary`, `severity`, `status`, `entityKind`, `entityRef`).  
       - a HAS_SIGNAL edge exists from the target entity node
         (e.g., the corresponding "cdm.work.item" node) to the signal.instance
         node.  
     - Suggested path: `apps/metadata-api/src/kg/signalsToKgBridge.test.ts`.

3) Bridge functions are idempotent (no duplicate nodes/edges)  
   - Type: integration  
   - Evidence:  
     - A test seeds a small number of CDM work/doc rows and SignalInstances.  
     - The test calls `syncCdmAndSignalsToKg()` twice.  
     - After both runs, KG queries show:  
       - exactly one node per CDM entity and per SignalInstance (no duplicates),  
       - exactly one HAS_SIGNAL edge per (entity, signal) pair.  
     - The test can assert counts or use nodeId/edge-type uniqueness guarantees.  
     - Suggested path: `apps/metadata-api/src/kg/bridgeIdempotency.test.ts`.

4) KG/KB read helpers can retrieve CDM entities and attached Signals after sync  
   - Type: integration|e2e  
   - Evidence:  
     - An integration or Playwright test runs the CDM and Signals bridges
       (either explicitly or via a test-only entrypoint).  
     - The test then uses an existing KG/KB API (e.g., a GraphQL field or a KB
       resolver) to fetch a known work or doc entity and asserts that:  
       - the entity can be found in the KG,  
       - its associated HAS_SIGNAL edges are visible (or the attached signal
         metadata is returned via the API).  
     - Suggested path: a targeted test in `apps/metadata-api/src/graph/` or a
       KB-related Playwright spec that filters KB nodes and inspects relationships.
