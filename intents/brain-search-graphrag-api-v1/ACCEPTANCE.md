# Acceptance Criteria

1) BrainSearch returns ranked hits from vector search with normalized filters  
   - Type: integration  
   - Evidence:  
     - Seed vector_index_entries for at least two nodeIds under one tenantId and
       two different projectKey values.  
     - Call brainSearch with tenantId + projectKey filter and assert:  
       - hits are non-empty, sorted by score desc,  
       - every hit respects tenantId and projectKey filter,  
       - every hit returns nodeId + profileId + profileKind + score.  
     - Test should use deterministic embedding provider stub.  

2) BrainSearch returns expanded KG subgraph around hits (GraphRAG context pack)  
   - Type: integration  
   - Evidence:  
     - Seed KG with at least:  
       - one cdm.work.item node, one cdm.doc.item node,  
       - one signal.instance node with HAS_SIGNAL edge from a member,  
       - IN_CLUSTER edges to a kg.cluster node.  
     - Ensure vector retrieval returns one of the seeded members as a hit.  
     - Call brainSearch with expandDepth=1 and assert:  
       - graphNodes contains the hit node and at least one neighbor node,  
       - graphEdges contains at least one expected edgeType (HAS_SIGNAL or IN_CLUSTER).  

3) BrainSearch returns episode candidates scored from hit membership  
   - Type: integration  
   - Evidence:  
     - Seed a kg.cluster node with IN_CLUSTER edges to at least two members.  
     - Ensure at least one member is returned as a hit.  
     - Call brainSearch with includeEpisodes=true and assert:  
       - episodes contains that clusterNodeId,  
       - episode.memberNodeIds include the expected members,  
       - score is > 0 and consistent with hit scores (sum of member hit scores or documented rule).  

4) BrainSearch returns deterministic promptPack (no LLM calls)  
   - Type: unit|integration  
   - Evidence:  
     - Call brainSearch twice with same seeded data and deterministic embedder.  
     - Assert promptPack.contextMarkdown is identical across calls.  
     - Assert citations JSON includes at least the hit nodeIds with urls/titles when available.  
     - Verify tests do not invoke any network embedding/LLM provider (stub enforced).  
