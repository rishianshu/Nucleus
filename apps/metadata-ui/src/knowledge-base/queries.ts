export const KB_NODES_QUERY = `
  query KbNodes($type: String, $scope: GraphScopeInput, $search: String, $first: Int!, $after: ID) {
    kbNodes(type: $type, scope: $scope, search: $search, first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          entityType
          displayName
          canonicalPath
          phase
          updatedAt
          scope {
            orgId
            projectId
            domainId
            teamId
          }
          identity {
            logicalKey
            originEndpointId
            originVendor
            externalId
            phase
            provenance
          }
          provenance
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      totalCount
    }
  }
`;

export const KB_EDGES_QUERY = `
  query KbEdges($edgeType: String, $scope: GraphScopeInput, $sourceId: ID, $targetId: ID, $first: Int!, $after: ID) {
    kbEdges(edgeType: $edgeType, scope: $scope, sourceId: $sourceId, targetId: $targetId, first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          edgeType
          sourceEntityId
          targetEntityId
          confidence
          updatedAt
          scope {
            orgId
            projectId
            domainId
            teamId
          }
          identity {
            logicalKey
            sourceLogicalKey
            targetLogicalKey
            originEndpointId
            originVendor
          }
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      totalCount
    }
  }
`;

export const KB_FACETS_QUERY = `
  query KbFacets($scope: GraphScopeInput) {
    kbFacets(scope: $scope) {
      nodeTypes {
        value
        label
        count
      }
      edgeTypes {
        value
        label
        count
      }
      projects {
        value
        label
        count
      }
      domains {
        value
        label
        count
      }
      teams {
        value
        label
        count
      }
    }
  }
`;

export const KB_NODE_DETAIL_QUERY = `
  query KbNodeDetail($id: ID!) {
    kbNode(id: $id) {
      id
      entityType
      displayName
      canonicalPath
      phase
      updatedAt
      identity {
        logicalKey
        originEndpointId
        originVendor
        externalId
        provenance
      }
      scope {
        orgId
        projectId
        domainId
        teamId
      }
      provenance
    }
  }
`;

export const KB_SCENE_QUERY = `
  query KbScene($id: ID!, $edgeTypes: [String!], $depth: Int!, $limit: Int!) {
    kbScene(id: $id, edgeTypes: $edgeTypes, depth: $depth, limit: $limit) {
      nodes {
        id
        entityType
        displayName
        canonicalPath
        updatedAt
        identity {
          logicalKey
        }
      }
      edges {
        id
        edgeType
        sourceEntityId
        targetEntityId
        identity {
          logicalKey
        }
      }
      summary {
        nodeCount
        edgeCount
        truncated
      }
    }
  }
`;
