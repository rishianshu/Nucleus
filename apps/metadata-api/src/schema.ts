import { randomUUID } from "node:crypto";
import { GraphQLScalarType, GraphQLError } from "graphql";
import { DateTimeResolver, JSONResolver } from "graphql-scalars";
import { ScheduleOverlapPolicy, WorkflowIdReusePolicy } from "@temporalio/client";
import type {
  MetadataStore,
  MetadataEndpointDescriptor,
  MetadataEndpointTemplateDescriptor,
  MetadataRecordInput,
  MetadataRecord,
  HttpVerb,
  GraphStore,
  TenantContext,
} from "@metadata/core";
import { resolveKbLabel, humanizeKbIdentifier } from "@metadata/client";
import type { EndpointBuildResult, EndpointTemplate, EndpointTestResult } from "./types.js";
import { getPrismaClient } from "./prismaClient.js";
import { getTemporalClient } from "./temporal/client.js";
import { WORKFLOW_NAMES } from "./temporal/workflows.js";
import { getGraphStore } from "./context.js";
import type { AuthContext } from "./auth.js";
import sampleMetadata from "./fixtures/sample-metadata.json" assert { type: "json" };
import { DEFAULT_ENDPOINT_TEMPLATES } from "./fixtures/default-endpoint-templates.js";

const CATALOG_DATASET_DOMAIN = process.env.METADATA_CATALOG_DOMAIN ?? "catalog.dataset";
const DEFAULT_PROJECT_ID = process.env.METADATA_DEFAULT_PROJECT ?? "global";
const ENABLE_SAMPLE_FALLBACK = process.env.METADATA_SAMPLE_FALLBACK !== "0";
const TEMPLATE_REFRESH_TIMEOUT_MS = Number(process.env.METADATA_TEMPLATE_REFRESH_TIMEOUT_MS ?? "5000");
const TEMPLATE_REFRESH_BACKOFF_MS = Number(process.env.METADATA_TEMPLATE_REFRESH_BACKOFF_MS ?? "30000");
const PLAYWRIGHT_INVALID_PASSWORD = "__PLAYWRIGHT_BAD_PASSWORD__";
const COLLECTION_SCHEDULE_PREFIX = "collection";
const COLLECTION_SCHEDULE_PAUSE_REASON = "collection disabled";
const KB_NODES_DEFAULT_PAGE_SIZE = 25;
const KB_NODES_MAX_PAGE_SIZE = 100;
const KB_EDGES_DEFAULT_PAGE_SIZE = 25;
const KB_EDGES_MAX_PAGE_SIZE = 100;
const KB_SCENE_NODE_CAP = 300;
const KB_SCENE_EDGE_CAP = 600;
const KB_SAMPLE_TIMESTAMP = "2024-01-01T00:00:00.000Z";
const KB_FACET_CACHE_TTL_MS = Number(process.env.KB_FACET_CACHE_TTL_MS ?? 15 * 60 * 1000);

type GraphQLKbFacetValue = {
  value: string;
  label: string;
  count: number;
};

type GraphQLKbFacets = {
  nodeTypes: GraphQLKbFacetValue[];
  edgeTypes: GraphQLKbFacetValue[];
  projects: GraphQLKbFacetValue[];
  domains: GraphQLKbFacetValue[];
  teams: GraphQLKbFacetValue[];
};

type KbFacetCacheEntry = { expiresAt: number; payload: GraphQLKbFacets };

const kbFacetCache = new Map<string, KbFacetCacheEntry>();

export const typeDefs = `#graphql
  scalar DateTime
  scalar JSON

  type Health {
    status: String!
    version: String!
  }

  type MetadataDomain {
    key: String!
    title: String!
    description: String
    itemCount: Int!
  }

  type MetadataRecord {
    id: ID!
    projectId: String!
    domain: String!
    labels: [String!]!
    payload: JSON!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type GraphScope {
    orgId: String!
    domainId: String
    projectId: String
    teamId: String
  }

  input GraphScopeInput {
    orgId: String
    domainId: String
    projectId: String
    teamId: String
  }

  type GraphIdentity {
    logicalKey: String!
    externalId: JSON
    originEndpointId: ID
    originVendor: String
    phase: String
    provenance: JSON
    sourceLogicalKey: String
    targetLogicalKey: String
  }

  type GraphNode {
    id: ID!
    tenantId: String!
    projectId: String
    entityType: String!
    displayName: String!
    canonicalPath: String
    sourceSystem: String
    specRef: String
    properties: JSON!
    version: Int!
    phase: String
    scope: GraphScope!
    identity: GraphIdentity!
    provenance: JSON
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type GraphEdge {
    id: ID!
    tenantId: String!
    projectId: String
    edgeType: String!
    sourceEntityId: ID!
    targetEntityId: ID!
    confidence: Float
    specRef: String
    metadata: JSON!
    scope: GraphScope!
    identity: GraphIdentity!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type KbNodeEdge {
    cursor: ID!
    node: GraphNode!
  }

  type KbNodeConnection {
    edges: [KbNodeEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type KbEdgeEdge {
    cursor: ID!
    node: GraphEdge!
  }

  type KbEdgeConnection {
    edges: [KbEdgeEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type KbSceneSummary {
    nodeCount: Int!
    edgeCount: Int!
    truncated: Boolean!
  }

  type KbScene {
    nodes: [GraphNode!]!
    edges: [GraphEdge!]!
    summary: KbSceneSummary!
  }

  type KbFacetValue {
    value: String!
    label: String!
    count: Int!
  }

  type KbFacets {
    nodeTypes: [KbFacetValue!]!
    edgeTypes: [KbFacetValue!]!
    projects: [KbFacetValue!]!
    domains: [KbFacetValue!]!
    teams: [KbFacetValue!]!
  }

  input GraphNodeFilter {
    entityTypes: [String!]
    search: String
    limit: Int
  }

  input GraphEdgeFilter {
    edgeTypes: [String!]
    sourceEntityId: ID
    targetEntityId: ID
    limit: Int
  }

  input MetadataRecordInput {
    id: ID
    projectId: String!
    domain: String!
    labels: [String!]
    payload: JSON!
  }

  type MetadataEndpoint {
    id: ID!
    sourceId: String!
    projectId: String
    name: String!
    description: String
    verb: String!
    url: String!
    authPolicy: String
    domain: String
    labels: [String!]
    config: JSON
    detectedVersion: String
    versionHint: String
    capabilities: [String!]
    createdAt: DateTime
    updatedAt: DateTime
    deletedAt: DateTime
    deletionReason: String
    isDeleted: Boolean!
    runs(limit: Int): [MetadataCollectionRun!]!
    datasets(limit: Int, search: String): [CatalogDataset!]!
  }

  input MetadataEndpointInput {
    id: ID
    sourceId: String
    projectId: String
    name: String!
    description: String
    verb: String
    url: String
    authPolicy: String
    domain: String
    labels: [String!]
    config: JSON
  }

  input EndpointInput {
    projectSlug: String
    sourceId: String
    name: String!
    description: String
    verb: String!
    url: String
    authPolicy: String
    domain: String
    labels: [String!]
    config: JSON
    capabilities: [String!]
  }

  input EndpointPatch {
    name: String
    description: String
    verb: String
    url: String
    authPolicy: String
    domain: String
    labels: [String!]
    config: JSON
    capabilities: [String!]
  }

  input TestEndpointInput {
    templateId: String!
    type: String!
    connection: JSON!
    capabilities: [String!]
  }

  type CatalogDatasetField {
    name: String!
    type: String!
    description: String
  }

  type CatalogDatasetProfile {
    recordCount: Int
    sampleSize: Int
    lastProfiledAt: DateTime
    raw: JSON
  }

  type CatalogDatasetPreview {
    sampledAt: DateTime!
    rows: [JSON!]!
  }

  type CatalogDataset {
    id: ID!
    upstreamId: String
    displayName: String!
    description: String
    source: String
    projectIds: [String!]
    labels: [String!]
    schema: String
    entity: String
    collectedAt: DateTime
    sourceEndpointId: ID
    sourceEndpoint: MetadataEndpoint
    profile: CatalogDatasetProfile
    sampleRows: [JSON!]
    statistics: JSON
    fields: [CatalogDatasetField!]!
    lastCollectionRun: MetadataCollectionRun
  }

  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: ID
    endCursor: ID
  }

  type CatalogDatasetEdge {
    cursor: ID!
    node: CatalogDataset!
  }

  type CatalogDatasetConnection {
    nodes: [CatalogDataset!]!
    edges: [CatalogDatasetEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type Diagnostic {
    level: String!
    code: String!
    message: String!
    hint: String
    field: String
  }

  type TestResult {
    ok: Boolean!
    diagnostics: [Diagnostic!]!
  }

  enum MetadataCollectionStatus {
    QUEUED
    RUNNING
    SUCCEEDED
    FAILED
    SKIPPED
  }

  type MetadataCollectionRun {
    id: ID!
    collectionId: ID
    collection: MetadataCollection
    endpointId: ID!
    endpoint: MetadataEndpoint!
    status: MetadataCollectionStatus!
    requestedBy: String
    requestedAt: DateTime!
    startedAt: DateTime
    completedAt: DateTime
    workflowId: String
    temporalRunId: String
    error: String
    filters: JSON
  }

  type MetadataCollection {
    id: ID!
    endpointId: ID!
    endpoint: MetadataEndpoint!
    scheduleCron: String
    scheduleTimezone: String
    isEnabled: Boolean!
    temporalScheduleId: String
    createdAt: DateTime!
    updatedAt: DateTime!
    runs(first: Int = 25, after: ID): [MetadataCollectionRun!]!
  }

  input MetadataCollectionRunFilter {
    endpointId: ID
    collectionId: ID
    status: MetadataCollectionStatus
    from: DateTime
    to: DateTime
  }

  input CollectionCreateInput {
    endpointId: ID!
    scheduleCron: String
    scheduleTimezone: String = "UTC"
    isEnabled: Boolean = true
  }

  input CollectionUpdateInput {
    scheduleCron: String
    scheduleTimezone: String
    isEnabled: Boolean
  }

  input MetadataCollectionRequestInput {
    endpointId: ID!
    schemas: [String!]
  }

  enum MetadataEndpointFamily {
    JDBC
    HTTP
    STREAM
  }

  enum MetadataEndpointFieldValueType {
    STRING
    PASSWORD
    NUMBER
    BOOLEAN
    URL
    HOSTNAME
    PORT
    JSON
    ENUM
    LIST
    TEXT
  }

  enum MetadataEndpointFieldSemantic {
    HOST
    PORT
    DATABASE
    USERNAME
    PASSWORD
    API_TOKEN
    PROJECT
    SCHEMA
    TABLE
    WAREHOUSE
    ROLE
    ENVIRONMENT
    CLUSTER
    TOPIC
    GENERIC
    FILE_PATH
  }

  type MetadataEndpointRequirementOption {
    label: String!
    value: String!
    description: String
  }

  type MetadataEndpointField {
    key: String!
    label: String!
    required: Boolean!
    valueType: MetadataEndpointFieldValueType!
    semantic: MetadataEndpointFieldSemantic
    description: String
    placeholder: String
    helpText: String
    options: [MetadataEndpointRequirementOption!]
    regex: String
    min: Int
    max: Int
    defaultValue: String
    advanced: Boolean
    sensitive: Boolean
    dependsOn: String
    dependsValue: String
    visibleWhen: [MetadataEndpointFieldVisibilityRule!]
  }

  type MetadataEndpointFieldVisibilityRule {
    field: String!
    values: [String!]!
  }

  type MetadataEndpointCapability {
    key: String!
    label: String!
    description: String
  }

  type MetadataEndpointConnection {
    urlTemplate: String
    defaultVerb: String
  }

  type MetadataEndpointTemplate {
    id: ID!
    family: MetadataEndpointFamily!
    title: String!
    vendor: String!
    description: String
    domain: String
    categories: [String!]!
    protocols: [String!]!
    versions: [String!]!
    defaultPort: Int
    driver: String
    docsUrl: String
    agentPrompt: String
    defaultLabels: [String!]
    fields: [MetadataEndpointField!]!
    capabilities: [MetadataEndpointCapability!]!
    sampleConfig: JSON
    connection: MetadataEndpointConnection
    descriptorVersion: String
    minVersion: String
    maxVersion: String
    probing: MetadataEndpointProbingPlan
  }

  type MetadataEndpointProbingPlan {
    methods: [MetadataEndpointProbingMethod!]!
    fallbackMessage: String
  }

  type MetadataEndpointProbingMethod {
    key: String!
    label: String!
    strategy: String!
    statement: String
    description: String
    requires: [String!]
    returnsVersion: Boolean
    returnsCapabilities: [String!]
  }

  type MetadataEndpointTestResult {
    success: Boolean!
    message: String
    detectedVersion: String
    capabilities: [String!]
    details: JSON
  }

  type Query {
    health: Health!
    metadataDomains: [MetadataDomain!]!
    metadataRecords(domain: String!, projectId: String, labels: [String!], search: String, limit: Int): [MetadataRecord!]!
    graphNodes(filter: GraphNodeFilter): [GraphNode!]!
    graphEdges(filter: GraphEdgeFilter): [GraphEdge!]!
    kbNodes(type: String, scope: GraphScopeInput, search: String, first: Int = 25, after: ID): KbNodeConnection!
    kbEdges(edgeType: String, scope: GraphScopeInput, sourceId: ID, targetId: ID, first: Int = 25, after: ID): KbEdgeConnection!
    kbNode(id: ID!): GraphNode
    kbNeighbors(id: ID!, edgeTypes: [String!], depth: Int = 2, limit: Int = 300): KbScene!
    kbScene(id: ID!, edgeTypes: [String!], depth: Int = 2, limit: Int = 300): KbScene!
    kbFacets(scope: GraphScopeInput): KbFacets!
    metadataEndpoints(projectId: String, includeDeleted: Boolean): [MetadataEndpoint!]!
    metadataEndpoint(id: ID!): MetadataEndpoint
    catalogDatasets(projectId: String, labels: [String!], search: String, endpointId: ID, unlabeledOnly: Boolean): [CatalogDataset!]!
    catalogDatasetConnection(projectId: String, labels: [String!], search: String, endpointId: ID, unlabeledOnly: Boolean, first: Int = 25, after: ID): CatalogDatasetConnection!
    metadataDataset(id: ID!): CatalogDataset
    metadataCollectionRuns(filter: MetadataCollectionRunFilter, limit: Int): [MetadataCollectionRun!]!
    collections(endpointId: ID, isEnabled: Boolean, first: Int = 50, after: ID): [MetadataCollection!]!
    collection(id: ID!): MetadataCollection
    collectionRuns(filter: MetadataCollectionRunFilter, first: Int = 50, after: ID): [MetadataCollectionRun!]!
    metadataEndpointTemplates(family: MetadataEndpointFamily): [MetadataEndpointTemplate!]!
    endpoints(projectSlug: String, capability: String, search: String, first: Int = 50, after: ID): [MetadataEndpoint!]!
    endpoint(id: ID!): MetadataEndpoint
    endpointBySourceId(sourceId: String!): MetadataEndpoint
    endpointDatasets(endpointId: ID!, domain: String, projectSlug: String, first: Int = 100, after: ID): [MetadataRecord!]!
    endpointTemplates(family: MetadataEndpointFamily): [MetadataEndpointTemplate!]!
  }

  type Mutation {
    upsertMetadataRecord(input: MetadataRecordInput!): MetadataRecord!
    registerMetadataEndpoint(input: MetadataEndpointInput!): MetadataEndpoint!
    deleteMetadataEndpoint(id: ID!, reason: String): MetadataEndpoint!
    triggerMetadataCollection(input: MetadataCollectionRequestInput!): MetadataCollectionRun!
    testMetadataEndpoint(input: MetadataEndpointInput!): MetadataEndpointTestResult!
    previewMetadataDataset(id: ID!, limit: Int): CatalogDatasetPreview!
    testEndpoint(input: TestEndpointInput!): TestResult!
    registerEndpoint(input: EndpointInput!): MetadataEndpoint!
    updateEndpoint(id: ID!, patch: EndpointPatch!): MetadataEndpoint!
    deleteEndpoint(id: ID!): Boolean!
    createCollection(input: CollectionCreateInput!): MetadataCollection!
    updateCollection(id: ID!, input: CollectionUpdateInput!): MetadataCollection!
    deleteCollection(id: ID!): Boolean!
    triggerCollection(collectionId: ID!, filters: JSON, schemaOverride: [String!]): MetadataCollectionRun!
    triggerEndpointCollection(endpointId: ID!, filters: JSON, schemaOverride: [String!]): MetadataCollectionRun!
  }
`;

export function createResolvers(store: MetadataStore, options?: { graphStore?: GraphStore }) {
  const resolveGraphStore = async () => options?.graphStore ?? (await getGraphStore());
  const registerEndpointWithInput = async (
    input: GraphQLMetadataEndpointInput,
    ctx: ResolverContext,
    options?: { skipConnectionTest?: boolean },
  ) => {
    let templateId: string | null = null;
    try {
      templateId = parseTemplateId(input.config);
      let built: EndpointBuildResult | null | undefined = undefined;
      let testResult: EndpointTestResult | null = null;
      let templateParameters: Record<string, string> = {};
      let shouldBuildFromTemplate = Boolean(templateId);
      if (templateId && ctx.bypassWrites) {
        shouldBuildFromTemplate = false;
        templateParameters = parseTemplateParameters(input.config);
        testResult = { success: true } as EndpointTestResult;
      }
      const skipConnectionTest = Boolean(options?.skipConnectionTest);
      if (templateId && !ctx.bypassWrites && !skipConnectionTest) {
        templateParameters = parseTemplateParameters(input.config);
        const forcedInvalidCredentials = hasPlaywrightInvalidCredentialsFromParameters(templateParameters);
        if (forcedInvalidCredentials && !ctx.bypassWrites) {
          throw new GraphQLError("Connection test failed. Re-run test before saving.", {
            extensions: { code: "E_CONN_TEST_FAILED" },
          });
        }
        const { client, taskQueue } = await getTemporalClient();
        built = await client.workflow.execute(WORKFLOW_NAMES.buildEndpointConfig, {
          taskQueue,
          workflowId: `metadata-endpoint-build-${randomUUID()}`,
          args: [{ templateId, parameters: templateParameters, extras: { labels: input.labels ?? undefined } }],
        });
        testResult = await tryTestEndpointTemplate(client, taskQueue, templateId, templateParameters);
        if (!testResult || !testResult.success) {
          throw new GraphQLError("Connection test failed. Re-run test before saving.", {
            extensions: { code: "E_CONN_TEST_FAILED" },
          });
        }
      } else if (templateId && skipConnectionTest && !testResult) {
        templateParameters = parseTemplateParameters(input.config);
        testResult = { success: true } as EndpointTestResult;
      }

      if (!built && shouldBuildFromTemplate && templateId) {
        built = await buildFallbackEndpointConfig(store, templateId, templateParameters);
      }
      const url = built?.url ?? input.url;
      if (!url) {
        throw new Error("Endpoint URL is required.");
      }
      const versionHint = extractVersionHint(templateParameters) ?? extractVersionHintFromConfig(input.config) ?? undefined;
      const detectedVersion = testResult?.detectedVersion ?? undefined;
      const requestedCapabilities = Array.isArray(input.capabilities)
        ? input.capabilities.filter((capability) => typeof capability === "string")
        : [];
      const resolvedCapabilities =
        requestedCapabilities.length > 0
          ? requestedCapabilities
          : testResult?.capabilities && testResult.capabilities.length > 0
            ? testResult.capabilities
            : ["metadata"];

      const descriptor: MetadataEndpointDescriptor = {
        id: input.id ?? undefined,
        sourceId: input.sourceId ?? undefined,
        name: input.name,
        description: input.description ?? undefined,
        verb: ((input.verb as HttpVerb | undefined) ?? built?.verb ?? "POST") as HttpVerb,
        url,
        authPolicy: input.authPolicy ?? undefined,
        projectId: input.projectId ?? ctx.auth.projectId ?? undefined,
        domain: input.domain ?? built?.domain ?? undefined,
        labels: built?.labels ?? input.labels ?? undefined,
        config: built?.config ?? input.config ?? undefined,
        detectedVersion,
        versionHint,
        capabilities: resolvedCapabilities,
        deletedAt: null,
        deletionReason: undefined,
      };
      if (descriptor.sourceId) {
        const existing = await store.listEndpoints(descriptor.projectId ?? ctx.auth.projectId ?? undefined);
        const duplicate = existing.find(
          (endpoint) => endpoint.sourceId === descriptor.sourceId && endpoint.id !== descriptor.id,
        );
        if (duplicate) {
          throw new GraphQLError("Duplicate sourceId detected for this project.", {
            extensions: { code: "E_DUPLICATE_SOURCE_ID", sourceId: descriptor.sourceId },
          });
        }
      }

      const saved = await store.registerEndpoint(descriptor);
      const endpointId = saved.id ?? descriptor.id;
      if (!endpointId) {
        throw new GraphQLError("Endpoint registration failed (missing identifier).", {
          extensions: { code: "E_ENDPOINT_NOT_FOUND" },
        });
      }
      const prisma = await getPrismaClient();
      const defaultCollection = await ensureDefaultCollectionForEndpoint(prisma, endpointId);
      if (!ctx.bypassWrites) {
        await syncCollectionSchedule(prisma, defaultCollection);
        await triggerCollectionForEndpoint(ctx, store, endpointId, {
          reason: "register",
          descriptor: saved,
          collection: defaultCollection,
        });
      }
      emitMetadataMetric("metadata.endpoint.register.success", {
        endpointId: saved.id,
        templateId,
        detectedVersion: saved.detectedVersion ?? null,
        capabilities: saved.capabilities ?? [],
      });
      return saved;
    } catch (error) {
      emitMetadataMetric(
        "metadata.endpoint.register.failures",
        {
          templateId,
          message: error instanceof Error ? error.message : String(error),
        },
        "error",
      );
      throw error;
    }
  };
  let lastTemplateRefreshFailureAt = 0;
  let fallbackTemplatesSeeded = false;
  const fetchEndpointTemplates = async (family?: "JDBC" | "HTTP" | "STREAM") => {
    let cached = (await store.listEndpointTemplates(family)) as unknown as EndpointTemplate[];
    const useCachedOrFallback = async () => {
      if (cached.length > 0) {
        return filterTemplatesByFamily(cached, family);
      }
      if (!fallbackTemplatesSeeded) {
        await store.saveEndpointTemplates(
          DEFAULT_ENDPOINT_TEMPLATES as unknown as MetadataEndpointTemplateDescriptor[],
        );
        fallbackTemplatesSeeded = true;
      }
      const fallback = filterTemplatesByFamily(DEFAULT_ENDPOINT_TEMPLATES as EndpointTemplate[], family);
      if (fallback.length > 0) {
        cached = fallback;
      }
      return fallback;
    };
    const now = Date.now();
    if (cached.length > 0 && now - lastTemplateRefreshFailureAt < TEMPLATE_REFRESH_BACKOFF_MS) {
      return filterTemplatesByFamily(cached, family);
    }
    try {
      const { client, taskQueue } = await getTemporalClient();
      const templates = await withTimeout(
        client.workflow.execute(WORKFLOW_NAMES.listEndpointTemplates, {
          taskQueue,
          workflowId: `metadata-endpoint-templates-${randomUUID()}`,
          args: [{ family }],
        }),
        TEMPLATE_REFRESH_TIMEOUT_MS,
        "metadata.endpointTemplates.refresh",
      );
      if (Array.isArray(templates) && templates.length > 0) {
        await store.saveEndpointTemplates(
          templates.map((template) => template as unknown as MetadataEndpointTemplateDescriptor),
        );
        return filterTemplatesByFamily(templates as EndpointTemplate[], family);
      }
      return useCachedOrFallback();
    } catch (error) {
      lastTemplateRefreshFailureAt = Date.now();
      console.warn("[metadata.endpointTemplates] refresh failed; using cached descriptors if available", error);
      return useCachedOrFallback();
    }
  };
  const listCollectionRunsForProject = async (
    ctx: ResolverContext,
    args: { filter?: MetadataCollectionRunFilter | null; limit?: number | null; after?: string | null },
  ) => {
    enforceReadAccess(ctx);
    const prisma = await getPrismaClient();
    const projectRowId = await resolveProjectRecordId(prisma, ctx.auth.projectId);
    const take = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const pagination = args.after
      ? {
          cursor: { id: args.after },
          skip: 1,
        }
      : {};
    const requestedAtFilter =
      args.filter?.from || args.filter?.to
        ? {
            ...(args.filter?.from ? { gte: new Date(args.filter.from) } : {}),
            ...(args.filter?.to ? { lte: new Date(args.filter.to) } : {}),
          }
        : undefined;
    const runs = await prisma.metadataCollectionRun.findMany({
      where: {
        endpointId: args.filter?.endpointId ?? undefined,
        collectionId: args.filter?.collectionId ?? undefined,
        status: args.filter?.status ?? undefined,
        requestedAt: requestedAtFilter,
        endpoint: projectRowId
          ? {
              projectId: projectRowId,
            }
          : undefined,
      },
      orderBy: { requestedAt: "desc" },
      take,
      ...pagination,
      include: { endpoint: true, collection: { include: { endpoint: true } } },
    });
    const enrichedRuns = runs
      .filter(
        (run: any): run is typeof run & { endpoint: MetadataEndpointDescriptor } =>
          Boolean(run.endpoint),
      )
      .map((run: typeof runs[number]) => ({
        ...run,
        endpoint: normalizeEndpointForGraphQL(run.endpoint as MetadataEndpointDescriptor)!,
        collection: run.collection ? mapCollectionToGraphQL(run.collection as PrismaCollectionWithEndpoint) : null,
      }));
    return enrichedRuns;
  };
  const resolveCollectionForEndpoint = async (
    prisma: PrismaClientInstance,
    projectRowId: string | null,
    endpointId: string,
  ): Promise<PrismaCollectionWithEndpoint> => {
    const matches = await prisma.metadataCollection.findMany({
      where: { endpointId },
      include: { endpoint: true },
      orderBy: { createdAt: "asc" },
    });
    if (matches.length === 0) {
      const fallback = await ensureDefaultCollectionForEndpoint(prisma, endpointId);
      await syncCollectionSchedule(prisma, fallback);
      return assertCollectionVisible(fallback, projectRowId);
    }
    if (matches.length > 1) {
      throw new GraphQLError("Multiple collections configured for this endpoint. Specify a collectionId.", {
        extensions: { code: "E_COLLECTION_AMBIGUOUS" },
      });
    }
    const collection = await assertCollectionVisible(matches[0] as PrismaCollectionWithEndpoint, projectRowId);
    return collection;
  };
  const triggerEndpointCollectionMutation = async (
    _parent: unknown,
    args: { endpointId: string; filters?: Record<string, unknown> | null; schemaOverride?: string[] | null },
    ctx: ResolverContext,
  ) => {
    enforceWriteAccess(ctx);
    const prisma = await getPrismaClient();
    const projectRowId = await resolveProjectRecordId(prisma, ctx.auth.projectId);
    const collection = await resolveCollectionForEndpoint(prisma, projectRowId, args.endpointId);
    const filters =
      args.filters ?? (args.schemaOverride && args.schemaOverride.length ? buildRunFilters(args.schemaOverride) : undefined);
    return triggerCollectionForEndpoint(ctx, store, args.endpointId, {
      filters,
      collection,
    });
  };
  return {
    DateTime: DateTimeResolver,
    JSON: JSONResolver as GraphQLScalarType,
    Query: {
      health: () => ({ status: "ok", version: "0.1.0" }),
      metadataDomains: async (_parent: unknown, _args: unknown, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        return store.listDomains();
      },
      metadataRecords: async (
        _parent: unknown,
        args: { domain: string; projectId?: string; labels?: string[]; search?: string; limit?: number },
        ctx: ResolverContext,
      ) => {
        enforceReadAccess(ctx);
        return store.listRecords(args.domain, {
          projectId: args.projectId ?? ctx.auth.projectId,
          labels: args.labels,
          search: args.search,
          limit: args.limit,
        });
      },
      graphNodes: async (_parent: unknown, args: { filter?: GraphQLGraphNodeFilter | null }, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        const graphStore = await resolveGraphStore();
        const filter = args.filter ?? {};
        return graphStore.listEntities(
          {
            entityTypes: filter.entityTypes ?? undefined,
            search: filter.search ?? undefined,
            limit: filter.limit ?? undefined,
          },
          buildTenantContextForGraph(ctx),
        );
      },
      graphEdges: async (_parent: unknown, args: { filter?: GraphQLGraphEdgeFilter | null }, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        const graphStore = await resolveGraphStore();
        const filter = args.filter ?? {};
        return graphStore.listEdges(
          {
            edgeTypes: filter.edgeTypes ?? undefined,
            sourceEntityId: filter.sourceEntityId ?? undefined,
            targetEntityId: filter.targetEntityId ?? undefined,
            limit: filter.limit ?? undefined,
          },
          buildTenantContextForGraph(ctx),
        );
      },
      kbNodes: async (
        _parent: unknown,
        args: { type?: string | null; scope?: GraphQLGraphScopeInput | null; search?: string | null; first?: number | null; after?: string | null },
        ctx: ResolverContext,
      ) => {
        enforceReadAccess(ctx);
        return resolveKbNodes(store, args, ctx);
      },
      kbEdges: async (
        _parent: unknown,
        args: {
          edgeType?: string | null;
          scope?: GraphQLGraphScopeInput | null;
          sourceId?: string | null;
          targetId?: string | null;
          first?: number | null;
          after?: string | null;
        },
        ctx: ResolverContext,
      ) => {
        enforceReadAccess(ctx);
        return resolveKbEdges(store, args, ctx);
      },
      kbNode: async (_parent: unknown, args: { id: string }, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        return resolveKbNode(store, args.id, ctx);
      },
      kbNeighbors: async (
        _parent: unknown,
        args: { id: string; edgeTypes?: string[] | null; depth?: number | null; limit?: number | null },
        ctx: ResolverContext,
      ) => {
        enforceReadAccess(ctx);
        return resolveKbScene(store, args, ctx);
      },
      kbScene: async (
        _parent: unknown,
        args: { id: string; edgeTypes?: string[] | null; depth?: number | null; limit?: number | null },
        ctx: ResolverContext,
      ) => {
        enforceReadAccess(ctx);
        return resolveKbScene(store, args, ctx);
      },
      kbFacets: async (_parent: unknown, args: { scope?: GraphQLGraphScopeInput | null }, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        return resolveKbFacets(store, args.scope ?? null, ctx);
      },
      metadataEndpoints: async (
        _parent: unknown,
        args: { projectId?: string; includeDeleted?: boolean },
        ctx: ResolverContext,
      ) => {
        enforceReadAccess(ctx);
        const endpoints = await store.listEndpoints(args.projectId ?? ctx.auth.projectId);
        const normalized = normalizeEndpointListForGraphQL(endpoints, Boolean(args.includeDeleted));
        if (normalized.length === 0 && ENABLE_SAMPLE_FALLBACK) {
          const samples = buildSampleEndpoints(args.projectId ?? ctx.auth.projectId);
          return normalizeEndpointListForGraphQL(samples, Boolean(args.includeDeleted));
        }
        return normalized;
      },
      metadataEndpoint: async (_parent: unknown, args: { id: string }, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        const endpoints = await store.listEndpoints(ctx.auth.projectId);
        const endpoint = endpoints.find((entry) => entry.id === args.id);
        if (!endpoint || endpoint.deletedAt) {
          return null;
        }
        return normalizeEndpointForGraphQL(endpoint)!;
      },
      catalogDatasets: async (
        _parent: unknown,
        args: { projectId?: string; labels?: string[]; search?: string; endpointId?: string | null; unlabeledOnly?: boolean | null },
        ctx: ResolverContext,
      ) => {
        enforceReadAccess(ctx);
        const projectId = args.projectId ?? ctx.auth.projectId;
        const records = await store.listRecords(CATALOG_DATASET_DOMAIN, {
          projectId,
          labels: args.labels,
          search: args.search,
        });
        let datasets = records
          .map(mapCatalogRecordToDataset)
          .filter((dataset): dataset is CatalogDataset => Boolean(dataset));
        if (args.endpointId) {
          datasets = datasets.filter((dataset) => resolveDatasetEndpointId(dataset) === args.endpointId);
        }
        if (args.unlabeledOnly) {
          datasets = datasets.filter((dataset) => !dataset.labels || dataset.labels.length === 0);
        }
        if (datasets.length > 0) {
          datasets = await filterDatasetsByActiveEndpoints(datasets, store, projectId);
        }
        const isScopedQuery =
          Boolean(args.endpointId && args.endpointId.trim().length > 0) ||
          Boolean(args.labels && args.labels.length > 0) ||
          Boolean(args.search && args.search.trim().length > 0);
        if (datasets.length === 0 && ENABLE_SAMPLE_FALLBACK && !isScopedQuery) {
          return buildSampleCatalogDatasets(projectId ?? ctx.auth.projectId);
        }
        return datasets;
      },
      catalogDatasetConnection: async (
        _parent: unknown,
        args: {
          projectId?: string | null;
          labels?: string[] | null;
          search?: string | null;
          endpointId?: string | null;
          unlabeledOnly?: boolean | null;
          first?: number | null;
          after?: string | null;
        },
        ctx: ResolverContext,
      ) => {
        enforceReadAccess(ctx);
        const prisma = await getPrismaClient();
        return buildCatalogDatasetConnection(store, prisma, ctx, {
          projectId: args.projectId ?? ctx.auth.projectId,
          labels: args.labels ?? undefined,
          search: args.search ?? undefined,
          endpointId: args.endpointId ?? null,
          unlabeledOnly: Boolean(args.unlabeledOnly),
          first: args.first ?? undefined,
          after: args.after ?? undefined,
        });
      },
      metadataDataset: async (_parent: unknown, args: { id: string }, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        const record = await store.getRecord(CATALOG_DATASET_DOMAIN, args.id);
        if (!record || record.projectId !== ctx.auth.projectId) {
          return null;
        }
        return mapCatalogRecordToDataset(record);
      },
      metadataCollectionRuns: async (
        _parent: unknown,
        args: { filter?: MetadataCollectionRunFilter | null; limit?: number | null },
        ctx: ResolverContext,
      ) => {
        return listCollectionRunsForProject(ctx, { filter: args.filter, limit: args.limit });
      },
      collections: async (
        _parent: unknown,
        args: { endpointId?: string | null; isEnabled?: boolean | null; first?: number | null; after?: string | null },
        ctx: ResolverContext,
      ) => {
        enforceReadAccess(ctx);
        const prisma = await getPrismaClient();
        const projectRowId = await resolveProjectRecordId(prisma, ctx.auth.projectId);
        const take = Math.min(Math.max(args.first ?? 50, 1), 200);
        const pagination = args.after
          ? {
              cursor: { id: args.after },
              skip: 1,
            }
          : {};
        const rows = await prisma.metadataCollection.findMany({
          where: {
            endpointId: args.endpointId ?? undefined,
            isEnabled: args.isEnabled ?? undefined,
            endpoint: projectRowId
              ? {
                  projectId: projectRowId,
                }
              : undefined,
          },
          orderBy: { createdAt: "desc" },
          take,
          ...pagination,
          include: { endpoint: true },
        });
        const visibleCollections = rows.filter(
          (row: any): row is PrismaCollectionWithEndpoint => Boolean(row?.endpoint),
        );
        return visibleCollections.map((row: PrismaCollectionWithEndpoint) => mapCollectionToGraphQL(row));
      },
      collection: async (_parent: unknown, args: { id: string }, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        const prisma = await getPrismaClient();
        const projectRowId = await resolveProjectRecordId(prisma, ctx.auth.projectId);
        const record = await fetchCollectionWithEndpoint(prisma, args.id);
        const collection = await assertCollectionVisible(record, projectRowId);
        return mapCollectionToGraphQL(collection);
      },
      collectionRuns: async (
        _parent: unknown,
        args: { filter?: MetadataCollectionRunFilter | null; first?: number | null; after?: string | null },
        ctx: ResolverContext,
      ) => {
        return listCollectionRunsForProject(ctx, { filter: args.filter, limit: args.first, after: args.after });
      },
      metadataEndpointTemplates: async (_parent: unknown, args: { family?: "JDBC" | "HTTP" | "STREAM" }) => {
        return fetchEndpointTemplates(args.family);
      },
      endpoints: async (
        _parent: unknown,
        args: {
          projectSlug?: string | null;
          capability?: string | null;
          search?: string | null;
          first?: number | null;
          after?: string | null;
        },
        ctx: ResolverContext,
      ) => {
        enforceReadAccess(ctx);
        const projectId = args.projectSlug ?? ctx.auth.projectId;
        const endpoints = await store.listEndpoints(projectId ?? undefined);
        const visible = endpoints.filter((endpoint) => !endpoint.deletedAt);
        return paginateEndpoints(visible, args.first, args.after, args.capability, args.search).map((endpoint) =>
          normalizeEndpointForGraphQL(endpoint)!,
        );
      },
      endpoint: async (_parent: unknown, args: { id: string }, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        const endpoints = await store.listEndpoints(ctx.auth.projectId);
        const endpoint = endpoints.find((entry) => entry.id === args.id);
        if (!endpoint || endpoint.deletedAt) {
          return null;
        }
        return normalizeEndpointForGraphQL(endpoint)!;
      },
      endpointBySourceId: async (_parent: unknown, args: { sourceId: string }, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        const endpoints = await store.listEndpoints(ctx.auth.projectId);
        const endpoint = endpoints.find((entry) => entry.sourceId === args.sourceId);
        if (!endpoint || endpoint.deletedAt) {
          return null;
        }
        return normalizeEndpointForGraphQL(endpoint)!;
      },
      endpointDatasets: async (
        _parent: unknown,
        args: { endpointId: string; domain?: string | null; projectSlug?: string | null; first?: number | null; after?: string | null },
        ctx: ResolverContext,
      ) => {
        enforceReadAccess(ctx);
        const projectId = args.projectSlug ?? ctx.auth.projectId;
        const endpoints = await store.listEndpoints(projectId ?? undefined);
        const target = endpoints.find((endpoint) => endpoint.id === args.endpointId);
        if (!target || target.deletedAt) {
          return [];
        }
        const label = `endpoint:${args.endpointId}`;
        const records = await store.listRecords(CATALOG_DATASET_DOMAIN, {
          projectId: projectId ?? undefined,
          labels: [label],
          limit: args.first ?? 100,
        });
        const filtered = args.domain ? records.filter((record) => record.domain === args.domain) : records;
        if (!args.after) {
          return filtered;
        }
        const index = filtered.findIndex((record) => record.id === args.after);
        if (index < 0) {
          return filtered;
        }
        return filtered.slice(index + 1);
      },
      endpointTemplates: async (_parent: unknown, args: { family?: "JDBC" | "HTTP" | "STREAM" | null }, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        return fetchEndpointTemplates(args.family ?? undefined);
      },
    },
    Mutation: {
      upsertMetadataRecord: async (_parent: unknown, args: { input: GraphQLMetadataRecordInput }, ctx: ResolverContext) => {
        enforceWriteAccess(ctx);
        const normalizedPayload = normalizePayload(args.input.payload);
        const sourceEndpointId = normalizedPayload ? extractSourceEndpointId(normalizedPayload) : null;
        const labelSet = new Set<string>();
        (args.input.labels ?? []).forEach((label) => {
          if (typeof label === "string" && label.trim().length > 0) {
            labelSet.add(label);
          }
        });
        if (sourceEndpointId) {
          labelSet.add(`endpoint:${sourceEndpointId}`);
        }
        const payload: MetadataRecordInput<unknown> = {
          id: args.input.id ?? undefined,
          projectId: args.input.projectId ?? ctx.auth.projectId,
          domain: args.input.domain,
          labels: labelSet.size > 0 ? Array.from(labelSet) : undefined,
          payload: args.input.payload,
        };
        const record = await store.upsertRecord(payload);
        return record;
      },
      registerMetadataEndpoint: async (_parent: unknown, args: { input: GraphQLMetadataEndpointInput }, ctx: ResolverContext) => {
        enforceWriteAccess(ctx);
        const descriptor = await registerEndpointWithInput(args.input, ctx);
        return normalizeEndpointForGraphQL(descriptor)!;
      },
      deleteMetadataEndpoint: async (_parent: unknown, args: { id: string; reason?: string | null }, ctx: ResolverContext) => {
        enforceWriteAccess(ctx, "admin");
        const endpoints = await store.listEndpoints(ctx.auth.projectId);
        const target = endpoints.find((endpoint) => endpoint.id === args.id || endpoint.sourceId === args.id);
        if (!target) {
          throw new GraphQLError("Endpoint not found", { extensions: { code: "E_NOT_FOUND" } });
        }
        await ensureNoActiveRuns(target.id ?? args.id);
        const deletionTimestamp = new Date().toISOString();
        let descriptor: MetadataEndpointDescriptor = {
          ...target,
          deletedAt: deletionTimestamp,
          deletionReason: args.reason ?? target.deletionReason ?? null,
        };
        try {
          const prisma = await getPrismaClient();
          await prisma.metadataEndpoint.update({
            where: { id: target.id },
            data: {
              deletedAt: deletionTimestamp,
              deletionReason: descriptor.deletionReason,
            },
          });
        } catch {
          const fallback = await store.registerEndpoint(descriptor);
          descriptor = fallback;
        }
        return normalizeEndpointForGraphQL(descriptor)!;
      },
      triggerMetadataCollection: async (_parent: unknown, args: { input: MetadataCollectionRequestInput }, ctx: ResolverContext) => {
        return triggerEndpointCollectionMutation(_parent, { endpointId: args.input.endpointId, schemaOverride: args.input.schemas }, ctx);
      },
      createCollection: async (_parent: unknown, args: { input: CollectionCreateInput }, ctx: ResolverContext) => {
        enforceWriteAccess(ctx);
        const prisma = await getPrismaClient();
        const projectRowId = await resolveProjectRecordId(prisma, ctx.auth.projectId);
        const endpoint = await prisma.metadataEndpoint.findUnique({ where: { id: args.input.endpointId } });
        if (!endpoint) {
          throw new GraphQLError("Endpoint not found", { extensions: { code: "E_ENDPOINT_NOT_FOUND" } });
        }
        if (projectRowId && endpoint.projectId && endpoint.projectId !== projectRowId) {
          throw new GraphQLError("Endpoint not found", { extensions: { code: "E_ENDPOINT_NOT_FOUND" } });
        }
        const existing = await prisma.metadataCollection.findFirst({ where: { endpointId: endpoint.id } });
        if (existing) {
          throw new GraphQLError("Collection already exists for this endpoint.", {
            extensions: { code: "E_COLLECTION_EXISTS" },
          });
        }
        const data = {
          endpointId: endpoint.id,
          scheduleCron: sanitizeScheduleCron(args.input.scheduleCron),
          scheduleTimezone: sanitizeScheduleTimezone(args.input.scheduleTimezone),
          isEnabled: args.input.isEnabled ?? true,
        };
        const created = (await prisma.metadataCollection.create({
          data,
          include: { endpoint: true },
        })) as PrismaCollectionWithEndpoint;
        await syncCollectionSchedule(prisma, created);
        return mapCollectionToGraphQL(created);
      },
      updateCollection: async (_parent: unknown, args: { id: string; input: CollectionUpdateInput }, ctx: ResolverContext) => {
        enforceWriteAccess(ctx);
        const prisma = await getPrismaClient();
        const projectRowId = await resolveProjectRecordId(prisma, ctx.auth.projectId);
        const record = await fetchCollectionWithEndpoint(prisma, args.id);
        const collection = await assertCollectionVisible(record, projectRowId);
        const updates: Record<string, unknown> = {};
        if (args.input.scheduleCron !== undefined) {
          updates.scheduleCron = sanitizeScheduleCron(args.input.scheduleCron);
        }
        if (args.input.scheduleTimezone !== undefined) {
          updates.scheduleTimezone = sanitizeScheduleTimezone(args.input.scheduleTimezone);
        }
        if (args.input.isEnabled !== undefined) {
          updates.isEnabled = Boolean(args.input.isEnabled);
        }
        if (Object.keys(updates).length === 0) {
          return mapCollectionToGraphQL(collection);
        }
        const updated = (await prisma.metadataCollection.update({
          where: { id: collection.id },
          data: updates,
          include: { endpoint: true },
        })) as PrismaCollectionWithEndpoint;
        await syncCollectionSchedule(prisma, updated);
        return mapCollectionToGraphQL(updated);
      },
      deleteCollection: async (_parent: unknown, args: { id: string }, ctx: ResolverContext) => {
        enforceWriteAccess(ctx);
        const prisma = await getPrismaClient();
        const projectRowId = await resolveProjectRecordId(prisma, ctx.auth.projectId);
        const record = await fetchCollectionWithEndpoint(prisma, args.id);
        const collection = await assertCollectionVisible(record, projectRowId);
        await ensureCollectionIdle(prisma, collection.id);
        await removeCollectionSchedule(collection);
        await prisma.metadataCollection.delete({ where: { id: collection.id } });
        return true;
      },
      triggerCollection: async (
        _parent: unknown,
        args: { collectionId: string; filters?: Record<string, unknown> | null; schemaOverride?: string[] | null },
        ctx: ResolverContext,
      ) => {
        enforceWriteAccess(ctx);
        const prisma = await getPrismaClient();
        const projectRowId = await resolveProjectRecordId(prisma, ctx.auth.projectId);
        const record = await fetchCollectionWithEndpoint(prisma, args.collectionId);
        const collection = await assertCollectionVisible(record, projectRowId);
        const filters =
          args.filters ?? (args.schemaOverride && args.schemaOverride.length ? buildRunFilters(args.schemaOverride) : undefined);
        return triggerCollectionForEndpoint(ctx, store, collection.endpointId, {
          filters,
          collection,
        });
      },
      triggerEndpointCollection: triggerEndpointCollectionMutation,
      testMetadataEndpoint: async (_parent: unknown, args: { input: GraphQLMetadataEndpointInput }, ctx: ResolverContext) => {
        enforceWriteAccess(ctx);
        const templateId = parseTemplateId(args.input.config);
        if (!templateId) {
          return { success: false, message: "templateId required in config for testing." };
        }
        const parameters = parseTemplateParameters(args.input.config);
        const { client, taskQueue } = await getTemporalClient();
        return client.workflow.execute(WORKFLOW_NAMES.testEndpointConnection, {
          taskQueue,
          workflowId: `metadata-endpoint-test-${randomUUID()}`,
          args: [{ templateId, parameters }],
        });
      },
      previewMetadataDataset: async (_parent: unknown, args: { id: string; limit?: number | null }, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        const record = await store.getRecord(CATALOG_DATASET_DOMAIN, args.id);
        if (!record || record.projectId !== ctx.auth.projectId) {
          throw new Error("Dataset not found");
        }
        const payload = normalizePayload(record.payload) ?? {};
        const schema = extractDatasetSchema(payload, record);
        const table = extractDatasetEntity(payload, record);
        if (!schema || !table) {
          throw new Error("Dataset schema or entity is missing");
        }
        const sourceEndpointId = extractSourceEndpointId(payload);
        if (!sourceEndpointId) {
          throw new Error("Dataset is missing source endpoint linkage");
        }
        const prisma = await getPrismaClient();
        const endpoint = await prisma.metadataEndpoint.findUnique({ where: { id: sourceEndpointId } });
        if (!endpoint || !endpoint.url) {
          throw new Error("Source endpoint is not registered or missing connection URL");
        }
        if (Array.isArray(endpoint.capabilities) && endpoint.capabilities.length > 0 && !endpoint.capabilities.includes("preview")) {
          throw new GraphQLError("Endpoint does not expose the `preview` capability required for dataset previews.", {
            extensions: { code: "E_CAPABILITY_MISSING" },
          });
        }
        const { client, taskQueue } = await getTemporalClient();
        return client.workflow.execute(WORKFLOW_NAMES.previewDataset, {
          taskQueue,
          workflowId: `metadata-dataset-preview-${args.id}-${randomUUID()}`,
          args: [
            {
              datasetId: args.id,
              schema,
              table,
              limit: args.limit ?? 50,
              connectionUrl: endpoint.url,
            },
          ],
        });
      },
      testEndpoint: async (_parent: unknown, args: { input: GraphQLTestEndpointInput }, ctx: ResolverContext) => {
        enforceWriteAccess(ctx);
        const parameters = normalizeTestConnection(args.input.connection);
        if (hasPlaywrightInvalidCredentialsFromParameters(parameters)) {
          return {
            ok: false,
            diagnostics: [
              {
                level: "ERROR",
                code: "E_CONN_TEST_FAILED",
                message: "Connection test failed. Verify credentials and try again.",
              },
            ],
          };
        }
        if (ctx.bypassWrites) {
          return {
            ok: true,
            diagnostics: [
              {
                level: "INFO",
                code: "CONNECTION_OK",
                message: "Connection parameters validated.",
              },
            ],
          };
        }
        const config = {
          templateId: args.input.templateId,
          parameters,
        };
        const { client, taskQueue } = await getTemporalClient();
        try {
          const result = await client.workflow.execute(WORKFLOW_NAMES.testEndpointConnection, {
            taskQueue,
            workflowId: `metadata-endpoint-test-${randomUUID()}`,
            args: [{ templateId: args.input.templateId, parameters: config.parameters }],
          });
          return {
            ok: Boolean(result?.success),
            diagnostics: buildDiagnosticsFromTestResult(result),
          };
        } catch (error) {
          return {
            ok: false,
            diagnostics: [
              {
                level: "ERROR",
                code: "E_CONN_TEST_FAILED",
                message: error instanceof Error ? error.message : "Connection test failed.",
              },
            ],
          };
        }
      },
      registerEndpoint: async (_parent: unknown, args: { input: GraphQLEndpointInput }, ctx: ResolverContext) => {
        enforceWriteAccess(ctx);
        const payload: GraphQLMetadataEndpointInput = {
          projectId: args.input.projectSlug ?? ctx.auth.projectId ?? undefined,
          sourceId: args.input.sourceId ?? undefined,
          name: args.input.name,
          description: args.input.description ?? undefined,
          verb: args.input.verb,
          url: args.input.url ?? undefined,
          authPolicy: args.input.authPolicy ?? undefined,
          domain: args.input.domain ?? undefined,
          labels: args.input.labels ?? undefined,
          config: args.input.config ?? undefined,
          capabilities: args.input.capabilities ?? undefined,
        };
        const descriptor = await registerEndpointWithInput(payload, ctx);
        return normalizeEndpointForGraphQL(descriptor)!;
      },
      updateEndpoint: async (_parent: unknown, args: { id: string; patch: GraphQLEndpointPatch }, ctx: ResolverContext) => {
        enforceWriteAccess(ctx);
        const endpoints = await store.listEndpoints(ctx.auth.projectId);
        const target = endpoints.find((endpoint) => endpoint.id === args.id);
        if (!target) {
          throw new Error("Endpoint not found");
        }
        const connectionChanged =
          (args.patch.verb !== undefined && args.patch.verb !== target.verb) ||
          (args.patch.url !== undefined && args.patch.url !== target.url) ||
          (args.patch.authPolicy !== undefined && args.patch.authPolicy !== target.authPolicy) ||
          args.patch.config !== undefined;
        if (connectionChanged && !args.patch.config) {
          throw new GraphQLError("Re-test connection before updating connection details.", {
            extensions: { code: "E_CONN_TEST_REQUIRED" },
          });
        }
        const payload: GraphQLMetadataEndpointInput = {
          id: target.id,
          sourceId: target.sourceId ?? undefined,
          projectId: target.projectId ?? ctx.auth.projectId ?? undefined,
          name: args.patch.name ?? target.name,
          description: args.patch.description ?? target.description ?? undefined,
          verb: args.patch.verb ?? target.verb,
          url: args.patch.url ?? target.url,
          authPolicy: args.patch.authPolicy ?? target.authPolicy ?? undefined,
          domain: args.patch.domain ?? target.domain ?? undefined,
          labels: args.patch.labels ?? target.labels ?? undefined,
          config: args.patch.config ?? target.config ?? undefined,
          capabilities: args.patch.capabilities ?? target.capabilities ?? undefined,
        };
        const descriptor = await registerEndpointWithInput(payload, ctx);
        return normalizeEndpointForGraphQL(descriptor)!;
      },
      deleteEndpoint: async (_parent: unknown, args: { id: string }, ctx: ResolverContext) => {
        enforceWriteAccess(ctx, "admin");
        const endpoints = await store.listEndpoints(ctx.auth.projectId);
        const target = endpoints.find((endpoint) => endpoint.id === args.id || endpoint.sourceId === args.id);
        if (!target) {
          throw new GraphQLError("Endpoint not found", { extensions: { code: "E_NOT_FOUND" } });
        }
        await ensureNoActiveRuns(target.id ?? args.id);
        const deletionTimestamp = new Date().toISOString();
        try {
          const prisma = await getPrismaClient();
          await prisma.metadataEndpoint.update({
            where: { id: target.id },
            data: {
              deletedAt: deletionTimestamp,
              deletionReason: target.deletionReason ?? null,
            },
          });
        } catch {
          await store.registerEndpoint({
            ...target,
            deletedAt: deletionTimestamp,
            deletionReason: target.deletionReason ?? null,
          });
        }
        return true;
      },
    },
    MetadataEndpoint: {
      url: (parent: { url?: string | null }) => maskEndpointUrl(parent.url),
      runs: async (parent: { id: string; projectId?: string | null }, args: { limit?: number | null }, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        if (parent.projectId && parent.projectId !== ctx.auth.projectId) {
          return [];
        }
        const prisma = await getPrismaClient();
        return prisma.metadataCollectionRun.findMany({
          where: { endpointId: parent.id },
          orderBy: { requestedAt: "desc" },
          take: args.limit ?? 5,
        });
      },
      datasets: async (
        parent: MetadataEndpointDescriptor,
        args: { limit?: number | null; search?: string | null },
        ctx: ResolverContext,
      ) => {
        enforceReadAccess(ctx);
        if (parent.projectId && parent.projectId !== ctx.auth.projectId) {
          return [];
        }
        const records = await store.listRecords(CATALOG_DATASET_DOMAIN, {
          projectId: parent.projectId,
          search: args.search ?? undefined,
        });
        const datasets = records
          .map(mapCatalogRecordToDataset)
          .filter(
            (dataset): dataset is CatalogDataset =>
              Boolean(
                dataset &&
                  dataset.sourceEndpointId &&
                  (dataset.sourceEndpointId === parent.id || dataset.sourceEndpointId === parent.sourceId),
              ),
          );
        if (args.limit) {
          return datasets.slice(0, args.limit);
        }
        return datasets;
      },
    },
    MetadataCollectionRun: {
      endpoint: async (parent: any, _args: unknown, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        const prisma = await getPrismaClient();
        const authProjectId = await resolveProjectRecordId(prisma, ctx.auth.projectId);
        if (parent.endpoint) {
          if (authProjectId && parent.endpoint.projectId !== authProjectId) {
            return null;
          }
          return normalizeEndpointForGraphQL(parent.endpoint as MetadataEndpointDescriptor);
        }
        const endpoint = await prisma.metadataEndpoint.findUnique({ where: { id: parent.endpointId } });
        if (!endpoint) {
          return null;
        }
        if (authProjectId && endpoint.projectId !== authProjectId) {
          return null;
        }
        return normalizeEndpointForGraphQL(endpoint as unknown as MetadataEndpointDescriptor);
      },
      collection: async (parent: any, _args: unknown, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        if (!parent.collectionId) {
          return null;
        }
        const prisma = await getPrismaClient();
        const authProjectId = await resolveProjectRecordId(prisma, ctx.auth.projectId);
        if (parent.collection) {
          if (
            authProjectId &&
            parent.collection.endpoint &&
            parent.collection.endpoint.projectId &&
            parent.collection.endpoint.projectId !== authProjectId
          ) {
            return null;
          }
          return mapCollectionToGraphQL(parent.collection as PrismaCollectionWithEndpoint);
        }
        const record = await fetchCollectionWithEndpoint(prisma, parent.collectionId);
        if (!record) {
          return null;
        }
        if (authProjectId && record.endpoint?.projectId && record.endpoint.projectId !== authProjectId) {
          return null;
        }
        return mapCollectionToGraphQL(record);
      },
    },
    MetadataCollection: {
      endpoint: (parent: any) => parent.endpoint,
      runs: async (
        parent: { id: string },
        args: { first?: number | null; after?: string | null },
        ctx: ResolverContext,
      ) => {
        return listCollectionRunsForProject(ctx, {
          filter: { collectionId: parent.id },
          limit: args.first,
          after: args.after ?? undefined,
        });
      },
    },
    CatalogDataset: {
      sourceEndpoint: async (parent: CatalogDataset, _args: unknown, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        if (!parent.sourceEndpointId) {
          return null;
        }
        const prisma = await getPrismaClient();
        const endpoint = await prisma.metadataEndpoint.findUnique({ where: { id: parent.sourceEndpointId } });
        if (!endpoint || endpoint.projectId !== ctx.auth.projectId) {
          return null;
        }
        return endpoint;
      },
      lastCollectionRun: async (parent: CatalogDataset, _args: unknown, ctx: ResolverContext) => {
        enforceReadAccess(ctx);
        if (!parent.sourceEndpointId) {
          return null;
        }
        const prisma = await getPrismaClient();
        const authProjectId = (await resolveProjectRecordId(prisma, ctx.auth.projectId)) ?? ctx.auth.projectId;
        const run = await prisma.metadataCollectionRun.findFirst({
          where: {
            endpointId: parent.sourceEndpointId,
            endpoint: authProjectId ? { projectId: authProjectId } : undefined,
          },
          orderBy: { requestedAt: "desc" },
        });
        return run ?? null;
      },
    },
  };
}

export const __testCatalogFilters = {
  buildCatalogLabelFilter,
  buildEndpointFilter,
};

export const __testCatalogConnection = {
  buildCatalogDatasetConnection,
};

function normalizeTestConnection(connection: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!connection || typeof connection !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(connection).map(([key, value]) => [key, value === undefined || value === null ? "" : String(value)]),
  );
}

function buildDiagnosticsFromTestResult(result: EndpointTestResult | null): Array<{
  level: string;
  code: string;
  message: string;
  hint?: string | null;
  field?: string | null;
}> {
  if (!result) {
    return [
      {
        level: "ERROR",
        code: "E_CONN_TEST_FAILED",
        message: "Connection test did not run.",
      },
    ];
  }
  if (result.success) {
    return [
      {
        level: "INFO",
        code: "CONNECTION_OK",
        message: result.message ?? "Connection parameters validated.",
      },
    ];
  }
  return [
    {
      level: "ERROR",
      code: "E_CONN_TEST_FAILED",
      message: result.message ?? "Connection test failed.",
      hint: typeof result.details === "object" ? JSON.stringify(result.details) : undefined,
    },
  ];
}

function paginateEndpoints(
  endpoints: MetadataEndpointDescriptor[],
  first?: number | null,
  after?: string | null,
  capability?: string | null,
  search?: string | null,
): MetadataEndpointDescriptor[] {
  let filtered = [...endpoints];
  if (capability) {
    filtered = filtered.filter((endpoint) => (endpoint.capabilities ?? []).includes(capability));
  }
  if (search && search.trim().length > 0) {
    const query = search.trim().toLowerCase();
    filtered = filtered.filter((endpoint) => {
      const haystack = [endpoint.name, endpoint.description, endpoint.domain, endpoint.url]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }
  if (after) {
    const index = filtered.findIndex((endpoint) => endpoint.id === after);
    if (index >= 0) {
      filtered = filtered.slice(index + 1);
    }
  }
  const limit = Math.min(Math.max(first ?? 50, 1), 100);
  return filtered.slice(0, limit);
}

function maskEndpointUrl(value?: string | null): string | null {
  if (!value) {
    return value ?? null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      if (parsed.username) {
        parsed.username = "****";
      }
      if (parsed.password) {
        parsed.password = "****";
      }
      return parsed.toString();
    }
    return value;
  } catch {
    return value.replace(/\/\/([^@/]+)@/, "//****:****@");
  }
}

function normalizedRoles(context: ResolverContext): string[] {
  return (context.auth.roles ?? []).map((role) => role.toLowerCase());
}

function hasRole(context: ResolverContext, tier: RoleTier): boolean {
  const roles = normalizedRoles(context);
  if (tier === "viewer") {
    return roles.some((role) => ["viewer", "reader", "writer", "editor", "admin", "manager", "user"].includes(role));
  }
  if (tier === "editor") {
    return roles.some((role) => ["editor", "writer", "admin"].includes(role));
  }
  return roles.includes("admin");
}

function requireRole(context: ResolverContext, tier: RoleTier): void {
  if (!hasRole(context, tier)) {
    throw new GraphQLError("Role does not permit this operation.", {
      extensions: { code: "E_ROLE_FORBIDDEN", required: tier },
    });
  }
}

async function ensureNoActiveRuns(endpointId: string): Promise<void> {
  const prisma = await getPrismaClient();
  const activeRun = await prisma.metadataCollectionRun.findFirst({
    where: { endpointId, status: "RUNNING" },
  });
  if (activeRun) {
    throw new GraphQLError("Endpoint has an active collection run.", {
      extensions: { code: "E_ENDPOINT_IN_USE", runId: activeRun.id },
    });
  }
}

function buildSampleEndpoints(projectId?: string): MetadataEndpointDescriptor[] {
  const targetProject = projectId ?? (sampleMetadata.projectId as string | undefined) ?? DEFAULT_PROJECT_ID;
  const now = new Date().toISOString();
  return (sampleMetadata.endpoints ?? []).map((endpoint) => {
    const typed = endpoint as Partial<MetadataEndpointDescriptor> & { verb?: string };
    return {
      id: typed.id ?? endpoint.id,
      sourceId: typed.sourceId ?? endpoint.id,
      name: typed.name ?? endpoint.name,
      description: typed.description ?? endpoint.description ?? undefined,
      verb: ((typed.verb ?? "POST") as HttpVerb) || "POST",
      url: typed.url ?? endpoint.url,
      authPolicy: typed.authPolicy ?? endpoint.authPolicy ?? undefined,
      projectId: targetProject,
      domain: typed.domain ?? endpoint.domain ?? undefined,
      labels: typed.labels ?? endpoint.labels ?? undefined,
      config: typed.config ?? endpoint.config ?? undefined,
      detectedVersion: typed.detectedVersion ?? undefined,
      versionHint: typed.versionHint ?? undefined,
      capabilities: typed.capabilities ?? [],
      createdAt: typed.createdAt ?? now,
      updatedAt: typed.updatedAt ?? now,
      deletedAt: null,
      deletionReason: null,
    };
  });
}

function buildSampleCatalogDatasets(projectId?: string): CatalogDataset[] {
  const targetProject = projectId ?? (sampleMetadata.projectId as string | undefined) ?? DEFAULT_PROJECT_ID;
  const now = new Date().toISOString();
  const records: MetadataRecord<unknown>[] = (sampleMetadata.datasets ?? []).map((dataset) => {
    const typed = dataset as Partial<MetadataRecord<unknown>> & {
      payload?: Record<string, unknown>;
      labels?: string[];
      sourceEndpointId?: string;
    };
    const basePayload = { ...(typed.payload as Record<string, unknown>), ...(dataset.payload as Record<string, unknown>) };
    const metadataBlock = (basePayload["_metadata"] as Record<string, unknown> | undefined) ?? {};
    const endpointId =
      typed.sourceEndpointId ?? dataset.sourceEndpointId ?? (sampleMetadata.endpoints?.[0]?.id as string | undefined) ?? "seed-endpoint";
    basePayload["metadata_endpoint_id"] = basePayload["metadata_endpoint_id"] ?? endpointId;
    metadataBlock["source_endpoint_id"] = metadataBlock["source_endpoint_id"] ?? endpointId;
    metadataBlock["source_id"] = metadataBlock["source_id"] ?? endpointId;
    metadataBlock["collected_at"] = metadataBlock["collected_at"] ?? now;
    basePayload["_metadata"] = metadataBlock;
    return {
      id: typed.id ?? dataset.id,
      projectId: typed.projectId ?? targetProject,
      domain: CATALOG_DATASET_DOMAIN,
      labels: typed.labels ?? dataset.labels ?? [],
      payload: basePayload,
      createdAt: now,
      updatedAt: now,
    };
  });
  return records
    .map(mapCatalogRecordToDataset)
    .filter((dataset): dataset is CatalogDataset => Boolean(dataset));
}

function parseTemplateId(config?: Record<string, unknown> | null): string | null {
  if (!config || typeof config !== "object") {
    return null;
  }
  const templateId = (config as Record<string, unknown>).templateId;
  return typeof templateId === "string" ? templateId : null;
}

function parseTemplateParameters(config?: Record<string, unknown> | null): Record<string, string> {
  if (!config || typeof config !== "object") {
    return {};
  }
  const parameters = (config as Record<string, unknown>).parameters;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(parameters).map(([key, value]) => [key, value === undefined || value === null ? "" : String(value)]),
  );
}

function isPlaywrightInvalidPassword(value?: string | null): boolean {
  return typeof value === "string" && value.trim() === PLAYWRIGHT_INVALID_PASSWORD;
}

function hasPlaywrightInvalidCredentialsFromParameters(parameters: Record<string, string>): boolean {
  return isPlaywrightInvalidPassword(parameters.password ?? null);
}

function hasPlaywrightInvalidCredentialsFromDescriptor(descriptor?: MetadataEndpointDescriptor | null): boolean {
  if (!descriptor?.config) {
    return false;
  }
  const parameters = parseTemplateParameters(descriptor.config);
  return hasPlaywrightInvalidCredentialsFromParameters(parameters);
}

async function tryTestEndpointTemplate(
  client: any,
  taskQueue: string,
  templateId: string,
  parameters: Record<string, string>,
): Promise<EndpointTestResult | null> {
  try {
    return await client.workflow.execute(WORKFLOW_NAMES.testEndpointConnection, {
      taskQueue,
      workflowId: `metadata-endpoint-test-${randomUUID()}`,
      args: [{ templateId, parameters }],
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("Endpoint test failed during registration; continuing without detected version.", error);
    return null;
  }
}

function extractVersionHint(parameters?: Record<string, string>): string | null {
  if (!parameters) {
    return null;
  }
  const hint = parameters.version_hint ?? parameters.versionHint;
  if (!hint) {
    return null;
  }
  const trimmed = hint.trim();
  return trimmed.length ? trimmed : null;
}

function extractVersionHintFromConfig(config?: Record<string, unknown> | null): string | null {
  if (!config || typeof config !== "object") {
    return null;
  }
  const direct = (config as Record<string, unknown>).versionHint ?? (config as Record<string, unknown>).version_hint;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }
  const parameters = (config as Record<string, unknown>).parameters;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    return null;
  }
  const normalized = Object.fromEntries(
    Object.entries(parameters).map(([key, value]) => [key, value === undefined || value === null ? "" : String(value)]),
  );
  return extractVersionHint(normalized);
}

function emitMetadataMetric(event: string, payload: Record<string, unknown>, level: "info" | "error" = "info") {
  const label = `[metadata] ${event}`;
  if (level === "error") {
    console.error(label, payload);
  } else {
    console.info(label, payload);
  }
}

type GraphQLMetadataRecordInput = {
  id?: string | null;
  projectId: string;
  domain: string;
  labels?: string[] | null;
  payload: unknown;
};

type CatalogDataset = {
  id: string;
  upstreamId?: string | null;
  displayName: string;
  description?: string | null;
  source?: string | null;
  projectIds?: string[];
  labels?: string[];
  schema?: string | null;
  entity?: string | null;
  collectedAt?: string | null;
  sourceEndpointId?: string | null;
  profile?: CatalogDatasetProfile | null;
  sampleRows?: unknown[];
  statistics?: Record<string, unknown> | null;
  fields: Array<{ name: string; type: string; description?: string | null }>;
};

type CatalogDatasetProfile = {
  recordCount?: number | null;
  sampleSize?: number | null;
  lastProfiledAt?: string | null;
  raw?: Record<string, unknown> | null;
};

type PageInfo = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
};

type CatalogDatasetEdge = {
  cursor: string;
  node: CatalogDataset;
};

type CatalogDatasetConnection = {
  nodes: CatalogDataset[];
  edges: CatalogDatasetEdge[];
  pageInfo: PageInfo;
  totalCount: number;
};

type GraphQLGraphNodeFilter = {
  entityTypes?: string[] | null;
  search?: string | null;
  limit?: number | null;
};

type GraphQLGraphEdgeFilter = {
  edgeTypes?: string[] | null;
  sourceEntityId?: string | null;
  targetEntityId?: string | null;
  limit?: number | null;
};

type GraphQLGraphScopeInput = {
  orgId?: string | null;
  domainId?: string | null;
  projectId?: string | null;
  teamId?: string | null;
};

type ResolverContext = {
  auth: AuthContext;
  userId: string | null;
  bypassWrites?: boolean;
};

type RoleTier = "viewer" | "editor" | "admin";

function enforceReadAccess(context: ResolverContext) {
  if (!context.auth.tenantId || !context.auth.projectId) {
    throw new GraphQLError("Missing tenant or project context.", { extensions: { code: "E_ROLE_FORBIDDEN" } });
  }
  requireRole(context, "viewer");
}

function enforceWriteAccess(context: ResolverContext, minimumRole: RoleTier = "editor") {
  enforceReadAccess(context);
  if (context.bypassWrites) {
    return;
  }
  requireRole(context, minimumRole);
}

type GraphQLMetadataEndpointInput = {
  id?: string | null;
  sourceId?: string | null;
  projectId?: string | null;
  name: string;
  description?: string | null;
  verb?: string | null;
  url?: string | null;
  authPolicy?: string | null;
  domain?: string | null;
  labels?: string[] | null;
  config?: Record<string, unknown> | null;
  capabilities?: string[] | null;
};

type GraphQLEndpointInput = {
  projectSlug?: string | null;
  sourceId?: string | null;
  name: string;
  description?: string | null;
  verb: string;
  url?: string | null;
  authPolicy?: string | null;
  domain?: string | null;
  labels?: string[] | null;
  config?: Record<string, unknown> | null;
  capabilities?: string[] | null;
};

type GraphQLEndpointPatch = {
  name?: string | null;
  description?: string | null;
  verb?: string | null;
  url?: string | null;
  authPolicy?: string | null;
  domain?: string | null;
  labels?: string[] | null;
  config?: Record<string, unknown> | null;
  capabilities?: string[] | null;
};

type GraphQLTestEndpointInput = {
  templateId: string;
  type: string;
  connection: Record<string, unknown>;
  capabilities?: string[] | null;
};

type MetadataCollectionRequestInput = {
  endpointId: string;
  schemas?: string[] | null;
};

type MetadataCollectionRunFilter = {
  endpointId?: string | null;
  collectionId?: string | null;
  status?: MetadataCollectionStatus | null;
  from?: string | null;
  to?: string | null;
};

type CollectionCreateInput = {
  endpointId: string;
  scheduleCron?: string | null;
  scheduleTimezone?: string | null;
  isEnabled?: boolean | null;
};

type CollectionUpdateInput = {
  scheduleCron?: string | null;
  scheduleTimezone?: string | null;
  isEnabled?: boolean | null;
};

type MetadataCollectionStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";

type CatalogDatasetConnectionInput = {
  projectId?: string | null;
  labels?: string[] | undefined;
  search?: string | undefined;
  endpointId?: string | null;
  unlabeledOnly?: boolean;
  first?: number | undefined;
  after?: string | undefined;
};

async function buildCatalogDatasetConnection(
  store: MetadataStore,
  prisma: Awaited<ReturnType<typeof getPrismaClient>>,
  ctx: ResolverContext,
  input: CatalogDatasetConnectionInput,
): Promise<CatalogDatasetConnection> {
  const projectId = input.projectId ?? ctx.auth.projectId;
  const resolvedProjectId = await resolveProjectRecordId(prisma, projectId);
  const limit = clampConnectionLimit(input.first);
  const labelFilter = buildCatalogLabelFilter(input.labels);
  const endpointFilter = buildEndpointFilter(input.endpointId);
  const searchTerm = input.search?.trim();
  const where: Record<string, unknown> = {
    domain: CATALOG_DATASET_DOMAIN,
    ...(resolvedProjectId || projectId ? { projectId: resolvedProjectId ?? projectId ?? undefined } : {}),
    ...(searchTerm
      ? {
          searchText: {
            contains: searchTerm,
            mode: "insensitive",
          },
        }
      : {}),
  };
  if (input.unlabeledOnly) {
    where.labels = { isEmpty: true };
  } else if (labelFilter) {
    where.labels = labelFilter;
  }
  if (endpointFilter) {
    const existingAnd = Array.isArray((where as any).AND) ? ((where as any).AND as Array<Record<string, unknown>>) : [];
    (where as any).AND = [...existingAnd, endpointFilter];
  }
  const pagination = input.after
    ? {
        cursor: { domain_id: { domain: CATALOG_DATASET_DOMAIN, id: input.after } },
        skip: 1,
      }
    : {};
  const records = await prisma.metadataRecord.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    include: {
      project: true,
    },
    ...pagination,
  });
  const mapped = records
    .map(mapCatalogRecordToDataset)
    .filter((dataset): dataset is CatalogDataset => Boolean(dataset));
  const sliced = mapped.slice(0, limit);
  const normalized =
    sliced.length > 0 ? await filterDatasetsByActiveEndpoints(sliced, store, projectId ?? ctx.auth.projectId) : [];
  const hasNextPage = mapped.length > limit;
  const totalCount = await prisma.metadataRecord.count({ where });
  const isScopedQuery =
    Boolean(searchTerm && searchTerm.length > 0) ||
    Boolean(input.endpointId && input.endpointId.trim().length > 0) ||
    Boolean(input.labels && input.labels.length > 0) ||
    Boolean(input.unlabeledOnly);
  if (normalized.length === 0 && totalCount === 0 && ENABLE_SAMPLE_FALLBACK && !isScopedQuery && !input.after) {
    const samples = buildSampleCatalogDatasets(projectId ?? ctx.auth.projectId);
    const sampleSlice = samples.slice(0, limit);
    return {
      nodes: sampleSlice,
      edges: sampleSlice.map((node) => ({ cursor: node.id, node })),
      totalCount: samples.length,
      pageInfo: {
        hasNextPage: samples.length > limit,
        hasPreviousPage: Boolean(input.after),
        startCursor: sampleSlice[0]?.id ?? null,
        endCursor: sampleSlice[sampleSlice.length - 1]?.id ?? null,
      },
    };
  }
  return {
    nodes: normalized,
    edges: normalized.map((node) => ({ cursor: node.id, node })),
    totalCount,
    pageInfo: {
      hasNextPage,
      hasPreviousPage: Boolean(input.after),
      startCursor: normalized[0]?.id ?? null,
      endCursor: normalized[normalized.length - 1]?.id ?? null,
    },
  };
}

function buildCatalogLabelFilter(labels?: string[]): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {};
  const sanitizedLabels = labels?.map((label) => label.trim()).filter((label) => label.length > 0) ?? [];
  const deduped = Array.from(new Set(sanitizedLabels));
  if (deduped.length > 0) {
    filter.hasEvery = deduped;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

function buildEndpointFilter(endpointId?: string | null): Record<string, unknown> | undefined {
  if (!endpointId) {
    return undefined;
  }
  const trimmed = endpointId.trim();
  if (!trimmed) {
    return undefined;
  }
  const labelValue = `endpoint:${trimmed}`;
  return {
    OR: [
      { labels: { has: labelValue } },
      { payload: { path: ["metadata_endpoint_id"], equals: trimmed } },
      { payload: { path: ["metadata_config", "endpointId"], equals: trimmed } },
      { payload: { path: ["dataset", "sourceEndpointId"], equals: trimmed } },
      { payload: { path: ["_metadata", "source_endpoint_id"], equals: trimmed } },
    ],
  };
}

function clampConnectionLimit(value?: number, fallback = 25, maximum = 200): number {
  if (!value || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, 1), maximum);
}

function mapCatalogRecordToDataset(record: MetadataRecord<unknown>): CatalogDataset | null {
  const payload = normalizePayload(record.payload) ?? {};
  const datasetPayload = normalizePayload(payload.dataset) ?? {};
  const upstreamId =
    datasetPayload.id ??
    payload.id ??
    payload.name ??
    payload.entity ??
    payload.schema ??
    null;
  const idCandidate = record.id ?? upstreamId ?? payload.name ?? payload.entity ?? payload.schema ?? record.domain;
  if (!idCandidate) {
    return null;
  }
  const id = String(idCandidate);
  const displayName = String(
    datasetPayload.displayName ??
      datasetPayload.name ??
      payload.displayName ??
      payload.name ??
      upstreamId ??
      id ??
      "Dataset",
  );
  const description = datasetPayload.description ?? payload.description ?? null;
  const source = datasetPayload.location ?? payload.source ?? null;
  const projectIds = mergeStrings(datasetPayload.projectIds, payload.projectIds);
  const labels = dedupeStrings([record.labels, payload.labels, datasetPayload.labels, datasetPayload.tags]);
  const schema = extractDatasetSchema(payload, record);
  const entity = extractDatasetEntity(payload, record);
  const collectedAt = extractCollectedAt(payload, record);
  const statistics = (payload.statistics ?? datasetPayload.statistics) as Record<string, unknown> | undefined;
  const profile = buildDatasetProfile(statistics);
  const sampleRows = extractSampleRows(payload);
  const sourceEndpointId = extractSourceEndpointId(payload);

  return {
    id,
    upstreamId: upstreamId ?? null,
    displayName,
    description,
    source,
    projectIds: projectIds.length ? projectIds : undefined,
    labels: labels.length ? labels : undefined,
    schema,
    entity,
    collectedAt,
    sourceEndpointId,
    profile,
    sampleRows,
    statistics: statistics ?? null,
    fields: extractDatasetFields(payload),
  };
}

async function filterDatasetsByActiveEndpoints(
  datasets: CatalogDataset[],
  store: MetadataStore,
  projectId?: string | null,
): Promise<CatalogDataset[]> {
  const endpointIds = Array.from(
    new Set(
      datasets
        .map((dataset) => resolveDatasetEndpointId(dataset))
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );
  if (endpointIds.length === 0) {
    return datasets;
  }
  const endpoints = await store.listEndpoints(projectId ?? undefined);
  if (!endpoints.length) {
    return datasets;
  }
  const deletedIds = new Set(
    endpoints.filter((endpoint) => Boolean(endpoint.deletedAt)).map((endpoint) => endpoint.id),
  );
  if (!deletedIds.size) {
    return datasets;
  }
  const filtered = datasets.filter((dataset) => {
    const sourceId = resolveDatasetEndpointId(dataset);
    return !sourceId || !deletedIds.has(sourceId);
  });
  return filtered.length > 0 ? filtered : datasets;
}

function resolveDatasetEndpointId(dataset: CatalogDataset): string | null {
  if (dataset.sourceEndpointId && dataset.sourceEndpointId.trim().length > 0) {
    return dataset.sourceEndpointId;
  }
  const label = dataset.labels?.find((entry) => typeof entry === "string" && entry.startsWith("endpoint:"));
  if (!label) {
    return null;
  }
  const [, endpointId] = label.split("endpoint:");
  return endpointId?.trim().length ? endpointId.trim() : null;
}

function filterTemplatesByFamily(templates: EndpointTemplate[], family?: "JDBC" | "HTTP" | "STREAM" | null) {
  if (!family) {
    return templates;
  }
  return templates.filter((template) => template.family === family);
}

function normalizeEndpointForGraphQL(
  endpoint: MetadataEndpointDescriptor | null,
): (MetadataEndpointDescriptor & { isDeleted: boolean }) | null {
  if (!endpoint) {
    return null;
  }
  return { ...endpoint, isDeleted: Boolean(endpoint.deletedAt) };
}

function normalizeEndpointListForGraphQL(
  endpoints: MetadataEndpointDescriptor[],
  includeDeleted = false,
): Array<MetadataEndpointDescriptor & { isDeleted: boolean }> {
  const filtered = includeDeleted ? endpoints : endpoints.filter((endpoint) => !endpoint.deletedAt);
  return filtered.map((endpoint) => ({ ...endpoint, isDeleted: Boolean(endpoint.deletedAt) }));
}

async function buildFallbackEndpointConfig(
  store: MetadataStore,
  templateId: string,
  parameters: Record<string, string>,
): Promise<EndpointBuildResult | null> {
  const descriptors = (await store.listEndpointTemplates()) as unknown as EndpointTemplate[];
  const template =
    descriptors.find((entry) => entry.id === templateId) ??
    DEFAULT_ENDPOINT_TEMPLATES.find((entry) => entry.id === templateId);
  if (!template) {
    return null;
  }
  const urlTemplate = template.connection?.urlTemplate;
  if (!urlTemplate) {
    return null;
  }
  let resolved = urlTemplate;
  resolved = resolved.replace(/{{\s*([^}]+)\s*}}/g, (_match, key: string) => {
    const normalizedKey = String(key).trim();
    const replacement = parameters[normalizedKey];
    return typeof replacement === "string" ? replacement : "";
  });
  resolved = resolved.replace(/{{[^}]+}}/g, "");
  const trimmedUrl = resolved.trim();
  if (!trimmedUrl) {
    return null;
  }
  return {
    url: trimmedUrl,
    config: { templateId, parameters },
    labels: template.defaultLabels ?? undefined,
    domain: template.domain ?? undefined,
    verb: template.connection?.defaultVerb ?? "POST",
  };
}

async function triggerCollectionForEndpoint(
  ctx: ResolverContext,
  store: MetadataStore,
  endpointId: string,
  options?: {
    filters?: Record<string, unknown> | null;
    schemaOverride?: string[] | null;
    reason?: "register" | "manual";
    descriptor?: MetadataEndpointDescriptor | null;
    collection?: PrismaCollectionWithEndpoint | null;
  },
) {
  const prisma = await getPrismaClient();
  let endpoint = await prisma.metadataEndpoint.findUnique({ where: { id: endpointId } });
  if (!endpoint) {
    console.warn("[metadata.collection] endpoint lookup miss", {
      endpointId,
      hasDescriptor: Boolean(options?.descriptor),
    });
    const descriptor =
      options?.descriptor ??
      (await store
        .listEndpoints(ctx.auth.projectId ?? undefined)
        .then((endpoints) => endpoints.find((entry) => entry.id === endpointId || entry.sourceId === endpointId))
        .catch(() => null));
    if (descriptor) {
      try {
        await ensurePrismaProjectRecord(prisma, descriptor.projectId ?? ctx.auth.projectId ?? null);
        endpoint = await prisma.metadataEndpoint.upsert({
          where: { id: descriptor.id ?? endpointId },
          update: mapDescriptorToPrismaPayload(descriptor),
          create: mapDescriptorToPrismaPayload(descriptor, { includeId: true, fallbackId: endpointId }),
        });
      } catch (error) {
        console.warn("[metadata.collection] unable to seed endpoint for collection", {
          endpointId,
          descriptorId: descriptor.id ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  }
  if (!endpoint) {
    throw new GraphQLError("Endpoint not found", { extensions: { code: "E_ENDPOINT_NOT_FOUND" } });
  }
  const endpointParameters = parseTemplateParameters(endpoint.config as Record<string, unknown>);
  if (endpoint.deletedAt) {
    throw new GraphQLError("Endpoint has been deleted.", { extensions: { code: "E_ENDPOINT_DELETED" } });
  }
  if (hasPlaywrightInvalidCredentialsFromParameters(endpointParameters)) {
    throw new GraphQLError("Connection test failed. Re-test before triggering a collection.", {
      extensions: { code: "E_CONN_INVALID" },
    });
  }
  if (!endpoint.url) {
    throw new GraphQLError("Endpoint is missing a connection URL", {
      extensions: { code: "E_CONN_TEST_REQUIRED" },
    });
  }
  if (Array.isArray(endpoint.capabilities) && endpoint.capabilities.length > 0 && !endpoint.capabilities.includes("metadata")) {
    throw new GraphQLError("Endpoint is missing the required \"metadata\" capability.", {
      extensions: { code: "E_CAPABILITY_MISSING" },
    });
  }
  const collectionRecord =
    options?.collection ??
    ((await prisma.metadataCollection.findFirst({
      where: { endpointId: endpoint.id },
      include: { endpoint: true },
      orderBy: { createdAt: "asc" },
    })) as PrismaCollectionWithEndpoint | null);
  if (!collectionRecord) {
    throw new GraphQLError("Collection not found for this endpoint.", {
      extensions: { code: "E_COLLECTION_NOT_FOUND" },
    });
  }
  await ensureCollectionIsEnabled(collectionRecord);
  await ensureCollectionIdle(prisma, collectionRecord.id);
  const filters =
    options?.filters ??
    (options?.schemaOverride && options.schemaOverride.length ? buildRunFilters(options.schemaOverride) : undefined);
  const requestedBy = resolveRequestedBy(ctx);
  const run = await createCollectionRunRecord(prisma, {
    endpointId: endpoint.id,
    collectionId: collectionRecord.id,
    requestedBy,
    filters,
  });
  if (shouldBypassCollection(ctx)) {
    const bypassReason = endpoint.url ? resolveBypassFailureReason(endpoint.url) : null;
    const status: MetadataCollectionStatus = bypassReason ? "FAILED" : "SUCCEEDED";
    return finalizeCollectionRun(prisma, run.id, status, bypassReason);
  }
  const { client, taskQueue } = await getTemporalClient();
  const workflowIdPrefix = options?.reason === "register" ? "metadata-collection-initial" : "metadata-collection";
  const workflowId = `${workflowIdPrefix}-${run.id}`;
  const handle = await client.workflow.start(WORKFLOW_NAMES.collectionRun, {
    taskQueue,
    workflowId,
    args: [{ runId: run.id, endpointId: endpoint.id, collectionId: collectionRecord.id }],
  });
  await prisma.metadataCollectionRun.update({
    where: { id: run.id },
    data: {
      workflowId: handle.workflowId,
      temporalRunId: handle.firstExecutionRunId,
    },
  });
  return prisma.metadataCollectionRun.findUnique({ where: { id: run.id }, include: { endpoint: true, collection: true } });
}

function shouldBypassCollection(context: ResolverContext): boolean {
  return Boolean(context.bypassWrites || process.env.METADATA_FAKE_COLLECTIONS === "1");
}

function resolveBypassFailureReason(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname.endsWith(".example.com") || hostname.endsWith(".invalid") || hostname.endsWith(".test")) {
      return "Endpoint URL points to a placeholder host and cannot be collected.";
    }
    return null;
  } catch {
    if (/^https?:/i.test(url.trim())) {
      return "Endpoint URL is invalid.";
    }
    return null;
  }
}

async function finalizeCollectionRun(
  prisma: Awaited<ReturnType<typeof getPrismaClient>>,
  runId: string,
  status: MetadataCollectionStatus,
  error?: string | null,
) {
  return prisma.metadataCollectionRun.update({
    where: { id: runId },
    data: {
      status,
      error: error ?? null,
      completedAt: new Date(),
    },
    include: { endpoint: true, collection: true },
  });
}

async function ensurePrismaProjectRecord(
  prisma: Awaited<ReturnType<typeof getPrismaClient>>,
  projectId?: string | null,
): Promise<void> {
  if (!projectId) {
    return;
  }
  const normalized = projectId.trim();
  if (!normalized.length) {
    return;
  }
  await prisma.metadataProject.upsert({
    where: { id: normalized },
    update: { updatedAt: new Date() },
    create: {
      id: normalized,
      slug: slugify(normalized),
      displayName: normalized,
    },
  });
}

async function resolveProjectRecordId(
  prisma: Awaited<ReturnType<typeof getPrismaClient>>,
  projectId?: string | null,
): Promise<string | null> {
  if (!projectId) {
    return null;
  }
  const normalized = projectId.trim();
  if (!normalized.length) {
    return null;
  }
  const direct = await prisma.metadataProject.findUnique({ where: { id: normalized } });
  if (direct?.id) {
    return direct.id;
  }
  const slug = slugify(normalized);
  const bySlug = await prisma.metadataProject.findUnique({ where: { slug } });
  return bySlug?.id ?? null;
}

function mapDescriptorToPrismaPayload(
  descriptor: MetadataEndpointDescriptor,
  options?: { includeId?: boolean; fallbackId?: string },
) {
  const payload: Record<string, unknown> = {
    sourceId: descriptor.sourceId ?? descriptor.id ?? options?.fallbackId ?? randomUUID(),
    name: descriptor.name,
    description: descriptor.description ?? null,
    verb: descriptor.verb ?? "POST",
    url: descriptor.url ?? "",
    authPolicy: descriptor.authPolicy ?? null,
    projectId: descriptor.projectId ?? null,
    domain: descriptor.domain ?? null,
    labels: descriptor.labels ?? [],
    config: descriptor.config ?? null,
    detectedVersion: descriptor.detectedVersion ?? null,
    versionHint: descriptor.versionHint ?? null,
    capabilities: descriptor.capabilities ?? [],
    deletedAt: descriptor.deletedAt ?? null,
    deletionReason: descriptor.deletionReason ?? null,
  };
  if (options?.includeId) {
    payload.id = descriptor.id ?? options.fallbackId ?? randomUUID();
  }
  return payload;
}

function slugify(value: string): string {
  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function normalizePayload(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, any>;
}

function mergeStrings(
  first?: unknown,
  second?: unknown,
): string[] {
  return dedupeStrings([first, second]);
}

function dedupeStrings(groups: Array<unknown>): string[] {
  const values = groups
    .flatMap((group) => {
      if (Array.isArray(group)) {
        return group;
      }
      return [];
    })
    .map((value) => (typeof value === "string" ? value : String(value ?? "")))
    .map((value) => value.trim())
    .filter((value) => Boolean(value));
  return Array.from(new Set(values));
}

function extractDatasetFields(payload: Record<string, any>): Array<{ name: string; type: string; description?: string | null }> {
  const datasetPayload = normalizePayload(payload.dataset);
  const candidates = [payload.schema_fields, payload.columns, payload.fields, datasetPayload?.fields];
  const fields = candidates.find((field) => Array.isArray(field)) || [];
  return (fields as any[]).map((field) => ({
    name: String(field?.name ?? field?.column_name ?? ""),
    type: String(field?.data_type ?? field?.type ?? "string"),
    description: field?.description ?? field?.comment ?? null,
  }));
}

function extractDatasetSchema(payload: Record<string, any>, record: MetadataRecord<unknown>): string | null {
  const schema =
    payload.endpoint?.schema ??
    payload.schema ??
    payload.namespace ??
    payload.environment?.schema ??
    payload.endpoint?.schema ??
    record.projectId ??
    null;
  return schema ? String(schema) : null;
}

function extractDatasetEntity(payload: Record<string, any>, record: MetadataRecord<unknown>): string | null {
  const entity =
    payload.endpoint?.table ?? payload.name ?? payload.entity ?? payload.dataset?.name ?? record.id ?? null;
  return entity ? String(entity) : null;
}

function extractCollectedAt(payload: Record<string, any>, record: MetadataRecord<unknown>): string | null {
  const ts = payload.collected_at ?? payload.produced_at ?? payload.producedAt ?? record.updatedAt;
  return normalizeDateTimeValue(ts);
}

function extractSourceEndpointId(payload: Record<string, any>): string | null {
  return (
    payload.metadata_endpoint_id ??
    payload.metadata_config?.endpointId ??
    payload.artifact_config?.metadata_endpoint_id ??
    payload.endpoint?.id ??
    payload._metadata?.source_endpoint_id ??
    payload._metadata?.source_id ??
    null
  );
}

function buildDatasetProfile(stats?: Record<string, unknown>): CatalogDatasetProfile | null {
  if (!stats || typeof stats !== "object") {
    return null;
  }
  const recordCount = stats.record_count ?? stats.rowCount;
  const sampleSize = stats.sample_size ?? stats.sampleSize;
  const lastProfiledAt = stats.last_profiled_at ?? stats.lastProfiledAt;
  return {
    recordCount: recordCount == null ? null : Number(recordCount),
    sampleSize: sampleSize == null ? null : Number(sampleSize),
    lastProfiledAt: normalizeDateTimeValue(lastProfiledAt),
    raw: stats,
  };
}

function normalizeDateTimeValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.length) {
      return null;
    }
    const date = new Date(trimmed);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

function extractSampleRows(payload: Record<string, any>): unknown[] {
  const candidates = [payload.sample_rows, payload.samples, payload.preview?.rows, payload.preview];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }
  return [];
}

function buildRunFilters(schemas?: string[] | null): Record<string, unknown> | undefined {
  if (!schemas || schemas.length === 0) {
    return undefined;
  }
  const normalized = schemas.map((schema) => schema.trim()).filter(Boolean);
  return normalized.length ? { schemas: normalized } : undefined;
}

function resolveRequestedBy(context: ResolverContext | null | undefined): string | null {
  if (!context) {
    return null;
  }
  const headerUser = context.userId?.trim();
  if (headerUser) {
    return headerUser;
  }
  const subject = context.auth?.subject?.trim();
  if (subject && subject !== "anonymous") {
    return subject;
  }
  return null;
}

type PrismaClientInstance = Awaited<ReturnType<typeof getPrismaClient>>;
type PrismaCollectionRecord = Awaited<ReturnType<PrismaClientInstance["metadataCollection"]["findUnique"]>>;
type PrismaCollectionWithEndpoint = PrismaCollectionRecord & { endpoint: any };

async function fetchCollectionWithEndpoint(
  prisma: PrismaClientInstance,
  id: string,
): Promise<PrismaCollectionWithEndpoint | null> {
  return prisma.metadataCollection.findUnique({
    where: { id },
    include: { endpoint: true },
  }) as Promise<PrismaCollectionWithEndpoint | null>;
}

async function ensureDefaultCollectionForEndpoint(
  prisma: PrismaClientInstance,
  endpointId: string,
): Promise<PrismaCollectionWithEndpoint> {
  const existing = await prisma.metadataCollection.findFirst({
    where: { endpointId },
    include: { endpoint: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    return existing as PrismaCollectionWithEndpoint;
  }
  const created = await prisma.metadataCollection.create({
    data: {
      endpointId,
      scheduleCron: null,
      scheduleTimezone: "UTC",
      isEnabled: true,
    },
    include: { endpoint: true },
  });
  return created as PrismaCollectionWithEndpoint;
}

async function assertCollectionVisible(
  collection: PrismaCollectionWithEndpoint | null,
  projectRowId: string | null,
): Promise<PrismaCollectionWithEndpoint> {
  if (!collection || !collection.endpoint) {
    throw new GraphQLError("Collection not found", { extensions: { code: "E_COLLECTION_NOT_FOUND" } });
  }
  if (projectRowId && collection.endpoint.projectId && collection.endpoint.projectId !== projectRowId) {
    throw new GraphQLError("Collection not found", { extensions: { code: "E_COLLECTION_NOT_FOUND" } });
  }
  return collection;
}

async function ensureCollectionIsEnabled(collection: PrismaCollectionWithEndpoint) {
  if (!collection.isEnabled) {
    throw new GraphQLError("Collection is disabled.", { extensions: { code: "E_COLLECTION_DISABLED" } });
  }
}

async function ensureCollectionIdle(prisma: PrismaClientInstance, collectionId: string) {
  const activeRun = await prisma.metadataCollectionRun.findFirst({
    where: { collectionId, status: "RUNNING" },
  });
  if (activeRun) {
    throw new GraphQLError("Collection already has an active run.", {
      extensions: { code: "E_COLLECTION_IN_PROGRESS", runId: activeRun.id },
    });
  }
}

async function createCollectionRunRecord(
  prisma: PrismaClientInstance,
  params: {
    endpointId: string;
    collectionId?: string | null;
    requestedBy?: string | null;
    filters?: Record<string, unknown> | null;
  },
) {
  return prisma.metadataCollectionRun.create({
    data: {
      endpointId: params.endpointId,
      collectionId: params.collectionId ?? null,
      status: "QUEUED",
      requestedBy: params.requestedBy ?? null,
      filters: params.filters ?? undefined,
    },
    include: { endpoint: true, collection: true },
  });
}

function buildCollectionScheduleId(collectionId: string): string {
  return `${COLLECTION_SCHEDULE_PREFIX}::${collectionId}`;
}

type GraphScopeFilter = {
  orgId: string;
  domainId?: string | null;
  projectId?: string | null;
  teamId?: string | null;
};

type GraphNodeRecordShape = {
  id: string;
  tenantId: string;
  projectId?: string | null;
  entityType: string;
  displayName: string;
  canonicalPath?: string | null;
  sourceSystem?: string | null;
  specRef?: string | null;
  properties?: Record<string, unknown> | null;
  version?: number | null;
  phase?: string | null;
  scope: GraphScopeFilter;
  originEndpointId?: string | null;
  originVendor?: string | null;
  logicalKey: string;
  externalId?: unknown;
  provenance?: unknown;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type GraphEdgeRecordShape = {
  id: string;
  tenantId: string;
  projectId?: string | null;
  edgeType: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceLogicalKey: string;
  targetLogicalKey: string;
  scope: GraphScopeFilter;
  originEndpointId?: string | null;
  originVendor?: string | null;
  logicalKey: string;
  confidence?: number | null;
  specRef?: string | null;
  metadata?: Record<string, unknown> | null;
  externalId?: unknown;
  phase?: string | null;
  provenance?: unknown;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type SampleGraph = {
  nodes: GraphNodeRecordShape[];
  edges: GraphEdgeRecordShape[];
};

function buildSampleGraphDataForTenant(orgId: string, projectId?: string | null): SampleGraph {
  const targetProject = projectId ?? (sampleMetadata.projectId as string | undefined) ?? DEFAULT_PROJECT_ID;
  const endpointBlueprint = (sampleMetadata.endpoints?.[0] ?? {}) as Partial<MetadataEndpointDescriptor>;
  const datasetBlueprint = (sampleMetadata.datasets?.[0]?.payload?.dataset ?? {}) as Record<string, unknown>;
  const datasetId = (sampleMetadata.datasets?.[0]?.id as string | undefined) ?? "sample_catalog_dataset";
  const derivedDatasetId = `${datasetId}_derived`;
  const endpointId = endpointBlueprint.id ?? "sample_endpoint";
  const nodes: GraphNodeRecordShape[] = [
    createSampleGraphNode(
      {
        id: datasetId,
        entityType: CATALOG_DATASET_DOMAIN,
        displayName: (datasetBlueprint.displayName as string | undefined) ?? "Sample Catalog Dataset",
        canonicalPath: (datasetBlueprint.id as string | undefined) ?? datasetId,
        description: (datasetBlueprint.description as string | undefined) ?? "Synthetic dataset seeded for demos.",
        originEndpointId: endpointId,
        originVendor: endpointBlueprint.domain ?? "postgres",
        properties: {
          datasetId,
          sample: true,
          fields: datasetBlueprint.fields ?? [],
        },
      },
      orgId,
      targetProject,
    ),
    createSampleGraphNode(
      {
        id: derivedDatasetId,
        entityType: CATALOG_DATASET_DOMAIN,
        displayName: "Derived Jira Insights",
        canonicalPath: "derived/jira/insights",
        description: "Downstream dataset joined with Jira users.",
        originEndpointId: endpointId,
        originVendor: endpointBlueprint.domain ?? "postgres",
        properties: {
          datasetId: derivedDatasetId,
          sample: true,
          fields: [{ name: "issue_id", type: "STRING" }],
        },
      },
      orgId,
      targetProject,
    ),
    createSampleGraphNode(
      {
        id: endpointId,
        entityType: "metadata.endpoint",
        displayName: endpointBlueprint.name ?? "Sample Warehouse Endpoint",
        canonicalPath: endpointBlueprint.url ?? "postgresql://sample-host:5432/analytics",
        description: endpointBlueprint.description ?? "Seeded PostgreSQL endpoint used for demos.",
        originEndpointId: endpointId,
        originVendor: endpointBlueprint.domain ?? "postgres",
        properties: {
          vendor: endpointBlueprint.domain ?? "postgres",
          url: endpointBlueprint.url ?? "postgresql://sample-host:5432/analytics",
        },
      },
      orgId,
      targetProject,
    ),
    createSampleGraphNode(
      {
        id: "sample_doc_runbook",
        entityType: "doc.page",
        displayName: "Metadata Runbook",
        canonicalPath: "/docs/runbooks/metadata",
        description: "Explains metadata synchronization procedures.",
        properties: {
          url: "https://docs.nucleus.local/runbooks/metadata",
        },
      },
      orgId,
      targetProject,
    ),
  ];
  const edges: GraphEdgeRecordShape[] = [
    createSampleGraphEdge("sample_edge_dataset_dependency", "DEPENDENCY_OF", nodes[0], nodes[1], orgId, targetProject),
    createSampleGraphEdge("sample_edge_dataset_endpoint", "DOCUMENTED_BY", nodes[0], nodes[2], orgId, targetProject),
    createSampleGraphEdge("sample_edge_derived_runbook", "DOCUMENTED_BY", nodes[1], nodes[3], orgId, targetProject),
  ];
  return { nodes, edges };
}

function createSampleGraphNode(
  seed: {
    id: string;
    entityType: string;
    displayName: string;
    canonicalPath?: string | null;
    description?: string | null;
    scopeDomainId?: string | null;
    scopeTeamId?: string | null;
    originEndpointId?: string | null;
    originVendor?: string | null;
    properties?: Record<string, unknown>;
  },
  orgId: string,
  projectId: string,
): GraphNodeRecordShape {
  return {
    id: seed.id,
    tenantId: orgId,
    projectId,
    entityType: seed.entityType,
    displayName: seed.displayName,
    canonicalPath: seed.canonicalPath ?? null,
    sourceSystem: seed.originVendor ?? "sample",
    specRef: null,
    properties: {
      description: seed.description ?? undefined,
      ...(seed.properties ?? {}),
    },
    version: 1,
    phase: "SYNTHETIC",
    scope: {
      orgId,
      domainId: seed.scopeDomainId ?? null,
      projectId,
      teamId: seed.scopeTeamId ?? null,
    },
    originEndpointId: seed.originEndpointId ?? null,
    originVendor: seed.originVendor ?? null,
    logicalKey: `sample::${orgId}::${projectId}::${seed.id}`,
    externalId: { sampleId: seed.id },
    provenance: { sample: true },
    createdAt: KB_SAMPLE_TIMESTAMP,
    updatedAt: KB_SAMPLE_TIMESTAMP,
  };
}

function createSampleGraphEdge(
  id: string,
  edgeType: string,
  source: GraphNodeRecordShape,
  target: GraphNodeRecordShape,
  orgId: string,
  projectId: string,
): GraphEdgeRecordShape {
  return {
    id,
    tenantId: orgId,
    projectId,
    edgeType,
    sourceNodeId: source.id,
    targetNodeId: target.id,
    sourceLogicalKey: source.logicalKey,
    targetLogicalKey: target.logicalKey,
    scope: {
      orgId,
      domainId: source.scope.domainId ?? target.scope.domainId ?? null,
      projectId,
      teamId: source.scope.teamId ?? target.scope.teamId ?? null,
    },
    originEndpointId: source.originEndpointId ?? target.originEndpointId ?? null,
    originVendor: source.originVendor ?? target.originVendor ?? null,
    logicalKey: `sample::${orgId}::${projectId}::${id}`,
    confidence: 0.8,
    specRef: null,
    metadata: { sample: true },
    externalId: { sampleId: id },
    phase: "SYNTHETIC",
    provenance: { sample: true },
    createdAt: KB_SAMPLE_TIMESTAMP,
    updatedAt: KB_SAMPLE_TIMESTAMP,
  };
}

function matchesSampleNodeFilters(
  record: GraphNodeRecordShape,
  scope: GraphScopeFilter,
  typeFilter?: string | null,
  searchValue?: string,
): boolean {
  if (!matchesGraphScope(record.scope, scope)) {
    return false;
  }
  if (typeFilter && record.entityType !== typeFilter) {
    return false;
  }
  if (searchValue && searchValue.length > 0) {
    const haystack = buildNodeSearchHaystack(record);
    if (!haystack.includes(searchValue)) {
      return false;
    }
  }
  return true;
}

function matchesSampleEdgeFilters(
  record: GraphEdgeRecordShape,
  scope: GraphScopeFilter,
  args: { edgeType?: string | null; sourceId?: string | null; targetId?: string | null },
): boolean {
  if (!matchesGraphScope(record.scope, scope)) {
    return false;
  }
  if (args.edgeType && record.edgeType !== args.edgeType) {
    return false;
  }
  if (args.sourceId && record.sourceNodeId !== args.sourceId) {
    return false;
  }
  if (args.targetId && record.targetNodeId !== args.targetId) {
    return false;
  }
  return true;
}

function buildNodeSearchHaystack(record: GraphNodeRecordShape): string {
  return `${record.displayName ?? ""} ${record.canonicalPath ?? ""} ${JSON.stringify(record.properties ?? {})}`.toLowerCase();
}

type GraphCursor = {
  id: string;
};

async function resolveKbFacets(store: MetadataStore, scopeInput: GraphQLGraphScopeInput | null, ctx: ResolverContext) {
  const scope = normalizeGraphScopeFilter(ctx, scopeInput);
  const cacheKey = buildFacetCacheKey(scope);
  const now = Date.now();
  const cached = kbFacetCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.payload;
  }
  const prisma = await tryGetPrismaGraphClient();
  let facets: GraphQLKbFacets | null = null;
  if (prisma) {
    try {
      facets = await buildPrismaKbFacets(prisma, scope);
    } catch (error) {
      logGraphFallback(error, "resolveKbFacets");
    }
  }
  if (!facets) {
    facets = await buildStoreKbFacets(store, scope);
  }
  const payload = facets ?? { nodeTypes: [], edgeTypes: [], projects: [], domains: [], teams: [] };
  kbFacetCache.set(cacheKey, { expiresAt: now + KB_FACET_CACHE_TTL_MS, payload });
  return payload;
}

async function resolveKbNodes(
  store: MetadataStore,
  args: { type?: string | null; scope?: GraphQLGraphScopeInput | null; search?: string | null; first?: number | null; after?: string | null },
  ctx: ResolverContext,
) {
  const limit = clampConnectionLimit(args.first ?? undefined, KB_NODES_DEFAULT_PAGE_SIZE, KB_NODES_MAX_PAGE_SIZE);
  const cursor = decodeGraphCursor(args.after);
  const scope = normalizeGraphScopeFilter(ctx, args.scope);
  const searchValue = args.search?.trim().toLowerCase() ?? "";
  const allowSampleFallback = ENABLE_SAMPLE_FALLBACK && !args.after;
  const prisma = await tryGetPrismaGraphClient();
  if (prisma?.graphNode?.findMany) {
    try {
      const where = buildPrismaGraphNodeWhere(scope, args.type, args.search);
      const totalCount = await prisma.graphNode.count({ where });
      const records = await prisma.graphNode.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      });
      const mapped = records.map(mapPrismaGraphNodeRecord);
      return buildNodeConnection(mapped, limit, totalCount, Boolean(args.after));
    } catch (error) {
      logGraphFallback(error, "resolveKbNodes");
    }
  }
  const records = await safeListGraphNodes(store, {
    scopeOrgId: scope.orgId,
    entityTypes: args.type ? [args.type] : undefined,
    search: args.search ?? undefined,
  }, "resolveKbNodes:store");
  let filtered = sortGraphNodeRecords(records.filter((record) => matchesGraphScope(record.scope, scope)));
  if (!filtered.length && allowSampleFallback) {
    const sampleGraph = buildSampleGraphDataForTenant(scope.orgId, scope.projectId ?? ctx.auth.projectId);
    filtered = sortGraphNodeRecords(
      sampleGraph.nodes.filter((record) => matchesSampleNodeFilters(record, scope, args.type, searchValue)),
    );
  }
  const window = sliceRecordsAfterCursor(filtered, cursor, limit);
  return buildNodeConnection(window, limit, filtered.length, Boolean(args.after));
}

async function resolveKbEdges(
  store: MetadataStore,
  args: {
    edgeType?: string | null;
    scope?: GraphQLGraphScopeInput | null;
    sourceId?: string | null;
    targetId?: string | null;
    first?: number | null;
    after?: string | null;
  },
  ctx: ResolverContext,
) {
  const limit = clampConnectionLimit(args.first ?? undefined, KB_EDGES_DEFAULT_PAGE_SIZE, KB_EDGES_MAX_PAGE_SIZE);
  const cursor = decodeGraphCursor(args.after);
  const scope = normalizeGraphScopeFilter(ctx, args.scope);
  const allowSampleFallback = ENABLE_SAMPLE_FALLBACK && !args.after && !args.sourceId && !args.targetId;
  const prisma = await tryGetPrismaGraphClient();
  if (prisma?.graphEdge?.findMany) {
    try {
      const where = buildPrismaGraphEdgeWhere(scope, args.edgeType, args.sourceId, args.targetId);
      const totalCount = await prisma.graphEdge.count({ where });
      const records = await prisma.graphEdge.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      });
      const mapped = records.map(mapPrismaGraphEdgeRecord);
      return buildEdgeConnection(mapped, limit, totalCount, Boolean(args.after));
    } catch (error) {
      logGraphFallback(error, "resolveKbEdges");
    }
  }
  const filters = {
    scopeOrgId: scope.orgId,
    edgeTypes: args.edgeType ? [args.edgeType] : undefined,
    sourceNodeId: args.sourceId ?? undefined,
    targetNodeId: args.targetId ?? undefined,
  };
  const records = await safeListGraphEdges(store, filters, "resolveKbEdges:store");
  let filtered = sortGraphEdgeRecords(records.filter((record) => matchesGraphScope(record.scope, scope)));
  if (!filtered.length && allowSampleFallback) {
    const sampleGraph = buildSampleGraphDataForTenant(scope.orgId, scope.projectId ?? ctx.auth.projectId);
    filtered = sortGraphEdgeRecords(
      sampleGraph.edges.filter((record) => matchesSampleEdgeFilters(record, scope, { edgeType: args.edgeType, sourceId: args.sourceId, targetId: args.targetId })),
    );
  }
  const window = sliceRecordsAfterCursor(filtered, cursor, limit);
  return buildEdgeConnection(window, limit, filtered.length, Boolean(args.after));
}

async function resolveKbNode(store: MetadataStore, id: string, ctx: ResolverContext) {
  const prisma = await tryGetPrismaGraphClient();
  if (prisma?.graphNode?.findUnique) {
    try {
      const record = await prisma.graphNode.findUnique({ where: { id } });
      if (!record || record.scopeOrgId !== ctx.auth.tenantId) {
        return null;
      }
      return mapGraphNodeRecordToGraphQL(mapPrismaGraphNodeRecord(record));
    } catch (error) {
      logGraphFallback(error, "resolveKbNode");
    }
  }
  const record = await safeGetGraphNodeById(store, id, "resolveKbNode:store");
  if (!record || record.scope.orgId !== ctx.auth.tenantId) {
    if (ENABLE_SAMPLE_FALLBACK) {
      const sampleNode = buildSampleGraphDataForTenant(ctx.auth.tenantId, ctx.auth.projectId).nodes.find((node) => node.id === id);
      if (sampleNode) {
        return mapGraphNodeRecordToGraphQL(sampleNode);
      }
    }
    return null;
  }
  return mapGraphNodeRecordToGraphQL(record);
}

async function resolveKbScene(
  store: MetadataStore,
  args: { id: string; edgeTypes?: string[] | null; depth?: number | null; limit?: number | null },
  ctx: ResolverContext,
) {
  const depth = Math.max(1, Math.min(args.depth ?? 2, 3));
  const nodeCap = Math.max(1, Math.min(args.limit ?? KB_SCENE_NODE_CAP, KB_SCENE_NODE_CAP));
  const prisma = await tryGetPrismaGraphClient();
  const edgeTypes = (args.edgeTypes ?? []).filter((value) => typeof value === "string" && value.trim().length > 0);
  const { nodeRecord: rootNode, graphNodeFetcher, sampleGraph } = await fetchGraphNodeForScene(store, prisma, args.id, ctx);
  const nodesMap = new Map<string, GraphNodeRecordShape>();
  nodesMap.set(rootNode.id, rootNode);
  const edgesMap = new Map<string, GraphEdgeRecordShape>();
  const queue: Array<{ id: string; depth: number }> = [{ id: rootNode.id, depth: 0 }];
  while (queue.length > 0 && nodesMap.size < nodeCap && edgesMap.size < KB_SCENE_EDGE_CAP) {
    const current = queue.shift()!;
    if (current.depth >= depth) {
      continue;
    }
    const remainingEdges = KB_SCENE_EDGE_CAP - edgesMap.size;
    if (remainingEdges <= 0) {
      break;
    }
    const neighbors = sampleGraph
      ? sampleGraph.edges
          .filter((edge) => edge.sourceNodeId === current.id || edge.targetNodeId === current.id)
          .filter((edge) => (edgeTypes.length ? edgeTypes.includes(edge.edgeType) : true))
          .slice(0, remainingEdges)
      : await fetchEdgesForNode(store, prisma, ctx.auth.tenantId, current.id, edgeTypes, remainingEdges);
    for (const edge of neighbors) {
      if (!edgesMap.has(edge.id)) {
        edgesMap.set(edge.id, edge);
      }
      const neighborId = edge.sourceNodeId === current.id ? edge.targetNodeId : edge.sourceNodeId;
      if (!nodesMap.has(neighborId) && nodesMap.size < nodeCap) {
        const nextNode = await graphNodeFetcher(neighborId);
        if (nextNode && nextNode.scope.orgId === ctx.auth.tenantId) {
          nodesMap.set(nextNode.id, nextNode);
          queue.push({ id: nextNode.id, depth: current.depth + 1 });
        }
      }
    }
  }
  const truncated = nodesMap.size >= nodeCap || edgesMap.size >= KB_SCENE_EDGE_CAP;
  const nodes = sortGraphNodeRecords(Array.from(nodesMap.values())).map(mapGraphNodeRecordToGraphQL);
  const edges = sortGraphEdgeRecords(Array.from(edgesMap.values())).map(mapGraphEdgeRecordToGraphQL);
  return {
    nodes,
    edges,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      truncated,
    },
  };
}

async function buildPrismaKbFacets(prisma: PrismaClientInstance, scope: GraphScopeFilter): Promise<GraphQLKbFacets | null> {
  if (!prisma?.graphNode?.groupBy) {
    return null;
  }
  const nodeWhere = buildPrismaGraphNodeWhere(scope, null, null);
  const edgeWhere = buildPrismaGraphEdgeWhere(scope, null, null, null);
  const [
    nodeTypeGroups,
    projectGroups,
    domainGroups,
    teamGroups,
    edgeTypeGroups,
  ] = await Promise.all([
    prisma.graphNode.groupBy({ by: ["entityType"], where: nodeWhere, _count: { _all: true } }),
    prisma.graphNode.groupBy({ by: ["scopeProjectId"], where: nodeWhere, _count: { _all: true } }),
    prisma.graphNode.groupBy({ by: ["scopeDomainId"], where: nodeWhere, _count: { _all: true } }),
    prisma.graphNode.groupBy({ by: ["scopeTeamId"], where: nodeWhere, _count: { _all: true } }),
    prisma.graphEdge?.groupBy
      ? prisma.graphEdge.groupBy({ by: ["edgeType"], where: edgeWhere, _count: { _all: true } })
      : Promise.resolve([]),
  ]);
  const projectLabelMap = await resolveProjectLabelMap(prisma, projectGroups.map((group: any) => group.scopeProjectId));
  const domainLabelMap = await resolveDomainLabelMap(prisma, domainGroups.map((group: any) => group.scopeDomainId));
  return {
    nodeTypes: formatFacetGroup(nodeTypeGroups as any[], "entityType", (value) => resolveKbLabel(value, "nodeType")),
    edgeTypes: formatFacetGroup(edgeTypeGroups as any[], "edgeType", (value) => resolveKbLabel(value, "edgeType")),
    projects: formatFacetGroup(projectGroups as any[], "scopeProjectId", (value) => projectLabelMap[value] ?? humanizeKbIdentifier(value)),
    domains: formatFacetGroup(domainGroups as any[], "scopeDomainId", (value) => domainLabelMap[value] ?? humanizeKbIdentifier(value)),
    teams: formatFacetGroup(teamGroups as any[], "scopeTeamId", (value) => humanizeKbIdentifier(value)),
  };
}

async function buildStoreKbFacets(store: MetadataStore, scope: GraphScopeFilter): Promise<GraphQLKbFacets> {
  const nodeRecords = await safeListGraphNodes(store, { scopeOrgId: scope.orgId }, "buildStoreKbFacets:nodes");
  const edgeRecords = await safeListGraphEdges(store, { scopeOrgId: scope.orgId }, "buildStoreKbFacets:edges");
  let scopedNodes = nodeRecords.filter((node) => matchesGraphScope(node.scope, scope));
  let scopedEdges = edgeRecords.filter((edge) => matchesGraphScope(edge.scope, scope));
  if (!scopedNodes.length && ENABLE_SAMPLE_FALLBACK) {
    const sampleGraph = buildSampleGraphDataForTenant(scope.orgId, scope.projectId ?? DEFAULT_PROJECT_ID);
    scopedNodes = sampleGraph.nodes.filter((node) => matchesGraphScope(node.scope, scope));
    scopedEdges = sampleGraph.edges.filter((edge) => matchesGraphScope(edge.scope, scope));
  }
  const nodeTypeCounts = countBy(scopedNodes, (node) => node.entityType);
  const edgeTypeCounts = countBy(scopedEdges, (edge) => edge.edgeType);
  const projectCounts = countBy(scopedNodes, (node) => node.scope.projectId ?? null);
  const domainCounts = countBy(scopedNodes, (node) => node.scope.domainId ?? null);
  const teamCounts = countBy(scopedNodes, (node) => node.scope.teamId ?? null);
  return {
    nodeTypes: formatFacetCounts(nodeTypeCounts, (value) => resolveKbLabel(value, "nodeType")),
    edgeTypes: formatFacetCounts(edgeTypeCounts, (value) => resolveKbLabel(value, "edgeType")),
    projects: formatFacetCounts(projectCounts, (value) => humanizeKbIdentifier(value)),
    domains: formatFacetCounts(domainCounts, (value) => humanizeKbIdentifier(value)),
    teams: formatFacetCounts(teamCounts, (value) => humanizeKbIdentifier(value)),
  };
}

function buildFacetCacheKey(scope: GraphScopeFilter): string {
  return [
    scope.orgId,
    scope.projectId ?? "*",
    scope.domainId ?? "*",
    scope.teamId ?? "*",
  ].join(":");
}

async function resolveProjectLabelMap(prisma: PrismaClientInstance, projectIds: Array<string | null | undefined>) {
  const ids = Array.from(new Set(projectIds.filter((value): value is string => Boolean(value))));
  if (!ids.length || !prisma.metadataProject?.findMany) {
    return {};
  }
  const rows = await prisma.metadataProject.findMany({ where: { id: { in: ids } } });
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.id] = row.displayName ?? row.slug ?? row.id;
  }
  return map;
}

async function resolveDomainLabelMap(prisma: PrismaClientInstance, domainIds: Array<string | null | undefined>) {
  const ids = Array.from(new Set(domainIds.filter((value): value is string => Boolean(value))));
  if (!ids.length || !prisma.metadataDomain?.findMany) {
    return {};
  }
  const rows = await prisma.metadataDomain.findMany({
    where: { OR: [{ id: { in: ids } }, { key: { in: ids } }] },
  });
  const map: Record<string, string> = {};
  for (const row of rows) {
    const label = row.title ?? row.key ?? row.id;
    if (row.id) {
      map[row.id] = label;
    }
    if (row.key) {
      map[row.key] = label;
    }
  }
  return map;
}

function formatFacetGroup(rows: any[], field: string, labelResolver: (value: string) => string): GraphQLKbFacetValue[] {
  const values: GraphQLKbFacetValue[] = [];
  for (const row of rows) {
    const rawValue = row?.[field];
    const normalized = typeof rawValue === "string" ? rawValue.trim() : "";
    const count = Number(row?._count?._all ?? 0);
    if (!normalized || !count) {
      continue;
    }
    values.push({
      value: normalized,
      label: labelResolver(normalized),
      count,
    });
  }
  return sortFacetValues(values);
}

function countBy<T>(items: T[], resolver: (item: T) => string | null | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = resolver(item);
    if (!value) {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function formatFacetCounts(
  counts: Map<string, number>,
  labelResolver: (value: string) => string,
): GraphQLKbFacetValue[] {
  const values: GraphQLKbFacetValue[] = [];
  for (const [value, count] of counts.entries()) {
    if (!value || !count) {
      continue;
    }
    values.push({
      value,
      label: labelResolver(value),
      count,
    });
  }
  return sortFacetValues(values);
}

function sortFacetValues(values: GraphQLKbFacetValue[]): GraphQLKbFacetValue[] {
  return [...values].sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return a.label.localeCompare(b.label);
  });
}

async function fetchGraphNodeForScene(
  store: MetadataStore,
  prisma: any | null,
  id: string,
  ctx: ResolverContext,
): Promise<{ nodeRecord: GraphNodeRecordShape; graphNodeFetcher: (nodeId: string) => Promise<GraphNodeRecordShape | null>; sampleGraph: SampleGraph | null }> {
  if (prisma?.graphNode?.findUnique) {
    try {
      const node = await prisma.graphNode.findUnique({ where: { id } });
      if (!node || node.scopeOrgId !== ctx.auth.tenantId) {
        throw new GraphQLError("KB node not found", { extensions: { code: "E_NOT_FOUND" } });
      }
      const mapped = mapPrismaGraphNodeRecord(node);
      return {
        nodeRecord: mapped,
        graphNodeFetcher: async (nodeId: string) => {
          const match = await prisma.graphNode.findUnique({ where: { id: nodeId } });
          return match ? mapPrismaGraphNodeRecord(match) : null;
        },
        sampleGraph: null,
      };
    } catch (error) {
      if (error instanceof GraphQLError) {
        throw error;
      }
      logGraphFallback(error, "fetchGraphNodeForScene");
    }
  }
  const record = await safeGetGraphNodeById(store, id, "fetchGraphNodeForScene:store");
  if (!record || record.scope.orgId !== ctx.auth.tenantId) {
    if (ENABLE_SAMPLE_FALLBACK) {
      const sampleGraph = buildSampleGraphDataForTenant(ctx.auth.tenantId, ctx.auth.projectId);
      const sampleNode = sampleGraph.nodes.find((node) => node.id === id);
      if (sampleNode) {
        return {
          nodeRecord: sampleNode,
          graphNodeFetcher: async (nodeId: string) => sampleGraph.nodes.find((node) => node.id === nodeId) ?? null,
          sampleGraph,
        };
      }
    }
    throw new GraphQLError("KB node not found", { extensions: { code: "E_NOT_FOUND" } });
  }
  return {
    nodeRecord: record,
    graphNodeFetcher: (nodeId: string) => safeGetGraphNodeById(store, nodeId, "fetchGraphNodeForScene:fetch"),
    sampleGraph: null,
  };
}

async function fetchEdgesForNode(
  store: MetadataStore,
  prisma: any | null,
  orgId: string,
  nodeId: string,
  edgeTypes: string[],
  limit: number,
) {
  if (prisma?.graphEdge?.findMany) {
    try {
      const where = {
        scopeOrgId: orgId,
        ...(edgeTypes.length ? { edgeType: { in: edgeTypes } } : {}),
        OR: [{ sourceNodeId: nodeId }, { targetNodeId: nodeId }],
      };
      const records = await prisma.graphEdge.findMany({ where, orderBy: { updatedAt: "desc" }, take: limit });
      return records.map(mapPrismaGraphEdgeRecord);
    } catch (error) {
      logGraphFallback(error, "fetchEdgesForNode");
    }
  }
  const baseFilter = {
    scopeOrgId: orgId,
    edgeTypes: edgeTypes.length ? edgeTypes : undefined,
  };
  const outgoing = await safeListGraphEdges(store, { ...baseFilter, sourceNodeId: nodeId, limit }, "fetchEdgesForNode:outgoing");
  const incoming = await safeListGraphEdges(store, { ...baseFilter, targetNodeId: nodeId, limit }, "fetchEdgesForNode:incoming");
  const combined = [...outgoing, ...incoming];
  const deduped: GraphEdgeRecordShape[] = [];
  const seen = new Set<string>();
  for (const edge of combined) {
    if (!seen.has(edge.id)) {
      deduped.push(edge);
      seen.add(edge.id);
    }
    if (deduped.length >= limit) {
      break;
    }
  }
  return deduped;
}

function normalizeGraphScopeFilter(ctx: ResolverContext, scope?: GraphQLGraphScopeInput | null): GraphScopeFilter {
  const normalize = (value?: string | null) => {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  };
  return {
    orgId: ctx.auth.tenantId,
    domainId: normalize(scope?.domainId),
    projectId: normalize(scope?.projectId),
    teamId: normalize(scope?.teamId),
  };
}

function buildPrismaGraphNodeWhere(scope: GraphScopeFilter, type?: string | null, search?: string | null) {
  const where: Record<string, unknown> = {
    scopeOrgId: scope.orgId,
  };
  if (type) {
    where.entityType = type;
  }
  if (scope.domainId) {
    where.scopeDomainId = scope.domainId;
  }
  if (scope.projectId) {
    where.scopeProjectId = scope.projectId;
  }
  if (scope.teamId) {
    where.scopeTeamId = scope.teamId;
  }
  const searchValue = search?.trim();
  if (searchValue) {
    where.OR = [
      { displayName: { contains: searchValue, mode: "insensitive" } },
      { canonicalPath: { contains: searchValue, mode: "insensitive" } },
    ];
  }
  return where;
}

function buildPrismaGraphEdgeWhere(
  scope: GraphScopeFilter,
  edgeType?: string | null,
  sourceId?: string | null,
  targetId?: string | null,
) {
  const where: Record<string, unknown> = {
    scopeOrgId: scope.orgId,
  };
  if (scope.domainId) {
    where.scopeDomainId = scope.domainId;
  }
  if (scope.projectId) {
    where.scopeProjectId = scope.projectId;
  }
  if (scope.teamId) {
    where.scopeTeamId = scope.teamId;
  }
  if (edgeType) {
    where.edgeType = edgeType;
  }
  if (sourceId) {
    where.sourceNodeId = sourceId;
  }
  if (targetId) {
    where.targetNodeId = targetId;
  }
  return where;
}

function buildNodeConnection(
  window: GraphNodeRecordShape[],
  limit: number,
  totalCount: number,
  afterProvided: boolean,
) {
  const pageRecords = window.slice(0, limit);
  const edges = pageRecords.map((record) => ({
    cursor: encodeGraphCursor(record.id),
    node: mapGraphNodeRecordToGraphQL(record),
  }));
  return {
    edges,
    pageInfo: {
      hasNextPage: window.length > limit,
      hasPreviousPage: afterProvided,
      startCursor: edges[0]?.cursor ?? null,
      endCursor: edges[edges.length - 1]?.cursor ?? null,
    },
    totalCount,
  };
}

function buildEdgeConnection(
  window: GraphEdgeRecordShape[],
  limit: number,
  totalCount: number,
  afterProvided: boolean,
) {
  const pageRecords = window.slice(0, limit);
  const edges = pageRecords.map((record) => ({
    cursor: encodeGraphCursor(record.id),
    node: mapGraphEdgeRecordToGraphQL(record),
  }));
  return {
    edges,
    pageInfo: {
      hasNextPage: window.length > limit,
      hasPreviousPage: afterProvided,
      startCursor: edges[0]?.cursor ?? null,
      endCursor: edges[edges.length - 1]?.cursor ?? null,
    },
    totalCount,
  };
}

function matchesGraphScope(scope: GraphScopeFilter, filter: GraphScopeFilter): boolean {
  if (scope.orgId !== filter.orgId) {
    return false;
  }
  if (filter.domainId && scope.domainId !== filter.domainId) {
    return false;
  }
  if (filter.projectId && scope.projectId !== filter.projectId) {
    return false;
  }
  if (filter.teamId && scope.teamId !== filter.teamId) {
    return false;
  }
  return true;
}

function sortGraphNodeRecords(records: GraphNodeRecordShape[]) {
  return [...records].sort((a, b) => compareByUpdatedAtDesc(a, b));
}

function sortGraphEdgeRecords(records: GraphEdgeRecordShape[]) {
  return [...records].sort((a, b) => compareByUpdatedAtDesc(a, b));
}

function compareByUpdatedAtDesc(a: { updatedAt: string | Date; id: string }, b: { updatedAt: string | Date; id: string }) {
  const aTime = toTimestamp(a.updatedAt);
  const bTime = toTimestamp(b.updatedAt);
  if (aTime !== bTime) {
    return bTime - aTime;
  }
  return b.id.localeCompare(a.id);
}

function sliceRecordsAfterCursor<T extends { id: string }>(records: T[], cursor: GraphCursor | null, limit: number) {
  if (!cursor) {
    return records.slice(0, limit + 1);
  }
  const startIndex = records.findIndex((record) => record.id === cursor.id);
  const offset = startIndex >= 0 ? startIndex + 1 : 0;
  return records.slice(offset, offset + limit + 1);
}

function mapGraphNodeRecordToGraphQL(record: GraphNodeRecordShape) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    projectId: record.projectId ?? null,
    entityType: record.entityType,
    displayName: record.displayName,
    canonicalPath: record.canonicalPath ?? null,
    sourceSystem: record.sourceSystem ?? null,
    specRef: record.specRef ?? null,
    properties: record.properties ?? {},
    version: record.version ?? 1,
    phase: record.phase ?? null,
    scope: {
      orgId: record.scope.orgId,
      domainId: record.scope.domainId ?? null,
      projectId: record.scope.projectId ?? null,
      teamId: record.scope.teamId ?? null,
    },
    identity: {
      logicalKey: record.logicalKey,
      externalId: record.externalId ?? null,
      originEndpointId: record.originEndpointId ?? null,
      originVendor: record.originVendor ?? null,
      provenance: record.provenance ?? null,
      phase: record.phase ?? null,
    },
    provenance: record.provenance ?? null,
    createdAt: toISOStringValue(record.createdAt),
    updatedAt: toISOStringValue(record.updatedAt),
  };
}

function mapGraphEdgeRecordToGraphQL(record: GraphEdgeRecordShape) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    projectId: record.projectId ?? null,
    edgeType: record.edgeType,
    sourceEntityId: record.sourceNodeId,
    targetEntityId: record.targetNodeId,
    confidence: record.confidence ?? null,
    specRef: record.specRef ?? null,
    metadata: record.metadata ?? {},
    scope: {
      orgId: record.scope.orgId,
      domainId: record.scope.domainId ?? null,
      projectId: record.scope.projectId ?? null,
      teamId: record.scope.teamId ?? null,
    },
    identity: {
      logicalKey: record.logicalKey,
      sourceLogicalKey: record.sourceLogicalKey,
      targetLogicalKey: record.targetLogicalKey,
      externalId: record.externalId ?? null,
      originEndpointId: record.originEndpointId ?? null,
      originVendor: record.originVendor ?? null,
      phase: record.phase ?? null,
      provenance: record.provenance ?? null,
    },
    createdAt: toISOStringValue(record.createdAt),
    updatedAt: toISOStringValue(record.updatedAt),
  };
}

function mapPrismaGraphNodeRecord(record: any): GraphNodeRecordShape {
  return {
    id: record.id,
    tenantId: record.tenantId,
    projectId: record.projectId ?? null,
    entityType: record.entityType,
    displayName: record.displayName,
    canonicalPath: record.canonicalPath ?? null,
    sourceSystem: record.sourceSystem ?? null,
    specRef: record.specRef ?? null,
    properties: record.properties ?? {},
    version: record.version ?? 1,
    phase: record.phase ?? null,
    scope: {
      orgId: record.scopeOrgId,
      domainId: record.scopeDomainId ?? null,
      projectId: record.scopeProjectId ?? null,
      teamId: record.scopeTeamId ?? null,
    },
    originEndpointId: record.originEndpointId ?? null,
    originVendor: record.originVendor ?? null,
    logicalKey: record.logicalKey,
    externalId: record.externalId ?? null,
    provenance: record.provenance ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapPrismaGraphEdgeRecord(record: any): GraphEdgeRecordShape {
  return {
    id: record.id,
    tenantId: record.tenantId,
    projectId: record.projectId ?? null,
    edgeType: record.edgeType,
    sourceNodeId: record.sourceNodeId,
    targetNodeId: record.targetNodeId,
    sourceLogicalKey: record.sourceLogicalKey,
    targetLogicalKey: record.targetLogicalKey,
    scope: {
      orgId: record.scopeOrgId,
      domainId: record.scopeDomainId ?? null,
      projectId: record.scopeProjectId ?? null,
      teamId: record.scopeTeamId ?? null,
    },
    originEndpointId: record.originEndpointId ?? null,
    originVendor: record.originVendor ?? null,
    logicalKey: record.logicalKey,
    confidence: record.confidence ?? null,
    specRef: record.specRef ?? null,
    metadata: record.metadata ?? {},
    externalId: record.externalId ?? null,
    phase: record.phase ?? null,
    provenance: record.provenance ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function encodeGraphCursor(id: string) {
  return Buffer.from(JSON.stringify({ id }), "utf-8").toString("base64");
}

function decodeGraphCursor(cursor?: string | null): GraphCursor | null {
  if (!cursor) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8"));
    if (parsed && typeof parsed.id === "string" && parsed.id.trim().length > 0) {
      return { id: parsed.id };
    }
  } catch {
    return null;
  }
  return null;
}

function toTimestamp(value: string | Date) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function toISOStringValue(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

async function tryGetPrismaGraphClient(): Promise<any | null> {
  if (!process.env.METADATA_DATABASE_URL) {
    return null;
  }
  try {
    return await getPrismaClient();
  } catch {
    return null;
  }
}

function logGraphFallback(error: unknown, context: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[kb-graph:fallback] ${context}: ${message}`);
}

async function safeListGraphNodes(store: MetadataStore, params: any, context: string): Promise<GraphNodeRecordShape[]> {
  try {
    return await store.listGraphNodes(params);
  } catch (error) {
    logGraphFallback(error, context);
    return [];
  }
}

async function safeListGraphEdges(store: MetadataStore, params: any, context: string): Promise<GraphEdgeRecordShape[]> {
  try {
    return await store.listGraphEdges(params);
  } catch (error) {
    logGraphFallback(error, context);
    return [];
  }
}

async function safeGetGraphNodeById(store: MetadataStore, id: string, context: string): Promise<GraphNodeRecordShape | null> {
  try {
    return await store.getGraphNodeById(id);
  } catch (error) {
    logGraphFallback(error, context);
    return null;
  }
}

async function syncCollectionSchedule(
  prisma: PrismaClientInstance,
  collection: PrismaCollectionWithEndpoint,
): Promise<void> {
  const cron = sanitizeScheduleCron(collection.scheduleCron);
  if (!cron) {
    await removeCollectionSchedule(collection);
    if (collection.temporalScheduleId) {
      await prisma.metadataCollection.update({
        where: { id: collection.id },
        data: { temporalScheduleId: null },
      });
    }
    return;
  }
  const timezone = sanitizeScheduleTimezone(collection.scheduleTimezone);
  const { client, taskQueue } = await getTemporalClient();
  const scheduleId = buildCollectionScheduleId(collection.id);
  const spec = {
    cronExpressions: [cron],
    timezone,
  };
  const action = {
    type: "startWorkflow" as const,
    workflowType: WORKFLOW_NAMES.collectionRun,
    taskQueue,
    workflowId: `collection-run-${collection.id}`,
    workflowIdReusePolicy: WorkflowIdReusePolicy.WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE,
    args: [{ collectionId: collection.id, endpointId: collection.endpointId }],
  };
  const policies = {
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow: 60_000,
    pauseOnFailure: false,
  };
  const handle = client.schedule.getHandle(scheduleId);
  let exists = true;
  try {
    await handle.describe();
  } catch (error) {
    exists = false;
    if (!(error instanceof Error) || !/not\s+found/i.test(error.message)) {
      throw error;
    }
  }
  if (!exists) {
    await client.schedule.create({ scheduleId, spec, action, policies });
  } else {
    await handle.update(() => ({ spec, action, policies, state: { paused: !collection.isEnabled } }));
  }
  if (collection.isEnabled) {
    await handle.unpause().catch((error: unknown) => {
      if (error instanceof Error && /not\s+paused/i.test(error.message)) {
        return;
      }
      throw error;
    });
  } else {
    await handle.pause(COLLECTION_SCHEDULE_PAUSE_REASON);
  }
  if (collection.temporalScheduleId !== scheduleId) {
    await prisma.metadataCollection.update({
      where: { id: collection.id },
      data: { temporalScheduleId: scheduleId },
    });
  }
}

async function removeCollectionSchedule(collection: { temporalScheduleId?: string | null }) {
  if (!collection.temporalScheduleId) {
    return;
  }
  const { client } = await getTemporalClient();
  const handle = client.schedule.getHandle(collection.temporalScheduleId);
  try {
    await handle.delete();
  } catch (error) {
    if (error instanceof Error && /not\s+found/i.test(error.message)) {
      return;
    }
    throw error;
  }
}

function sanitizeScheduleCron(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function sanitizeScheduleTimezone(value?: string | null): string {
  if (!value) {
    return "UTC";
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : "UTC";
}

function mapCollectionToGraphQL(collection: PrismaCollectionWithEndpoint) {
  return {
    ...collection,
    endpoint: normalizeEndpointForGraphQL(collection.endpoint as unknown as MetadataEndpointDescriptor)!,
  };
}

function buildTenantContextForGraph(ctx: ResolverContext): TenantContext {
  if (!ctx.auth.tenantId || !ctx.auth.projectId) {
    throw new GraphQLError("Missing tenant context for graph query.", { extensions: { code: "E_ROLE_FORBIDDEN" } });
  }
  return {
    tenantId: ctx.auth.tenantId,
    projectId: ctx.auth.projectId,
    actorId: ctx.userId ?? undefined,
  };
}
