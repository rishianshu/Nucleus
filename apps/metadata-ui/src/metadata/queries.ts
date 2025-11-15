export const METADATA_OVERVIEW_QUERY = `
  query DesignerMetadataOverview($projectSlug: String) {
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
    }
  }
`;

export const METADATA_COLLECTION_RUNS_QUERY = `
  query DesignerMetadataCollectionRuns($runsLimit: Int) {
    metadataCollectionRuns(limit: $runsLimit) {
      id
      status
      requestedAt
      startedAt
      completedAt
      error
      endpoint {
        id
        name
        isDeleted
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

export const TRIGGER_METADATA_COLLECTION_MUTATION = `
  mutation DesignerTriggerMetadataCollection($endpointId: ID!, $filters: JSON, $schemaOverride: [String!]) {
    triggerCollection(endpointId: $endpointId, filters: $filters, schemaOverride: $schemaOverride) {
      id
      status
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
