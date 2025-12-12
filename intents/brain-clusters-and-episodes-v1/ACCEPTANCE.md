# Acceptance Criteria

1) kg.cluster + IN_CLUSTER types are defined and used via GraphWrite  
   - Type: unit|integration  
   - Evidence:  
     - A test ensures that kg_node_types contains an entry for "kg.cluster" with
       required fields including tenantId and projectKey.  
     - kg_edge_types contains an entry for "IN_CLUSTER" from any member type
       (e.g., "cdm.work.item", "cdm.doc.item") to "kg.cluster".  
     - After running ClusterBuilder.buildClustersForProject on a seeded dataset,
       KG/GraphStore contains at least one node with nodeType="kg.cluster" and
       at least one IN_CLUSTER edge pointing to it.  
     - Suggested path: `apps/metadata-api/src/brain/clustersRegistry.test.ts`.

2) ClusterBuilder groups seeded work/doc nodes into clusters  
   - Type: integration  
   - Evidence:  
     - A test seeds CDM work items and doc items for a single tenantId+projectKey,
       and ensures the Brain vector index has entries for them using the existing
       profiles (fake embeddings allowed).  
     - The test runs ClusterBuilder.buildClustersForProject with that tenantId,
       projectKey, and a small window.  
     - Queries against KG/GraphStore or ClusterRead show:  
       - at least one cluster node,  
       - the cluster has memberNodeIds that include both work and doc nodes.  
     - Suggested path: `apps/metadata-api/src/brain/clustersBuild.test.ts`.

3) Cluster building is idempotent  
   - Type: integration  
   - Evidence:  
     - A test seeds the same data as AC2.  
     - It calls ClusterBuilder.buildClustersForProject twice with identical args.  
     - After both runs, KG/GraphStore is queried to assert that:  
       - the count of "kg.cluster" nodes remains stable (no duplicates),  
       - for a representative member nodeId, there is exactly one IN_CLUSTER
         edge to a given cluster node.  
     - Suggested path: `apps/metadata-api/src/brain/clustersIdempotency.test.ts`.

4) Clusters and members are retrievable for a given work item  
   - Type: integration|e2e  
   - Evidence:  
     - After seeding and running ClusterBuilder as in AC2, the test uses
       ClusterRead.listClustersForProject (or an equivalent KG helper) to fetch
       cluster information for the test tenantId+projectKey.  
     - Given a specific work item nodeId, the test asserts that:  
       - that nodeId appears in some cluster's memberNodeIds,  
       - the clusterNodeId is a "kg.cluster" node in KG,  
       - memberNodeIds for that cluster include at least one other related node
         (e.g., a doc node).  
     - Suggested path: `apps/metadata-api/src/brain/clustersRead.test.ts`.
