# Acceptance Criteria

1) Brain episodes list API returns episodes for a tenant + project  
   - Type: integration  
   - Evidence:  
     - A test seeds clusters (kg.cluster nodes) with IN_CLUSTER edges and
       appropriate tenantId and projectKey properties, using existing
       ClusterBuilder/bridge helpers.  
     - The test calls the `brainEpisodes` GraphQL query (or equivalent Brain
       read API) with tenantId, projectKey, and optional window, and asserts:  
       - `nodes` is non-empty,  
       - each returned BrainEpisode has matching tenantId/projectKey,  
       - `totalCount` matches the number of clusters in KG for that scope.  
     - Suggested path: `apps/metadata-api/src/brain/brainEpisodesList.test.ts`
       or a GraphQL integration test.

2) Brain episode detail API returns cluster properties, members, and signals  
   - Type: integration  
   - Evidence:  
     - A test seeds at least one cluster with:  
       - multiple work/doc members,  
       - at least one SignalInstance attached to one of the members (via
         HAS_SIGNAL edge or equivalent).  
     - The test calls `brainEpisode` with tenantId, projectKey, and the cluster
       id returned from the list API.  
     - It asserts that:  
       - the returned BrainEpisode has the expected id, tenantId, projectKey,
         clusterKind, size, and timestamps,  
       - `members` includes the expected member nodeIds and their core metadata
         (e.g., workKey/docUrl),  
       - `signals` includes the expected signal with correct severity, status,
         and definitionSlug.  
     - Suggested path: `apps/metadata-api/src/brain/brainEpisodeDetail.test.ts`.

3) Access control and scoping enforce tenant boundaries  
   - Type: integration  
   - Evidence:  
     - A test seeds clusters for at least two tenants and/or projects.  
     - It calls `brainEpisodes` and `brainEpisode` with tenantId/projectKey for
       tenant A and verifies that:  
       - episodes belonging to tenant B or other projects are not returned,  
       - attempting to fetch a cluster from a different tenant/project by ID
         returns null or an authorization error (per existing conventions).  
     - Suggested path: `apps/metadata-api/src/brain/brainEpisodesAuth.test.ts`.

4) Episodes returned by Brain API are consistent with KG state  
   - Type: integration  
   - Evidence:  
     - A test uses ClusterBuilder to create clusters for a tenant/project and
       then calls `brainEpisodes` to fetch them.  
     - For each returned BrainEpisode, the test:  
       - checks that its `id` corresponds to a KG nodeType="kg.cluster" node,  
       - checks that `members.nodeId` match the set of nodes that have
         IN_CLUSTER edges to that cluster in GraphStore,  
       - verifies that any SignalIds exposed correspond to signal.instance nodes
         attached to those members (via HAS_SIGNAL).  
     - Suggested path: `apps/metadata-api/src/brain/brainEpisodesConsistency.test.ts`.
