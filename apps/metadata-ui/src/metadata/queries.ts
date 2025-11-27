export const METADATA_OVERVIEW_QUERY = `
  query DesignerMetadataOverview($projectSlug: String, $collectionsFirst: Int = 200) {
    endpoints(projectSlug: $projectSlug) {
      id
      sourceId
      name
      description
      verb
      url
      authPolicy
      domain
      labels
      config
      detectedVersion
      versionHint
      capabilities
      deletedAt
      deletionReason
      isDeleted
      runs(limit: 5) {
        id
        status
        requestedAt
        completedAt
        error
      }
    }
    collections(first: $collectionsFirst) {
      id
      endpointId
      scheduleCron
      scheduleTimezone
      isEnabled
      temporalScheduleId
      createdAt
      updatedAt
    }
  }
`;

export const METADATA_ENDPOINTS_PAGED_QUERY = `
  query MetadataEndpointsPaged($projectSlug: String, $search: String, $first: Int!, $after: ID) {
    endpoints(projectSlug: $projectSlug, search: $search, first: $first, after: $after) {
      id
      sourceId
      name
      description
      verb
      url
      authPolicy
      domain
      labels
      config
      detectedVersion
      versionHint
      capabilities
      deletedAt
      deletionReason
      isDeleted
      runs(limit: 5) {
        id
        status
        requestedAt
        completedAt
        error
      }
    }
  }
`;

export const GRAPH_NODES_QUERY = `
  query GraphNodes($search: String, $entityTypes: [String!], $limit: Int!) {
    graphNodes(filter: { search: $search, entityTypes: $entityTypes, limit: $limit }) {
      id
      entityType
      displayName
      canonicalPath
      identity {
        logicalKey
        originEndpointId
        originVendor
      }
      scope {
        orgId
        projectId
        domainId
        teamId
      }
    }
  }
`;

export const CATALOG_DATASETS_CONNECTION_QUERY = `
  query MetadataCatalogDatasets($first: Int!, $after: ID, $endpointId: ID, $search: String, $labels: [String!], $unlabeledOnly: Boolean) {
    catalogDatasetConnection(first: $first, after: $after, endpointId: $endpointId, search: $search, labels: $labels, unlabeledOnly: $unlabeledOnly) {
      nodes {
        id
        upstreamId
        displayName
        description
        labels
        schema
        entity
        collectedAt
        sourceEndpointId
        lastCollectionRun {
          id
          status
          requestedAt
          completedAt
        }
        sourceEndpoint {
          id
          name
          capabilities
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

export const METADATA_CATALOG_DATASET_QUERY = `
  query MetadataDatasetDetail($id: ID!) {
    metadataDataset(id: $id) {
      id
      upstreamId
      displayName
      description
      labels
      schema
      entity
      collectedAt
      sourceEndpointId
      fields {
        name
        type
        description
      }
      sampleRows
      statistics
      profile {
        recordCount
        sampleSize
        lastProfiledAt
        raw
      }
      lastCollectionRun {
        id
        status
        requestedAt
        completedAt
        error
      }
      ingestionConfig {
        id
        unitId
        enabled
        runMode
        mode
      sinkId
      sinkEndpointId
      scheduleKind
      scheduleIntervalMinutes
      lastStatus {
          state
          lastRunAt
          lastRunId
          lastError
        }
      }
      sourceEndpoint {
        id
        name
        capabilities
      }
    }
  }
`;

export const COLLECTION_RUNS_QUERY = `
  query DesignerCollectionRuns($filter: MetadataCollectionRunFilter, $first: Int) {
    collectionRuns(filter: $filter, first: $first) {
      id
      collectionId
      status
      requestedAt
      requestedBy
      startedAt
      completedAt
      error
      filters
      endpoint {
        id
        name
        isDeleted
      }
      collection {
        id
        endpointId
      }
    }
  }
`;

export const METADATA_ENDPOINT_TEMPLATES_QUERY = `
  query DesignerMetadataEndpointTemplates {
    endpointTemplates {
      id
      family
      title
      vendor
      description
      domain
      categories
      protocols
      versions
      descriptorVersion
      minVersion
      maxVersion
      defaultPort
      driver
      docsUrl
      agentPrompt
      defaultLabels
      fields {
        key
        label
        required
        valueType
        semantic
        description
        placeholder
        helpText
        options { label value description }
        regex
        min
        max
        defaultValue
        advanced
        sensitive
        dependsOn
        dependsValue
        visibleWhen { field values }
      }
      capabilities { key label description }
      sampleConfig
      connection { urlTemplate defaultVerb }
      probing {
        fallbackMessage
        methods {
          key
          label
          strategy
          statement
          description
          requires
          returnsVersion
          returnsCapabilities
        }
      }
    }
  }
`;

export const INGESTION_ENDPOINTS_QUERY = `
  query IngestionEndpoints($projectSlug: String, $search: String, $first: Int = 100) {
    endpoints(projectSlug: $projectSlug, search: $search, first: $first) {
      id
      sourceId
      name
      description
      domain
      labels
      capabilities
      config
    }
  }
`;

export const INGESTION_UNITS_WITH_STATUS_QUERY = `
  query IngestionUnitsWithStatus($endpointId: ID!) {
    ingestionUnits(endpointId: $endpointId) {
      endpointId
      unitId
      datasetId
      kind
      displayName
      stats
      driverId
      sinkId
      defaultMode
      supportedModes
      defaultPolicy
      defaultScheduleKind
      defaultScheduleIntervalMinutes
      cdmModelId
    }
    ingestionStatuses(endpointId: $endpointId) {
      endpointId
      unitId
      sinkId
      state
      lastRunId
      lastRunAt
      lastError
      stats
      checkpoint
    }
    ingestionUnitConfigs(endpointId: $endpointId) {
      id
      endpointId
      datasetId
      unitId
      enabled
      runMode
      mode
      sinkId
      sinkEndpointId
      scheduleKind
      scheduleIntervalMinutes
      policy
      lastStatus {
        state
        lastRunAt
        lastRunId
        lastError
      }
    }
    ingestionSinks {
      id
      supportedCdmModels
    }
  }
`;

export const START_INGESTION_MUTATION = `
  mutation StartIngestion($endpointId: ID!, $unitId: ID!, $sinkId: String) {
    startIngestion(endpointId: $endpointId, unitId: $unitId, sinkId: $sinkId) {
      ok
      runId
      state
      message
    }
  }
`;

export const PAUSE_INGESTION_MUTATION = `
  mutation PauseIngestion($endpointId: ID!, $unitId: ID!, $sinkId: String) {
    pauseIngestion(endpointId: $endpointId, unitId: $unitId, sinkId: $sinkId) {
      ok
      state
      message
    }
  }
`;

export const RESET_INGESTION_CHECKPOINT_MUTATION = `
  mutation ResetIngestionCheckpoint($endpointId: ID!, $unitId: ID!, $sinkId: String) {
    resetIngestionCheckpoint(endpointId: $endpointId, unitId: $unitId, sinkId: $sinkId) {
      ok
      state
      message
    }
  }
`;

export const CONFIGURE_INGESTION_UNIT_MUTATION = `
  mutation ConfigureIngestionUnit($input: IngestionUnitConfigInput!) {
    configureIngestionUnit(input: $input) {
      id
      endpointId
      datasetId
      unitId
      enabled
      runMode
      mode
      sinkId
      scheduleKind
      scheduleIntervalMinutes
      policy
      lastStatus {
        state
        lastRunAt
        lastRunId
        lastError
      }
    }
  }
`;

export const REGISTER_METADATA_ENDPOINT_MUTATION = `
  mutation DesignerRegisterMetadataEndpoint($input: EndpointInput!) {
    registerEndpoint(input: $input) {
      id
    }
  }
`;

export const UPDATE_METADATA_ENDPOINT_MUTATION = `
  mutation DesignerUpdateMetadataEndpoint($id: ID!, $patch: EndpointPatch!) {
    updateEndpoint(id: $id, patch: $patch) {
      id
      name
      description
      labels
      capabilities
      detectedVersion
      versionHint
    }
  }
`;

export const TRIGGER_ENDPOINT_COLLECTION_MUTATION = `
  mutation DesignerTriggerEndpointCollection($endpointId: ID!, $filters: JSON, $schemaOverride: [String!]) {
    triggerEndpointCollection(endpointId: $endpointId, filters: $filters, schemaOverride: $schemaOverride) {
      id
      status
      collectionId
      error
    }
  }
`;

export const TEST_METADATA_ENDPOINT_MUTATION = `
  mutation DesignerTestMetadataEndpoint($input: TestEndpointInput!) {
    testEndpoint(input: $input) {
      ok
      diagnostics {
        level
        code
        message
        hint
        field
      }
    }
  }
`;

export const DELETE_METADATA_ENDPOINT_MUTATION = `
  mutation DesignerDeleteMetadataEndpoint($id: ID!) {
    deleteEndpoint(id: $id)
  }
`;

export const PREVIEW_METADATA_DATASET_MUTATION = `
  mutation DesignerPreviewMetadataDataset($id: ID!, $limit: Int) {
    previewMetadataDataset(id: $id, limit: $limit) {
      sampledAt
      rows
    }
  }
`;

export const ENDPOINT_DATASETS_QUERY = `
  query DesignerEndpointDatasets($endpointId: ID!) {
    endpointDatasets(endpointId: $endpointId) {
      id
      projectId
      domain
      labels
      payload
      createdAt
      updatedAt
    }
  }
`;
