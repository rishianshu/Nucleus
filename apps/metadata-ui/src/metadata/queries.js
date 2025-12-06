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
      delegatedConnected
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
      delegatedConnected
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
      jiraFilter {
        projectKeys
        statuses
        assigneeIds
        updatedFrom
      }
      confluenceFilter {
        spaceKeys
        updatedFrom
      }
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
      jiraFilter {
        projectKeys
        statuses
        assigneeIds
        updatedFrom
      }
      confluenceFilter {
        spaceKeys
        updatedFrom
      }
      lastStatus {
        state
        lastRunAt
        lastRunId
        lastError
      }
    }
  }
`;
export const JIRA_FILTER_OPTIONS_QUERY = `
  query JiraFilterOptions($endpointId: ID!) {
    jiraIngestionFilterOptions(endpointId: $endpointId) {
      projects {
        key
        name
      }
      statuses {
        id
        name
        category
      }
      users {
        accountId
        displayName
        email
      }
    }
  }
`;
export const CONFLUENCE_FILTER_OPTIONS_QUERY = `
  query ConfluenceFilterOptions($endpointId: ID!) {
    confluenceIngestionFilterOptions(endpointId: $endpointId) {
      spaces {
        key
        name
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
export const START_ONEDRIVE_AUTH_MUTATION = `
  mutation StartOneDriveAuth($endpointId: ID!) {
    startOneDriveAuth(endpointId: $endpointId) {
      authSessionId
      authUrl
      state
    }
  }
`;
export const COMPLETE_ONEDRIVE_AUTH_MUTATION = `
  mutation CompleteOneDriveAuth($state: String!, $code: String) {
    completeOneDriveAuth(state: $state, code: $code) {
      ok
      endpointId
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
export const CATALOG_DATASET_PREVIEW_QUERY = `
  query DesignerCatalogDatasetPreview($id: ID!) {
    catalogDatasetPreview(id: $id) {
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
export const CDM_WORK_PROJECTS_QUERY = `
  query CdmWorkProjects {
    cdmWorkProjects {
      cdmId
      sourceSystem
      sourceProjectKey
      name
      description
      datasetId
      sourceEndpointId
      raw
    }
  }
`;
export const CDM_WORK_PROJECT_CONNECTION_QUERY = `
  query CdmWorkProjectConnection($filter: CdmWorkProjectFilter, $first: Int, $after: String) {
    cdmWorkProjectConnection(filter: $filter, first: $first, after: $after) {
      edges {
        cursor
        node {
          cdmId
          sourceSystem
          sourceProjectKey
          name
          description
          url
          datasetId
          sourceEndpointId
          raw
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;
export const CDM_WORK_ITEMS_QUERY = `
  query CdmWorkItems($filter: CdmWorkItemFilter, $first: Int, $after: String) {
    cdmWorkItems(filter: $filter, first: $first, after: $after) {
      edges {
        cursor
        node {
          cdmId
          sourceSystem
          sourceIssueKey
          projectCdmId
          summary
          status
          priority
          createdAt
          updatedAt
          closedAt
          reporter {
            cdmId
            displayName
            email
          }
          assignee {
            cdmId
            displayName
            email
          }
          datasetId
          sourceEndpointId
          raw
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;
export const CDM_WORK_COMMENTS_QUERY = `
  query CdmWorkComments($filter: CdmWorkCommentFilter, $first: Int, $after: String) {
    cdmWorkComments(filter: $filter, first: $first, after: $after) {
      edges {
        cursor
        node {
          cdmId
          sourceSystem
          itemCdmId
          parentIssueKey
          projectCdmId
          body
          createdAt
          updatedAt
          author {
            cdmId
            displayName
            email
          }
          datasetId
          sourceEndpointId
          raw
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;
export const CDM_WORK_LOGS_QUERY = `
  query CdmWorkLogs($filter: CdmWorkLogFilter, $first: Int, $after: String) {
    cdmWorkLogs(filter: $filter, first: $first, after: $after) {
      edges {
        cursor
        node {
          cdmId
          sourceSystem
          itemCdmId
          parentIssueKey
          projectCdmId
          startedAt
          timeSpentSeconds
          comment
          author {
            cdmId
            displayName
            email
          }
          datasetId
          sourceEndpointId
          raw
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;
export const CDM_WORK_DATASETS_QUERY = `
  query CdmWorkDatasets {
    cdmWorkDatasets {
      id
      datasetId
      label
      entityKind
      endpointId
      endpointName
    }
  }
`;
export const CDM_DOCS_DATASETS_QUERY = `
  query CdmDocsDatasets {
    cdmDocsDatasets {
      id
      datasetId
      name
      sourceSystem
      endpointId
      endpointName
    }
  }
`;
export const CDM_WORK_USERS_QUERY = `
  query CdmWorkUsers($filter: CdmWorkUserFilter, $first: Int, $after: String) {
    cdmWorkUsers(filter: $filter, first: $first, after: $after) {
      edges {
        cursor
        node {
          cdmId
          sourceSystem
          sourceUserId
          displayName
          email
          active
          datasetId
          sourceEndpointId
          raw
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;
export const CDM_WORK_ITEM_DETAIL_QUERY = `
  query CdmWorkItemDetail($cdmId: ID!) {
    cdmWorkItem(cdmId: $cdmId) {
      item {
        cdmId
        sourceSystem
        sourceIssueKey
        projectCdmId
        summary
        status
        priority
        createdAt
        updatedAt
        closedAt
        reporter {
          cdmId
          displayName
          email
        }
        assignee {
          cdmId
          displayName
          email
        }
        datasetId
        sourceEndpointId
        raw
      }
      comments {
        cdmId
        sourceSystem
        itemCdmId
        parentIssueKey
        projectCdmId
        body
        createdAt
        updatedAt
        author {
          cdmId
          displayName
          email
        }
        datasetId
        sourceEndpointId
        raw
      }
      worklogs {
        cdmId
        sourceSystem
        itemCdmId
        parentIssueKey
        projectCdmId
        startedAt
        timeSpentSeconds
        comment
        author {
          cdmId
          displayName
          email
        }
        datasetId
        sourceEndpointId
        raw
      }
    }
  }
`;
export const CDM_ENTITY_CONNECTION_QUERY = `
  query CdmEntities($filter: CdmEntityFilter!, $first: Int!, $after: String) {
    cdmEntities(filter: $filter, first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          domain
          sourceSystem
          cdmId
          title
          createdAt
          updatedAt
          state
          data
          docTitle
          docType
          docProjectKey
          docProjectName
          docLocation
          docUpdatedAt
          docSourceSystem
          docDatasetId
          docDatasetName
          docSourceEndpointId
          docUrl
          docContentExcerpt
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
	        startCursor
	        endCursor
	      }
	    }
	  }
	`;
export const CDM_ENTITY_QUERY = `
  query CdmEntity($id: ID!, $domain: CdmDomain!) {
    cdmEntity(id: $id, domain: $domain) {
      id
      domain
      sourceSystem
      cdmId
      title
      createdAt
      updatedAt
      state
      data
      docTitle
      docType
      docProjectKey
      docProjectName
      docLocation
      docUpdatedAt
      docSourceSystem
      docDatasetId
      docDatasetName
      docSourceEndpointId
      docUrl
      docContentExcerpt
    }
  }
`;
