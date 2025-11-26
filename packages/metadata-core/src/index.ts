import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID as nodeRandomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type MetadataLabel = string;
export type MetadataEndpointTemplateFamily = "JDBC" | "HTTP" | "STREAM";

export type MetadataEndpointFieldValueType =
  | "STRING"
  | "PASSWORD"
  | "NUMBER"
  | "BOOLEAN"
  | "URL"
  | "HOSTNAME"
  | "PORT"
  | "JSON"
  | "ENUM"
  | "LIST"
  | "TEXT";

export type MetadataEndpointFieldSemantic =
  | "HOST"
  | "PORT"
  | "DATABASE"
  | "USERNAME"
  | "PASSWORD"
  | "API_TOKEN"
  | "PROJECT"
  | "SCHEMA"
  | "TABLE"
  | "WAREHOUSE"
  | "ROLE"
  | "ENVIRONMENT"
  | "CLUSTER"
  | "TOPIC"
  | "GENERIC";

export type MetadataEndpointFieldOption = {
  label: string;
  value: string;
  description?: string;
};

export type MetadataEndpointFieldVisibilityRule = {
  field: string;
  values: string[];
};

export type MetadataEndpointFieldDescriptor = {
  key: string;
  label: string;
  required: boolean;
  valueType: MetadataEndpointFieldValueType;
  semantic?: MetadataEndpointFieldSemantic;
  description?: string;
  placeholder?: string;
  helpText?: string;
  regex?: string;
  min?: number;
  max?: number;
  defaultValue?: string;
  advanced?: boolean;
  sensitive?: boolean;
  dependsOn?: string;
  dependsValue?: string;
  visibleWhen?: MetadataEndpointFieldVisibilityRule[] | null;
  options?: MetadataEndpointFieldOption[];
};

export type MetadataEndpointCapabilityDescriptor = {
  key: string;
  label: string;
  description?: string;
};

export type MetadataEndpointConnectionTemplateDescriptor = {
  urlTemplate?: string;
  defaultVerb?: string;
};

export type MetadataEndpointProbingMethodDescriptor = {
  key: string;
  label: string;
  strategy: string;
  statement?: string;
  description?: string;
  requires?: string[];
  returnsVersion?: boolean;
  returnsCapabilities?: string[];
};

export type MetadataEndpointProbingPlanDescriptor = {
  methods: MetadataEndpointProbingMethodDescriptor[];
  fallbackMessage?: string;
};

export type MetadataEndpointTemplateDescriptor = {
  id: string;
  family: "JDBC" | "HTTP" | "STREAM";
  title: string;
  vendor: string;
  description?: string;
  domain?: string;
  categories: string[];
  protocols: string[];
  versions?: string[];
  defaultPort?: number;
  driver?: string;
  docsUrl?: string;
  agentPrompt?: string;
  defaultLabels?: string[];
  fields: MetadataEndpointFieldDescriptor[];
  capabilities: MetadataEndpointCapabilityDescriptor[];
  sampleConfig?: Record<string, unknown>;
  connection?: MetadataEndpointConnectionTemplateDescriptor | null;
  descriptorVersion?: string;
  minVersion?: string;
  maxVersion?: string;
  probing?: MetadataEndpointProbingPlanDescriptor | null;
  extras?: Record<string, unknown>;
};

export type MetadataEndpointTestResult = {
  success: boolean;
  message?: string;
  detectedVersion?: string;
  capabilities?: string[];
  details?: Record<string, unknown>;
};

export type MetadataEndpointDescriptor = {
  id?: string;
  sourceId?: string;
  name: string;
  description?: string;
  verb: HttpVerb;
  url: string;
  authPolicy?: string;
  projectId?: string;
  domain?: string;
  labels?: string[];
  config?: Record<string, unknown> | null;
  detectedVersion?: string | null;
  versionHint?: string | null;
  capabilities?: string[];
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  deletionReason?: string | null;
};

export type HttpVerb = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type MetadataDomainSummary = {
  key: string;
  title: string;
  description?: string;
  itemCount: number;
};

export type MetadataRecordInput<TPayload> = {
  id?: string;
  projectId: string;
  domain: string;
  labels?: MetadataLabel[];
  payload: TPayload;
};

export type MetadataRecord<TPayload> = MetadataRecordInput<TPayload> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type RecordFilter = {
  projectId?: string;
  labels?: string[];
  search?: string;
  limit?: number;
};

export type TenantContext = {
  tenantId: string;
  projectId: string;
  actorId?: string;
};

export type GraphScopeInput = {
  orgId: string;
  domainId?: string | null;
  projectId?: string | null;
  teamId?: string | null;
};

export type GraphScope = {
  orgId: string;
  domainId?: string | null;
  projectId?: string | null;
  teamId?: string | null;
};

export type GraphIdentityInput = {
  logicalKey?: string | null;
  externalId?: Record<string, unknown> | null;
  originEndpointId?: string | null;
  originVendor?: string | null;
  phase?: string | null;
  provenance?: Record<string, unknown> | null;
};

export type GraphIdentity = Omit<GraphIdentityInput, "logicalKey"> & {
  logicalKey: string;
};

export type GraphEdgeIdentityInput = GraphIdentityInput & {
  sourceLogicalKey?: string | null;
  targetLogicalKey?: string | null;
};

export type GraphEdgeIdentity = Omit<GraphEdgeIdentityInput, "logicalKey" | "sourceLogicalKey" | "targetLogicalKey"> & {
  logicalKey: string;
  sourceLogicalKey: string;
  targetLogicalKey: string;
};

export type GraphEntityInput = {
  id?: string;
  entityType: string;
  displayName: string;
  canonicalPath?: string;
  sourceSystem?: string;
  specRef?: string;
  properties?: Record<string, unknown>;
  scope: GraphScopeInput;
  identity?: GraphIdentityInput;
};

export type GraphEntity = {
  id: string;
  entityType: string;
  displayName: string;
  canonicalPath?: string;
  sourceSystem?: string;
  specRef?: string;
  properties: Record<string, unknown>;
  tenantId: string;
  projectId: string | null;
  version: number;
  scope: GraphScope;
  identity: GraphIdentity;
  createdAt: string;
  updatedAt: string;
};

export type GraphEntityFilter = {
  entityTypes?: string[];
  search?: string;
  limit?: number;
};

export type GraphEdgeInput = {
  id?: string;
  edgeType: string;
  sourceEntityId: string;
  targetEntityId: string;
  confidence?: number;
  specRef?: string;
  metadata?: Record<string, unknown>;
  scope: GraphScopeInput;
  identity?: GraphEdgeIdentityInput;
};

export type GraphEdge = {
  id: string;
  edgeType: string;
  sourceEntityId: string;
  targetEntityId: string;
  confidence?: number;
  specRef?: string;
  metadata: Record<string, unknown>;
  tenantId: string;
  projectId: string | null;
  scope: GraphScope;
  identity: GraphEdgeIdentity;
  createdAt: string;
  updatedAt: string;
};

export type GraphEdgeFilter = {
  edgeTypes?: string[];
  sourceEntityId?: string;
  targetEntityId?: string;
  limit?: number;
};

export type IngestionUnitDescriptor = {
  unitId: string;
  kind: string;
  displayName: string;
  datasetId?: string;
  defaultMode?: string;
  supportedModes?: string[];
  defaultSinkId?: string;
  defaultScheduleKind?: string;
  defaultScheduleIntervalMinutes?: number | null;
  defaultPolicy?: Record<string, unknown> | null;
  stats?: Record<string, unknown> | null;
};

export type IngestionScope = {
  orgId: string;
  projectId?: string | null;
  domainId?: string | null;
  teamId?: string | null;
};

export type NormalizedEdge = {
  type: string;
  sourceLogicalId: string;
  targetLogicalId: string;
  properties?: Record<string, unknown> | null;
};

export type NormalizedRecord = {
  entityType: string;
  logicalId?: string | null;
  displayName?: string | null;
  scope: IngestionScope;
  provenance: {
    endpointId: string;
    vendor?: string | null;
    sourceEventId?: string | null;
  };
  payload: Record<string, unknown> | unknown;
  phase?: string | null;
  edges?: NormalizedEdge[];
};

export type NormalizedBatch = {
  records: NormalizedRecord[];
};

export type IngestionDriverSyncArgs = {
  endpointId: string;
  unitId: string;
  checkpoint?: unknown;
  limit?: number;
};

export type IngestionDriverSyncResult = {
  newCheckpoint: unknown;
  stats?: Record<string, unknown> | null;
  batches: NormalizedBatch[];
  sourceEventIds?: string[];
  errors?: Array<{ code?: string; message: string; sample?: unknown }>;
};

export interface IngestionDriver {
  listUnits(endpointId: string): Promise<IngestionUnitDescriptor[]>;
  estimateLag?(endpointId: string, unitId: string): Promise<number | null>;
  syncUnit(args: IngestionDriverSyncArgs): Promise<IngestionDriverSyncResult>;
}

export type IngestionSinkContext = {
  endpointId: string;
  unitId: string;
  sinkId: string;
  runId: string;
};

export interface IngestionSink {
  begin(context: IngestionSinkContext): Promise<void>;
  writeBatch(batch: NormalizedBatch, context: IngestionSinkContext): Promise<{ upserts?: number; edges?: number }>;
  commit?(context: IngestionSinkContext, stats?: Record<string, unknown> | null): Promise<void>;
  abort?(context: IngestionSinkContext, error: unknown): Promise<void>;
}

type IngestionDriverFactory = () => IngestionDriver;
type IngestionSinkFactory = () => IngestionSink;

const ingestionDriverRegistry = new Map<string, IngestionDriverFactory>();
const ingestionSinkRegistry = new Map<string, IngestionSinkFactory>();

export function registerIngestionDriver(id: string, factory: IngestionDriverFactory): void {
  const normalized = id.trim();
  if (!normalized) {
    throw new Error("Ingestion driver id is required");
  }
  ingestionDriverRegistry.set(normalized, factory);
}

export function getIngestionDriver(id: string): IngestionDriver | null {
  const factory = ingestionDriverRegistry.get(id.trim());
  return factory ? factory() : null;
}

export function listRegisteredIngestionDrivers(): string[] {
  return Array.from(ingestionDriverRegistry.keys());
}

export function registerIngestionSink(id: string, factory: IngestionSinkFactory): void {
  const normalized = id.trim();
  if (!normalized) {
    throw new Error("Ingestion sink id is required");
  }
  ingestionSinkRegistry.set(normalized, factory);
}

export function getIngestionSink(id: string): IngestionSink | null {
  const normalized = id.trim();
  const factory = ingestionSinkRegistry.get(normalized);
  return factory ? factory() : null;
}

export function listRegisteredIngestionSinks(): string[] {
  return Array.from(ingestionSinkRegistry.keys());
}

type GraphNodeRecord = {
  id: string;
  tenantId: string;
  projectId: string | null;
  entityType: string;
  displayName: string;
  canonicalPath?: string | null;
  sourceSystem?: string | null;
  specRef?: string | null;
  properties: Record<string, unknown>;
  version: number;
  scope: GraphScope;
  originEndpointId?: string | null;
  originVendor?: string | null;
  logicalKey: string;
  externalId?: Record<string, unknown> | null;
  phase?: string | null;
  provenance?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

type GraphNodeRecordInput = {
  id?: string;
  tenantId: string;
  projectId?: string | null;
  entityType: string;
  displayName: string;
  canonicalPath?: string | null;
  sourceSystem?: string | null;
  specRef?: string | null;
  properties?: Record<string, unknown> | null;
  version?: number;
  scope: GraphScope;
  originEndpointId?: string | null;
  originVendor?: string | null;
  logicalKey: string;
  externalId?: Record<string, unknown> | null;
  phase?: string | null;
  provenance?: Record<string, unknown> | null;
};

type GraphNodeRecordFilter = {
  scopeOrgId: string;
  entityTypes?: string[];
  search?: string;
  limit?: number;
};

type GraphEdgeRecord = {
  id: string;
  tenantId: string;
  projectId: string | null;
  edgeType: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceLogicalKey: string;
  targetLogicalKey: string;
  scope: GraphScope;
  originEndpointId?: string | null;
  originVendor?: string | null;
  logicalKey: string;
  confidence?: number | null;
  specRef?: string | null;
  metadata: Record<string, unknown>;
  externalId?: Record<string, unknown> | null;
  phase?: string | null;
  provenance?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

type GraphEdgeRecordInput = {
  id?: string;
  tenantId: string;
  projectId?: string | null;
  edgeType: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceLogicalKey: string;
  targetLogicalKey: string;
  scope: GraphScope;
  originEndpointId?: string | null;
  originVendor?: string | null;
  logicalKey: string;
  confidence?: number | null;
  specRef?: string | null;
  metadata?: Record<string, unknown> | null;
  externalId?: Record<string, unknown> | null;
  phase?: string | null;
  provenance?: Record<string, unknown> | null;
};

type GraphEdgeRecordFilter = {
  scopeOrgId: string;
  edgeTypes?: string[];
  sourceLogicalKey?: string;
  targetLogicalKey?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  limit?: number;
};

export type GraphStoreCapabilities = {
  vectorSearch: boolean;
  pathQueries: boolean;
  annotations: boolean;
};

export type GraphEmbeddingInput = {
  entityId: string;
  vector: number[];
  modelId: string;
  metadata?: Record<string, unknown>;
};

export type GraphEmbedding = GraphEmbeddingInput & {
  id: string;
  tenantId: string;
  projectId: string;
  hash: string;
  createdAt: string;
};

export interface GraphStore {
  capabilities(): Promise<GraphStoreCapabilities>;
  upsertEntity(input: GraphEntityInput, context: TenantContext): Promise<GraphEntity>;
  getEntity(id: string, context: TenantContext): Promise<GraphEntity | null>;
  listEntities(filter: GraphEntityFilter | undefined, context: TenantContext): Promise<GraphEntity[]>;
  upsertEdge(input: GraphEdgeInput, context: TenantContext): Promise<GraphEdge>;
  listEdges(filter: GraphEdgeFilter | undefined, context: TenantContext): Promise<GraphEdge[]>;
  putEmbedding(input: GraphEmbeddingInput, context: TenantContext): Promise<GraphEmbedding>;
  searchEmbeddings(
    query: { vector: number[]; limit?: number; modelId?: string },
    context: TenantContext,
  ): Promise<GraphEmbedding[]>;
}

export type GraphStoreFactoryOptions = {
  driver?: string;
  metadataStore: MetadataStore;
};

export interface MetadataStore {
  listRecords<T = Record<string, unknown>>(domain: string, filter?: RecordFilter): Promise<MetadataRecord<T>[]>;
  getRecord<T = Record<string, unknown>>(domain: string, id: string): Promise<MetadataRecord<T> | null>;
  upsertRecord<T = Record<string, unknown>>(input: MetadataRecordInput<T>): Promise<MetadataRecord<T>>;
  deleteRecord(domain: string, id: string): Promise<void>;
  listDomains(): Promise<MetadataDomainSummary[]>;
  listEndpoints(projectId?: string): Promise<MetadataEndpointDescriptor[]>;
  registerEndpoint(endpoint: MetadataEndpointDescriptor): Promise<MetadataEndpointDescriptor>;
  listEndpointTemplates(family?: MetadataEndpointTemplateFamily): Promise<MetadataEndpointTemplateDescriptor[]>;
  saveEndpointTemplates(templates: MetadataEndpointTemplateDescriptor[]): Promise<void>;
  upsertGraphNode(input: GraphNodeRecordInput): Promise<GraphNodeRecord>;
  getGraphNodeById(id: string): Promise<GraphNodeRecord | null>;
  getGraphNodeByLogicalKey(logicalKey: string): Promise<GraphNodeRecord | null>;
  listGraphNodes(filter: GraphNodeRecordFilter): Promise<GraphNodeRecord[]>;
  upsertGraphEdge(input: GraphEdgeRecordInput): Promise<GraphEdgeRecord>;
  getGraphEdgeById(id: string): Promise<GraphEdgeRecord | null>;
  getGraphEdgeByLogicalKey(logicalKey: string): Promise<GraphEdgeRecord | null>;
  listGraphEdges(filter: GraphEdgeRecordFilter): Promise<GraphEdgeRecord[]>;
}

export type FileMetadataStoreOptions = {
  rootDir?: string;
  filename?: string;
};

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), "metadata", "store");
const RECORDS_FILE = "records.json";
const ENDPOINTS_FILE = "endpoints.json";
const ENDPOINT_TEMPLATES_FILE = "endpoint-templates.json";
const GRAPH_NODES_FILE = "graph-nodes.json";
const GRAPH_EDGES_FILE = "graph-edges.json";
const DEFAULT_OBJECT_STORE_DIR = path.resolve(process.cwd(), "metadata", "objects");
const DEFAULT_KV_STORE_FILE = path.resolve(process.cwd(), "metadata", "kv-store.json");
const DEFAULT_JSON_STORE_DIR = path.resolve(process.cwd(), "metadata", "json");
const DEFAULT_CODE_STORE_DIR = path.resolve(process.cwd(), "metadata", "code");

export class FileMetadataStore implements MetadataStore {
  private readonly rootDir: string;
  private readonly recordsFile: string;
  private readonly endpointsFile: string;
  private readonly endpointTemplatesFile: string;
  private readonly graphNodesFile: string;
  private readonly graphEdgesFile: string;

  constructor(options?: FileMetadataStoreOptions) {
    this.rootDir = options?.rootDir ?? DEFAULT_DATA_DIR;
    this.recordsFile = path.resolve(this.rootDir, options?.filename ?? RECORDS_FILE);
    this.endpointsFile = path.resolve(this.rootDir, ENDPOINTS_FILE);
    this.endpointTemplatesFile = path.resolve(this.rootDir, ENDPOINT_TEMPLATES_FILE);
    this.graphNodesFile = path.resolve(this.rootDir, GRAPH_NODES_FILE);
    this.graphEdgesFile = path.resolve(this.rootDir, GRAPH_EDGES_FILE);
  }

  async listRecords<T = Record<string, unknown>>(domain: string, filter?: RecordFilter): Promise<MetadataRecord<T>[]> {
    const records = await this.loadRecords<T>();
    return records
      .filter((record) => record.domain === domain)
      .filter((record) => {
        if (filter?.projectId && record.projectId !== filter.projectId) {
          return false;
        }
        if (filter?.labels?.length) {
          const labels = record.labels ?? [];
          if (!filter.labels.every((label) => labels.includes(label))) {
            return false;
          }
        }
        if (filter?.search) {
          const haystack = JSON.stringify(record.payload).toLowerCase();
          if (!haystack.includes(filter.search.toLowerCase())) {
            return false;
          }
        }
        return true;
      })
      .slice(0, filter?.limit ?? Number.POSITIVE_INFINITY);
  }

  async getRecord<T = Record<string, unknown>>(domain: string, id: string): Promise<MetadataRecord<T> | null> {
    const records = await this.loadRecords<T>();
    return records.find((record) => record.domain === domain && record.id === id) ?? null;
  }

  async upsertRecord<T = Record<string, unknown>>(input: MetadataRecordInput<T>): Promise<MetadataRecord<T>> {
    const records = await this.loadRecords<T>();
    let record = records.find((entry) => entry.domain === input.domain && entry.id === input.id);
    const now = new Date().toISOString();
    if (!record) {
      record = {
        id: input.id ?? cryptoRandomId(),
        projectId: input.projectId,
        domain: input.domain,
        labels: input.labels ?? [],
        payload: input.payload,
        createdAt: now,
        updatedAt: now,
      } as MetadataRecord<T>;
      records.push(record);
    } else {
      record.projectId = input.projectId;
      record.labels = input.labels ?? [];
      record.payload = input.payload;
      record.updatedAt = now;
    }
    await this.persistRecords(records);
    return record;
  }

  async deleteRecord(domain: string, id: string): Promise<void> {
    const records = await this.loadRecords();
    const next = records.filter((record) => !(record.domain === domain && record.id === id));
    await this.persistRecords(next);
  }

  async listDomains(): Promise<MetadataDomainSummary[]> {
    const records = await this.loadRecords();
    const domainMap = new Map<string, MetadataDomainSummary>();
    records.forEach((record) => {
      const entry = domainMap.get(record.domain) ?? {
        key: record.domain,
        title: record.domain,
        itemCount: 0,
      };
      entry.itemCount += 1;
      domainMap.set(record.domain, entry);
    });
    return Array.from(domainMap.values());
  }

  async listEndpoints(projectId?: string): Promise<MetadataEndpointDescriptor[]> {
    const endpoints = await this.loadEndpoints();
    if (!projectId) {
      return sortEndpointsByUpdatedAt(endpoints);
    }
    return sortEndpointsByUpdatedAt(endpoints.filter((endpoint) => endpoint.projectId === projectId));
  }

  async registerEndpoint(endpoint: MetadataEndpointDescriptor): Promise<MetadataEndpointDescriptor> {
    const endpoints = await this.loadEndpoints();
    const existingIndex = endpoints.findIndex((entry) => entry.id === endpoint.id);
    const now = new Date().toISOString();
    if (existingIndex >= 0) {
      const existing = endpoints[existingIndex];
      const updated: MetadataEndpointDescriptor = {
        ...existing,
        ...endpoint,
        sourceId: endpoint.sourceId ?? existing.sourceId ?? generateSourceId(endpoint),
        createdAt: existing.createdAt ?? endpoint.createdAt ?? now,
        updatedAt: now,
        deletedAt: endpoint.deletedAt ?? existing.deletedAt ?? null,
        deletionReason: endpoint.deletionReason ?? existing.deletionReason ?? null,
      };
      endpoints[existingIndex] = updated;
      await this.persistEndpoints(endpoints);
      return updated;
    }
    const descriptor: MetadataEndpointDescriptor = {
      ...endpoint,
      id: endpoint.id ?? cryptoRandomId(),
      sourceId: endpoint.sourceId ?? generateSourceId(endpoint),
      createdAt: endpoint.createdAt ?? now,
      updatedAt: endpoint.updatedAt ?? now,
      deletedAt: endpoint.deletedAt ?? null,
      deletionReason: endpoint.deletionReason ?? null,
    };
    endpoints.push(descriptor);
    await this.persistEndpoints(endpoints);
    return descriptor;
  }

  async listEndpointTemplates(family?: MetadataEndpointTemplateFamily): Promise<MetadataEndpointTemplateDescriptor[]> {
    const templates = await this.loadEndpointTemplates();
    return family ? templates.filter((template) => template.family === family) : templates;
  }

  async saveEndpointTemplates(templates: MetadataEndpointTemplateDescriptor[]): Promise<void> {
    const existing = await this.loadEndpointTemplates();
    const merged = new Map(existing.map((template) => [template.id, template]));
    templates.forEach((template) => merged.set(template.id, template));
    await this.persistEndpointTemplates(Array.from(merged.values()));
  }

  async upsertGraphNode(input: GraphNodeRecordInput): Promise<GraphNodeRecord> {
    const nodes = await this.loadGraphNodes();
    const now = new Date().toISOString();
    const logicalKey = input.logicalKey;
    let targetIndex = nodes.findIndex((entry) => entry.id === input.id);
    if (targetIndex < 0) {
      targetIndex = nodes.findIndex((entry) => entry.logicalKey === logicalKey);
    }
    const previous = targetIndex >= 0 ? nodes[targetIndex] : null;
    const id = input.id ?? previous?.id ?? cryptoRandomId();
    const version = input.version ?? (previous ? (previous.version ?? 0) + 1 : 1);
    const normalizedScope = normalizeGraphScope(input.scope);
    const record: GraphNodeRecord = {
      id,
      tenantId: input.tenantId,
      projectId: input.projectId ?? previous?.projectId ?? null,
      entityType: input.entityType,
      displayName: input.displayName,
      canonicalPath: input.canonicalPath ?? null,
      sourceSystem: input.sourceSystem ?? null,
      specRef: input.specRef ?? null,
      properties: input.properties ?? {},
      version,
      scope: normalizedScope,
      originEndpointId: input.originEndpointId ?? previous?.originEndpointId ?? null,
      originVendor: input.originVendor ?? previous?.originVendor ?? null,
      logicalKey,
      externalId: input.externalId ?? previous?.externalId ?? null,
      phase: input.phase ?? previous?.phase ?? null,
      provenance: input.provenance ?? previous?.provenance ?? null,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    if (targetIndex >= 0) {
      nodes[targetIndex] = record;
    } else {
      nodes.push(record);
    }
    await this.persistGraphNodes(nodes);
    return record;
  }

  async getGraphNodeById(id: string): Promise<GraphNodeRecord | null> {
    const nodes = await this.loadGraphNodes();
    return nodes.find((entry) => entry.id === id) ?? null;
  }

  async getGraphNodeByLogicalKey(logicalKey: string): Promise<GraphNodeRecord | null> {
    const nodes = await this.loadGraphNodes();
    return nodes.find((entry) => entry.logicalKey === logicalKey) ?? null;
  }

  async listGraphNodes(filter: GraphNodeRecordFilter): Promise<GraphNodeRecord[]> {
    const nodes = await this.loadGraphNodes();
    const normalizedSearch = filter.search?.toLowerCase();
    return nodes
      .filter((entry) => entry.scope.orgId === filter.scopeOrgId)
      .filter((entry) => {
        if (!filter.entityTypes?.length) {
          return true;
        }
        return filter.entityTypes.includes(entry.entityType);
      })
      .filter((entry) => {
        if (!normalizedSearch) {
          return true;
        }
        const haystack = `${entry.displayName} ${entry.canonicalPath ?? ""} ${JSON.stringify(entry.properties ?? {})}`.toLowerCase();
        return haystack.includes(normalizedSearch);
      })
      .slice(0, filter.limit ?? Number.POSITIVE_INFINITY);
  }

  async upsertGraphEdge(input: GraphEdgeRecordInput): Promise<GraphEdgeRecord> {
    const edges = await this.loadGraphEdges();
    const now = new Date().toISOString();
    let targetIndex = edges.findIndex((entry) => entry.id === input.id);
    if (targetIndex < 0) {
      targetIndex = edges.findIndex((entry) => entry.logicalKey === input.logicalKey);
    }
    const previous = targetIndex >= 0 ? edges[targetIndex] : null;
    const id = input.id ?? previous?.id ?? cryptoRandomId();
    const normalizedScope = normalizeGraphScope(input.scope);
    const record: GraphEdgeRecord = {
      id,
      tenantId: input.tenantId,
      projectId: input.projectId ?? previous?.projectId ?? null,
      edgeType: input.edgeType,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      sourceLogicalKey: input.sourceLogicalKey,
      targetLogicalKey: input.targetLogicalKey,
      scope: normalizedScope,
      originEndpointId: input.originEndpointId ?? previous?.originEndpointId ?? null,
      originVendor: input.originVendor ?? previous?.originVendor ?? null,
      logicalKey: input.logicalKey,
      confidence: input.confidence ?? previous?.confidence ?? null,
      specRef: input.specRef ?? previous?.specRef ?? null,
      metadata: input.metadata ?? previous?.metadata ?? {},
      externalId: input.externalId ?? previous?.externalId ?? null,
      phase: input.phase ?? previous?.phase ?? null,
      provenance: input.provenance ?? previous?.provenance ?? null,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    if (targetIndex >= 0) {
      edges[targetIndex] = record;
    } else {
      edges.push(record);
    }
    await this.persistGraphEdges(edges);
    return record;
  }

  async getGraphEdgeById(id: string): Promise<GraphEdgeRecord | null> {
    const edges = await this.loadGraphEdges();
    return edges.find((entry) => entry.id === id) ?? null;
  }

  async getGraphEdgeByLogicalKey(logicalKey: string): Promise<GraphEdgeRecord | null> {
    const edges = await this.loadGraphEdges();
    return edges.find((entry) => entry.logicalKey === logicalKey) ?? null;
  }

  async listGraphEdges(filter: GraphEdgeRecordFilter): Promise<GraphEdgeRecord[]> {
    const edges = await this.loadGraphEdges();
    return edges
      .filter((entry) => entry.scope.orgId === filter.scopeOrgId)
      .filter((entry) => {
        if (!filter.edgeTypes?.length) {
          return true;
        }
        return filter.edgeTypes.includes(entry.edgeType);
      })
      .filter((entry) => {
        if (filter.sourceLogicalKey && entry.sourceLogicalKey !== filter.sourceLogicalKey) {
          return false;
        }
        if (filter.targetLogicalKey && entry.targetLogicalKey !== filter.targetLogicalKey) {
          return false;
        }
        if (filter.sourceNodeId && entry.sourceNodeId !== filter.sourceNodeId) {
          return false;
        }
        if (filter.targetNodeId && entry.targetNodeId !== filter.targetNodeId) {
          return false;
        }
        return true;
      })
      .slice(0, filter.limit ?? Number.POSITIVE_INFINITY);
  }

  private async loadEndpointTemplates(): Promise<MetadataEndpointTemplateDescriptor[]> {
    try {
      const contents = await readFile(this.endpointTemplatesFile, "utf-8");
      const parsed = JSON.parse(contents);
      if (Array.isArray(parsed)) {
        return parsed as MetadataEndpointTemplateDescriptor[];
      }
      return [];
    } catch (error) {
      if (isENOENT(error)) {
        return [];
      }
      throw error;
    }
  }

  private async persistEndpointTemplates(templates: MetadataEndpointTemplateDescriptor[]): Promise<void> {
    await ensureParentDir(this.endpointTemplatesFile);
    await writeFile(this.endpointTemplatesFile, JSON.stringify(templates, null, 2));
  }

  private async loadRecords<T = Record<string, unknown>>(): Promise<MetadataRecord<T>[]> {
    await ensureDir(this.rootDir);
    try {
      const contents = await readFile(this.recordsFile, "utf-8");
      const parsed = JSON.parse(contents) as MetadataRecord<T>[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error: unknown) {
      if (isENOENT(error)) {
        await this.persistRecords([]);
        return [];
      }
      if (error instanceof SyntaxError) {
        // eslint-disable-next-line no-console
        console.warn(`Metadata store at ${this.recordsFile} is corrupted. Resetting the manifest.`);
        await this.persistRecords([]);
        return [];
      }
      throw error;
    }
  }

  private async persistRecords(records: MetadataRecord<unknown>[]): Promise<void> {
    await ensureDir(this.rootDir);
    await writeFile(this.recordsFile, JSON.stringify(records, null, 2), "utf-8");
  }

  private async loadEndpoints(): Promise<MetadataEndpointDescriptor[]> {
    await ensureDir(this.rootDir);
    try {
      const contents = await readFile(this.endpointsFile, "utf-8");
      const raw = JSON.parse(contents);
      const parsed = Array.isArray(raw) ? (raw as MetadataEndpointDescriptor[]) : [];
      let mutated = false;
      const normalized = parsed.map((entry) => {
        if (entry.sourceId && entry.sourceId.trim().length > 0) {
          return entry;
        }
        mutated = true;
        return { ...entry, sourceId: generateSourceId(entry) };
      });
      if (mutated) {
        await this.persistEndpoints(normalized);
      }
      return normalized;
    } catch (error: unknown) {
      if (isENOENT(error)) {
        await this.persistEndpoints([]);
        return [];
      }
      throw error;
    }
  }

  private async persistEndpoints(endpoints: MetadataEndpointDescriptor[]): Promise<void> {
    await ensureDir(this.rootDir);
    await writeFile(this.endpointsFile, JSON.stringify(endpoints, null, 2), "utf-8");
  }

  private async loadGraphNodes(): Promise<GraphNodeRecord[]> {
    await ensureDir(this.rootDir);
    try {
      const contents = await readFile(this.graphNodesFile, "utf-8");
      const parsed = JSON.parse(contents);
      if (Array.isArray(parsed)) {
        return parsed as GraphNodeRecord[];
      }
      return [];
    } catch (error: unknown) {
      if (isENOENT(error)) {
        await this.persistGraphNodes([]);
        return [];
      }
      throw error;
    }
  }

  private async persistGraphNodes(nodes: GraphNodeRecord[]): Promise<void> {
    await ensureDir(this.rootDir);
    await writeFile(this.graphNodesFile, JSON.stringify(nodes, null, 2), "utf-8");
  }

  private async loadGraphEdges(): Promise<GraphEdgeRecord[]> {
    await ensureDir(this.rootDir);
    try {
      const contents = await readFile(this.graphEdgesFile, "utf-8");
      const parsed = JSON.parse(contents);
      if (Array.isArray(parsed)) {
        return parsed as GraphEdgeRecord[];
      }
      return [];
    } catch (error: unknown) {
      if (isENOENT(error)) {
        await this.persistGraphEdges([]);
        return [];
      }
      throw error;
    }
  }

  private async persistGraphEdges(edges: GraphEdgeRecord[]): Promise<void> {
    await ensureDir(this.rootDir);
    await writeFile(this.graphEdgesFile, JSON.stringify(edges, null, 2), "utf-8");
  }
}

type PrismaMetadataClient = {
  metadataRecord: {
    findMany(args: unknown): Promise<any[]>;
    findUnique(args: unknown): Promise<any | null>;
    create(args: unknown): Promise<any>;
    upsert(args: unknown): Promise<any>;
    delete(args: unknown): Promise<void>;
    groupBy?(args: unknown): Promise<any[]>;
  };
  metadataDomain?: {
    findMany(args?: unknown): Promise<any[]>;
  };
  metadataProject?: {
    findUnique(args: unknown): Promise<any | null>;
    create(args: unknown): Promise<any>;
  };
  metadataEndpoint: {
    findUnique?(args: unknown): Promise<any | null>;
    findMany(args?: unknown): Promise<any[]>;
    upsert(args: unknown): Promise<any>;
  };
  metadataEndpointTemplate?: {
    findMany(args?: unknown): Promise<any[]>;
    upsert(args: unknown): Promise<any>;
  };
  graphNode?: {
    findMany(args?: unknown): Promise<any[]>;
    findUnique(args: unknown): Promise<any | null>;
    upsert(args: unknown): Promise<any>;
  };
  graphEdge?: {
    findMany(args?: unknown): Promise<any[]>;
    findUnique(args: unknown): Promise<any | null>;
    upsert(args: unknown): Promise<any>;
  };
};

export class PrismaMetadataStore implements MetadataStore {
  constructor(private readonly prisma: PrismaMetadataClient) {}

  async listRecords<T = Record<string, unknown>>(domain: string, filter?: RecordFilter): Promise<MetadataRecord<T>[]> {
    const resolvedProjectId = await this.resolveProjectId(filter?.projectId ?? null);
    const search = filter?.search?.trim();
    const where: Record<string, unknown> = {
      domain,
      projectId: resolvedProjectId ?? filter?.projectId,
      labels: filter?.labels?.length ? { hasEvery: filter.labels } : undefined,
      searchText: search
        ? {
            contains: search,
            mode: "insensitive",
          }
        : undefined,
    };
    const records = await this.prisma.metadataRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filter?.limit,
    });
    return records.map((record) => mapPrismaRecord<T>(record));
  }

  async getRecord<T = Record<string, unknown>>(domain: string, id: string): Promise<MetadataRecord<T> | null> {
    const record = await this.prisma.metadataRecord.findUnique({ where: buildRecordKey(domain, id) });
    if (!record || record.domain !== domain) {
      return null;
    }
    return mapPrismaRecord<T>(record);
  }

  async upsertRecord<T = Record<string, unknown>>(input: MetadataRecordInput<T>): Promise<MetadataRecord<T>> {
    const ensuredProjectId = await this.ensureProject(input.projectId);
    const searchText = buildRecordSearchText(input.payload);
    if (input.id) {
      const upserted = await this.prisma.metadataRecord.upsert({
        where: buildRecordKey(input.domain, input.id),
        update: {
          projectId: ensuredProjectId,
          domain: input.domain,
          labels: input.labels ?? [],
          payload: input.payload,
          searchText,
        },
        create: {
          id: input.id,
          projectId: ensuredProjectId,
          domain: input.domain,
          labels: input.labels ?? [],
          payload: input.payload,
          searchText,
        },
      });
      return mapPrismaRecord<T>(upserted);
    }
    const created = await this.prisma.metadataRecord.create({
      data: {
        projectId: ensuredProjectId,
        domain: input.domain,
        labels: input.labels ?? [],
        payload: input.payload,
        searchText,
      },
    });
    return mapPrismaRecord<T>(created);
  }

  async deleteRecord(domain: string, id: string): Promise<void> {
    const record = await this.prisma.metadataRecord.findUnique({ where: buildRecordKey(domain, id) });
    if (!record || record.domain !== domain) {
      return;
    }
    await this.prisma.metadataRecord.delete({ where: buildRecordKey(domain, id) });
  }

  async listDomains(): Promise<MetadataDomainSummary[]> {
    const explicit = (await this.prisma.metadataDomain?.findMany?.()) ?? [];
    if (explicit.length > 0) {
      return explicit.map((domain: any) => ({
        key: domain.key,
        title: domain.title,
        description: domain.description ?? undefined,
        itemCount: domain.itemCount ?? 0,
      }));
    }
    if (typeof this.prisma.metadataRecord.groupBy === "function") {
      const aggregates = await this.prisma.metadataRecord.groupBy({
        by: ["domain"],
        _count: { domain: true },
      });
      return aggregates.map((entry: any) => ({
        key: entry.domain,
        title: entry.domain,
        itemCount: entry._count?.domain ?? 0,
      }));
    }
    const records = await this.prisma.metadataRecord.findMany({
      select: { domain: true },
    });
    const domainCounts = records.reduce<Record<string, number>>((acc, record) => {
      acc[record.domain] = (acc[record.domain] ?? 0) + 1;
      return acc;
    }, {});
    return Object.entries(domainCounts).map(([key, count]) => ({
      key,
      title: key,
      itemCount: count,
    }));
  }

  async listEndpoints(projectId?: string): Promise<MetadataEndpointDescriptor[]> {
    const resolvedProjectId = await this.resolveProjectId(projectId ?? null);
    const endpoints = await this.prisma.metadataEndpoint.findMany({
      where: resolvedProjectId ? { projectId: resolvedProjectId } : undefined,
      orderBy: { updatedAt: "desc" },
    });
    return endpoints.map(mapPrismaEndpoint);
  }

  async registerEndpoint(endpoint: MetadataEndpointDescriptor): Promise<MetadataEndpointDescriptor> {
    const endpointId = endpoint.id ?? cryptoRandomId();
    const normalizedSourceId =
      endpoint.sourceId && endpoint.sourceId.trim().length > 0 ? endpoint.sourceId.trim() : undefined;
    const ensuredProjectId = await this.ensureProject(endpoint.projectId ?? null);
    const result = await this.prisma.metadataEndpoint.upsert({
      where: { id: endpointId },
      update: {
        name: endpoint.name,
        description: endpoint.description ?? null,
        verb: endpoint.verb,
        url: endpoint.url,
        authPolicy: endpoint.authPolicy ?? null,
        projectId: ensuredProjectId,
        domain: endpoint.domain ?? null,
        labels: endpoint.labels ?? (endpoint.domain ? [endpoint.domain] : []),
        config: endpoint.config ?? null,
        detectedVersion: endpoint.detectedVersion ?? null,
        versionHint: endpoint.versionHint ?? null,
        capabilities: endpoint.capabilities ?? [],
        ...(normalizedSourceId ? { sourceId: normalizedSourceId } : {}),
        deletedAt: endpoint.deletedAt ?? null,
        deletionReason: endpoint.deletionReason ?? null,
      },
      create: {
        id: endpointId,
        sourceId: normalizedSourceId ?? generateSourceId(endpoint),
        name: endpoint.name,
        description: endpoint.description ?? null,
        verb: endpoint.verb,
        url: endpoint.url,
        authPolicy: endpoint.authPolicy ?? null,
        projectId: ensuredProjectId,
        domain: endpoint.domain ?? null,
        labels: endpoint.labels ?? (endpoint.domain ? [endpoint.domain] : []),
        config: endpoint.config ?? null,
        detectedVersion: endpoint.detectedVersion ?? null,
        versionHint: endpoint.versionHint ?? null,
        capabilities: endpoint.capabilities ?? [],
        deletedAt: endpoint.deletedAt ?? null,
        deletionReason: endpoint.deletionReason ?? null,
      },
    });
    return mapPrismaEndpoint(result);
  }

  async listEndpointTemplates(family?: MetadataEndpointTemplateFamily): Promise<MetadataEndpointTemplateDescriptor[]> {
    const templateClient = this.prisma.metadataEndpointTemplate;
    if (!templateClient?.findMany) {
      return [];
    }
    const templates = await templateClient.findMany({
      where: family ? { family } : undefined,
    });
    return templates.map(mapPrismaEndpointTemplate);
  }

  async saveEndpointTemplates(templates: MetadataEndpointTemplateDescriptor[]): Promise<void> {
    const templateClient = this.prisma.metadataEndpointTemplate;
    if (!templateClient?.upsert) {
      return;
    }
    await Promise.all(
      templates.map((template) =>
        templateClient.upsert({
          where: { id: template.id },
          update: {
            family: template.family,
            title: template.title,
            vendor: template.vendor,
            descriptor: template,
          },
          create: {
            id: template.id,
            family: template.family,
            title: template.title,
            vendor: template.vendor,
            descriptor: template,
          },
        }),
      ),
    );
  }

  async upsertGraphNode(input: GraphNodeRecordInput): Promise<GraphNodeRecord> {
    const client = this.prisma.graphNode;
    if (!client?.upsert) {
      throw new Error("Graph node storage is not available for this metadata store.");
    }
    const normalizedScope = normalizeGraphScope(input.scope);
    const ensuredProjectId = await this.ensureProject(input.projectId ?? null);
    const baseData = {
      tenantId: input.tenantId,
      projectId: ensuredProjectId,
      entityType: input.entityType,
      displayName: input.displayName,
      canonicalPath: input.canonicalPath ?? null,
      sourceSystem: input.sourceSystem ?? null,
      specRef: input.specRef ?? null,
      properties: input.properties ?? {},
      scopeOrgId: normalizedScope.orgId,
      scopeDomainId: normalizedScope.domainId,
      scopeProjectId: normalizedScope.projectId ?? ensuredProjectId,
      scopeTeamId: normalizedScope.teamId,
      originEndpointId: input.originEndpointId ?? null,
      originVendor: input.originVendor ?? null,
      externalId: input.externalId ?? null,
      phase: input.phase ?? null,
      provenance: input.provenance ?? null,
      logicalKey: input.logicalKey,
    };
    const record = await client.upsert({
      where: { logicalKey: input.logicalKey },
      update: {
        ...baseData,
        version: { increment: 1 },
      },
      create: {
        ...baseData,
        id: input.id ?? cryptoRandomId(),
        version: input.version ?? 1,
      },
    });
    return mapPrismaGraphNode(record);
  }

  async getGraphNodeById(id: string): Promise<GraphNodeRecord | null> {
    const client = this.prisma.graphNode;
    if (!client?.findUnique) {
      return null;
    }
    const record = await client.findUnique({ where: { id } });
    return record ? mapPrismaGraphNode(record) : null;
  }

  async getGraphNodeByLogicalKey(logicalKey: string): Promise<GraphNodeRecord | null> {
    const client = this.prisma.graphNode;
    if (!client?.findUnique) {
      return null;
    }
    const record = await client.findUnique({ where: { logicalKey } });
    return record ? mapPrismaGraphNode(record) : null;
  }

  async listGraphNodes(filter: GraphNodeRecordFilter): Promise<GraphNodeRecord[]> {
    const client = this.prisma.graphNode;
    if (!client?.findMany) {
      return [];
    }
    const search = filter.search?.trim();
    const where: Record<string, unknown> = {
      scopeOrgId: filter.scopeOrgId,
      ...(filter.entityTypes?.length ? { entityType: { in: filter.entityTypes } } : {}),
    };
    if (search && search.length > 0) {
      where.OR = [
        { displayName: { contains: search, mode: "insensitive" } },
        { canonicalPath: { contains: search, mode: "insensitive" } },
      ];
    }
    const records = await client.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: filter.limit,
    });
    return records.map(mapPrismaGraphNode);
  }

  async upsertGraphEdge(input: GraphEdgeRecordInput): Promise<GraphEdgeRecord> {
    const client = this.prisma.graphEdge;
    if (!client?.upsert) {
      throw new Error("Graph edge storage is not available for this metadata store.");
    }
    const normalizedScope = normalizeGraphScope(input.scope);
    const ensuredProjectId = await this.ensureProject(input.projectId ?? null);
    const baseData = {
      tenantId: input.tenantId,
      projectId: ensuredProjectId,
      edgeType: input.edgeType,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      sourceLogicalKey: input.sourceLogicalKey,
      targetLogicalKey: input.targetLogicalKey,
      scopeOrgId: normalizedScope.orgId,
      scopeDomainId: normalizedScope.domainId,
      scopeProjectId: normalizedScope.projectId ?? ensuredProjectId,
      scopeTeamId: normalizedScope.teamId,
      originEndpointId: input.originEndpointId ?? null,
      originVendor: input.originVendor ?? null,
      logicalKey: input.logicalKey,
      confidence: input.confidence ?? null,
      specRef: input.specRef ?? null,
      metadata: input.metadata ?? {},
      externalId: input.externalId ?? null,
      phase: input.phase ?? null,
      provenance: input.provenance ?? null,
    };
    const record = await client.upsert({
      where: { logicalKey: input.logicalKey },
      update: baseData,
      create: {
        ...baseData,
        id: input.id ?? cryptoRandomId(),
      },
    });
    return mapPrismaGraphEdge(record);
  }

  async getGraphEdgeById(id: string): Promise<GraphEdgeRecord | null> {
    const client = this.prisma.graphEdge;
    if (!client?.findUnique) {
      return null;
    }
    const record = await client.findUnique({ where: { id } });
    return record ? mapPrismaGraphEdge(record) : null;
  }

  async getGraphEdgeByLogicalKey(logicalKey: string): Promise<GraphEdgeRecord | null> {
    const client = this.prisma.graphEdge;
    if (!client?.findUnique) {
      return null;
    }
    const record = await client.findUnique({ where: { logicalKey } });
    return record ? mapPrismaGraphEdge(record) : null;
  }

  async listGraphEdges(filter: GraphEdgeRecordFilter): Promise<GraphEdgeRecord[]> {
    const client = this.prisma.graphEdge;
    if (!client?.findMany) {
      return [];
    }
    const where: Record<string, unknown> = {
      scopeOrgId: filter.scopeOrgId,
    };
    if (filter.edgeTypes?.length) {
      where.edgeType = { in: filter.edgeTypes };
    }
    if (filter.sourceLogicalKey) {
      where.sourceLogicalKey = filter.sourceLogicalKey;
    }
    if (filter.targetLogicalKey) {
      where.targetLogicalKey = filter.targetLogicalKey;
    }
    if (filter.sourceNodeId) {
      where.sourceNodeId = filter.sourceNodeId;
    }
    if (filter.targetNodeId) {
      where.targetNodeId = filter.targetNodeId;
    }
    const records = await client.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: filter.limit,
    });
    return records.map(mapPrismaGraphEdge);
  }

  private async ensureProject(projectId?: string | null): Promise<string | null> {
    if (!projectId) {
      return null;
    }
    const normalized = projectId.trim();
    if (!normalized.length) {
      return null;
    }
    const projectClient = this.prisma.metadataProject;
    if (!projectClient?.findUnique || !projectClient?.create) {
      return normalized;
    }
    const resolved = await this.resolveProjectId(normalized);
    if (resolved && resolved !== normalized) {
      return resolved;
    }
    if (resolved === normalized) {
      const exists = await projectClient.findUnique({ where: { id: normalized } });
      if (exists) {
        return normalized;
      }
    }
    const slug = slugify(normalized);
    const existingBySlug = await projectClient.findUnique({ where: { slug } });
    if (existingBySlug) {
      return existingBySlug.id ?? normalized;
    }
    await projectClient.create({
      data: {
        id: normalized,
        slug,
        displayName: normalized,
      },
    });
    return normalized;
  }

  private async resolveProjectId(projectId?: string | null): Promise<string | null> {
    if (!projectId) {
      return null;
    }
    const normalized = projectId.trim();
    if (!normalized.length) {
      return null;
    }
    const projectClient = this.prisma.metadataProject;
    if (!projectClient?.findUnique) {
      return normalized;
    }
    const existing = await projectClient.findUnique({ where: { id: normalized } });
    if (existing) {
      return normalized;
    }
    const slug = slugify(normalized);
    const existingBySlug = await projectClient.findUnique({ where: { slug } });
    if (existingBySlug) {
      return existingBySlug.id ?? normalized;
    }
    return normalized;
  }
}

function buildRecordKey(domain: string, id: string): Record<string, unknown> {
  return { domain_id: { domain, id } };
}

function buildRecordSearchText(payload: unknown): string {
  if (payload === null || payload === undefined) {
    return "";
  }
  if (typeof payload === "string") {
    return payload;
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return "";
  }
}

function mapPrismaRecord<T>(record: any): MetadataRecord<T> {
  return {
    id: record.id,
    projectId: record.projectId,
    domain: record.domain,
    labels: record.labels ?? [],
    payload: record.payload as T,
    createdAt: (record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt)).toISOString(),
    updatedAt: (record.updatedAt instanceof Date ? record.updatedAt : new Date(record.updatedAt)).toISOString(),
  };
}

function sortEndpointsByUpdatedAt(endpoints: MetadataEndpointDescriptor[]): MetadataEndpointDescriptor[] {
  return [...endpoints].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? "") || 0;
    const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? "") || 0;
    return bTime - aTime;
  });
}

function mapPrismaEndpoint(endpoint: any): MetadataEndpointDescriptor {
  return {
    id: endpoint.id,
    sourceId: endpoint.sourceId ?? undefined,
    name: endpoint.name,
    description: endpoint.description ?? undefined,
    verb: endpoint.verb as HttpVerb,
    url: endpoint.url,
    authPolicy: endpoint.authPolicy ?? undefined,
    projectId: endpoint.projectId ?? undefined,
    domain: endpoint.domain ?? undefined,
    labels: endpoint.labels ?? undefined,
    config: endpoint.config ?? undefined,
    detectedVersion: endpoint.detectedVersion ?? undefined,
    versionHint: endpoint.versionHint ?? undefined,
    capabilities: endpoint.capabilities ?? [],
    createdAt:
      endpoint.createdAt instanceof Date
        ? endpoint.createdAt.toISOString()
        : new Date(endpoint.createdAt ?? Date.now()).toISOString(),
    updatedAt:
      endpoint.updatedAt instanceof Date
        ? endpoint.updatedAt.toISOString()
        : new Date(endpoint.updatedAt ?? Date.now()).toISOString(),
    deletedAt:
      endpoint.deletedAt instanceof Date
        ? endpoint.deletedAt.toISOString()
        : endpoint.deletedAt
          ? new Date(endpoint.deletedAt).toISOString()
          : null,
    deletionReason: endpoint.deletionReason ?? null,
  };
}

function mapPrismaEndpointTemplate(template: any): MetadataEndpointTemplateDescriptor {
  const descriptor = (template.descriptor ?? {}) as MetadataEndpointTemplateDescriptor;
  return {
    ...descriptor,
    id: descriptor.id ?? template.id,
    family: descriptor.family ?? template.family,
    title: descriptor.title ?? template.title,
    vendor: descriptor.vendor ?? template.vendor,
  };
}

function mapPrismaGraphNode(node: any): GraphNodeRecord {
  return {
    id: node.id,
    tenantId: node.tenantId,
    projectId: node.projectId ?? null,
    entityType: node.entityType,
    displayName: node.displayName,
    canonicalPath: node.canonicalPath ?? null,
    sourceSystem: node.sourceSystem ?? null,
    specRef: node.specRef ?? null,
    properties: (node.properties ?? {}) as Record<string, unknown>,
    version: node.version ?? 1,
    scope: {
      orgId: node.scopeOrgId,
      domainId: node.scopeDomainId ?? null,
      projectId: node.scopeProjectId ?? node.projectId ?? null,
      teamId: node.scopeTeamId ?? null,
    },
    originEndpointId: node.originEndpointId ?? null,
    originVendor: node.originVendor ?? null,
    logicalKey: node.logicalKey,
    externalId: (node.externalId ?? null) as Record<string, unknown> | null,
    phase: node.phase ?? null,
    provenance: (node.provenance ?? null) as Record<string, unknown> | null,
    createdAt: node.createdAt instanceof Date ? node.createdAt.toISOString() : node.createdAt,
    updatedAt: node.updatedAt instanceof Date ? node.updatedAt.toISOString() : node.updatedAt,
  };
}

function mapPrismaGraphEdge(edge: any): GraphEdgeRecord {
  return {
    id: edge.id,
    tenantId: edge.tenantId,
    projectId: edge.projectId ?? null,
    edgeType: edge.edgeType,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    sourceLogicalKey: edge.sourceLogicalKey,
    targetLogicalKey: edge.targetLogicalKey,
    scope: {
      orgId: edge.scopeOrgId,
      domainId: edge.scopeDomainId ?? null,
      projectId: edge.scopeProjectId ?? edge.projectId ?? null,
      teamId: edge.scopeTeamId ?? null,
    },
    originEndpointId: edge.originEndpointId ?? null,
    originVendor: edge.originVendor ?? null,
    logicalKey: edge.logicalKey,
    confidence: edge.confidence ?? null,
    specRef: edge.specRef ?? null,
    metadata: (edge.metadata ?? {}) as Record<string, unknown>,
    externalId: (edge.externalId ?? null) as Record<string, unknown> | null,
    phase: edge.phase ?? null,
    provenance: (edge.provenance ?? null) as Record<string, unknown> | null,
    createdAt: edge.createdAt instanceof Date ? edge.createdAt.toISOString() : edge.createdAt,
    updatedAt: edge.updatedAt instanceof Date ? edge.updatedAt.toISOString() : edge.updatedAt,
  };
}

function cryptoRandomId(): string {
  try {
    return nodeRandomUUID().replace(/-/g, "");
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

function generateSourceId(endpoint: MetadataEndpointDescriptor): string {
  const projectSlug = slugify(endpoint.projectId ?? "global");
  const nameSlug = slugify(endpoint.name || "endpoint");
  const base = [projectSlug, nameSlug].filter(Boolean).join("-");
  return `${base}-${cryptoRandomId()}`;
}

function slugify(value: string): string {
  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "source";
}

function normalizeGraphScope(scope: GraphScopeInput | GraphScope): GraphScope {
  return {
    orgId: scope.orgId,
    domainId: scope.domainId ?? null,
    projectId: scope.projectId ?? null,
    teamId: scope.teamId ?? null,
  };
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    if (!isEEXIST(error)) {
      throw error;
    }
  }
}

async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

function isENOENT(error: unknown): boolean {
  return Boolean((error as NodeJS.ErrnoException)?.code === "ENOENT");
}

function isEEXIST(error: unknown): boolean {
  return Boolean((error as NodeJS.ErrnoException)?.code === "EEXIST");
}

type GraphEmbeddingRecordPayload = {
  tenantId: string;
  projectId: string;
  entityId: string;
  modelId: string;
  vector: number[];
  hash: string;
  metadata?: Record<string, unknown>;
};

const GRAPH_EMBEDDING_DOMAIN = "graph.embedding";

class MetadataGraphStore implements GraphStore {
  constructor(private readonly store: MetadataStore) {}

  async capabilities(): Promise<GraphStoreCapabilities> {
    return {
      vectorSearch: true,
      pathQueries: false,
      annotations: true,
    };
  }

  async upsertEntity(input: GraphEntityInput, context: TenantContext): Promise<GraphEntity> {
    const normalizedScope = normalizeGraphScope(input.scope ?? { orgId: context.tenantId, projectId: context.projectId });
    const identity = resolveGraphEntityIdentity(input, normalizedScope);
    const record = await this.store.upsertGraphNode({
      id: input.id,
      tenantId: context.tenantId,
      projectId: context.projectId,
      entityType: input.entityType,
      displayName: input.displayName,
      canonicalPath: input.canonicalPath ?? null,
      sourceSystem: input.sourceSystem ?? null,
      specRef: input.specRef ?? null,
      properties: input.properties ?? {},
      scope: normalizedScope,
      originEndpointId: identity.originEndpointId ?? undefined,
      originVendor: identity.originVendor ?? undefined,
      logicalKey: identity.logicalKey,
      externalId: identity.externalId ?? undefined,
      phase: identity.phase ?? undefined,
      provenance: identity.provenance ?? undefined,
    });
    return mapGraphNodeRecordToEntity(record);
  }

  async getEntity(id: string, context: TenantContext): Promise<GraphEntity | null> {
    const record = await this.store.getGraphNodeById(id);
    if (!record || record.scope.orgId !== context.tenantId) {
      return null;
    }
    return mapGraphNodeRecordToEntity(record);
  }

  async listEntities(filter: GraphEntityFilter | undefined, context: TenantContext): Promise<GraphEntity[]> {
    const records = await this.store.listGraphNodes({
      scopeOrgId: context.tenantId,
      entityTypes: filter?.entityTypes,
      search: filter?.search,
      limit: filter?.limit,
    });
    return records.map(mapGraphNodeRecordToEntity);
  }

  async upsertEdge(input: GraphEdgeInput, context: TenantContext): Promise<GraphEdge> {
    const source = await this.requireGraphNode(input.sourceEntityId, context);
    const target = await this.requireGraphNode(input.targetEntityId, context);
    const normalizedScope = normalizeGraphScope(
      input.scope ?? source.scope ?? { orgId: context.tenantId, projectId: context.projectId },
    );
    if (source.scope.orgId !== target.scope.orgId || source.scope.orgId !== normalizedScope.orgId) {
      throw new Error("Cross-scope graph edges are not permitted.");
    }
    const identity = resolveGraphEdgeIdentity(input, normalizedScope, source, target);
    const record = await this.store.upsertGraphEdge({
      id: input.id,
      tenantId: context.tenantId,
      projectId: context.projectId,
      edgeType: input.edgeType,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourceLogicalKey: identity.sourceLogicalKey,
      targetLogicalKey: identity.targetLogicalKey,
      scope: normalizedScope,
      originEndpointId: identity.originEndpointId ?? undefined,
      originVendor: identity.originVendor ?? undefined,
      logicalKey: identity.logicalKey,
      confidence: input.confidence ?? undefined,
      specRef: input.specRef ?? undefined,
      metadata: input.metadata ?? undefined,
      externalId: identity.externalId ?? undefined,
      phase: identity.phase ?? undefined,
      provenance: identity.provenance ?? undefined,
    });
    return mapGraphEdgeRecordToEdge(record);
  }

  async listEdges(filter: GraphEdgeFilter | undefined, context: TenantContext): Promise<GraphEdge[]> {
    const records = await this.store.listGraphEdges({
      scopeOrgId: context.tenantId,
      edgeTypes: filter?.edgeTypes,
      sourceNodeId: filter?.sourceEntityId,
      targetNodeId: filter?.targetEntityId,
      limit: filter?.limit,
    });
    return records.map(mapGraphEdgeRecordToEdge);
  }

  private async requireGraphNode(id: string, context: TenantContext): Promise<GraphNodeRecord> {
    const record = await this.store.getGraphNodeById(id);
    if (!record || record.scope.orgId !== context.tenantId) {
      throw new Error(`Graph node ${id} is not accessible within tenant scope.`);
    }
    return record;
  }

  async putEmbedding(input: GraphEmbeddingInput, context: TenantContext): Promise<GraphEmbedding> {
    const hash = hashVector(input.vector);
    const record = await this.store.upsertRecord<GraphEmbeddingRecordPayload>({
      id: `${input.entityId}-${hash}`,
      projectId: context.projectId,
      domain: GRAPH_EMBEDDING_DOMAIN,
      labels: [context.tenantId, input.modelId],
      payload: {
        tenantId: context.tenantId,
        projectId: context.projectId,
        entityId: input.entityId,
        modelId: input.modelId,
        vector: input.vector,
        hash,
        metadata: input.metadata ?? {},
      },
    });
    return mapRecordToGraphEmbedding(record);
  }

  async searchEmbeddings(
    query: { vector: number[]; limit?: number; modelId?: string },
    context: TenantContext,
  ): Promise<GraphEmbedding[]> {
    const records = await this.store.listRecords<GraphEmbeddingRecordPayload>(GRAPH_EMBEDDING_DOMAIN, {
      projectId: context.projectId,
    });
    const scored = records
      .filter((record) => (query.modelId ? record.payload.modelId === query.modelId : true))
      .map((record) => {
        const similarity = cosineSimilarity(query.vector, record.payload.vector);
        return { record, similarity };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, query.limit ?? 10);
    return scored.map((entry) => mapRecordToGraphEmbedding(entry.record));
  }
}

function mapGraphNodeRecordToEntity(record: GraphNodeRecord): GraphEntity {
  return {
    id: record.id,
    entityType: record.entityType,
    displayName: record.displayName,
    canonicalPath: record.canonicalPath ?? undefined,
    sourceSystem: record.sourceSystem ?? undefined,
    specRef: record.specRef ?? undefined,
    properties: record.properties ?? {},
    tenantId: record.tenantId,
    projectId: record.projectId,
    version: record.version ?? 1,
    scope: record.scope,
    identity: {
      logicalKey: record.logicalKey,
      externalId: record.externalId ?? null,
      originEndpointId: record.originEndpointId ?? null,
      originVendor: record.originVendor ?? null,
      phase: record.phase ?? null,
      provenance: record.provenance ?? null,
    },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapGraphEdgeRecordToEdge(record: GraphEdgeRecord): GraphEdge {
  return {
    id: record.id,
    edgeType: record.edgeType,
    sourceEntityId: record.sourceNodeId,
    targetEntityId: record.targetNodeId,
    confidence: record.confidence ?? undefined,
    specRef: record.specRef ?? undefined,
    metadata: record.metadata ?? {},
    tenantId: record.tenantId,
    projectId: record.projectId,
    scope: record.scope,
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
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function resolveGraphEntityIdentity(input: GraphEntityInput, scope: GraphScope): GraphIdentity {
  const identityInput = input.identity ?? {};
  const logicalKey =
    identityInput.logicalKey ??
    buildGraphEntityLogicalKey({
      entityType: input.entityType,
      scope,
      canonicalPath: input.canonicalPath ?? input.displayName ?? input.id ?? "",
      fallbackId: input.id ?? null,
      originEndpointId: identityInput.originEndpointId ?? null,
      originVendor: identityInput.originVendor ?? null,
      externalId: identityInput.externalId ?? null,
    });
  return {
    logicalKey,
    externalId: identityInput.externalId ?? null,
    originEndpointId: identityInput.originEndpointId ?? null,
    originVendor: identityInput.originVendor ?? null,
    phase: identityInput.phase ?? null,
    provenance: identityInput.provenance ?? null,
  };
}

function resolveGraphEdgeIdentity(
  input: GraphEdgeInput,
  scope: GraphScope,
  source: GraphNodeRecord,
  target: GraphNodeRecord,
): GraphEdgeIdentity {
  const identityInput = input.identity ?? {};
  const sourceLogicalKey = identityInput.sourceLogicalKey ?? source.logicalKey;
  const targetLogicalKey = identityInput.targetLogicalKey ?? target.logicalKey;
  const logicalKey =
    identityInput.logicalKey ??
    buildGraphEdgeLogicalKey({
      edgeType: input.edgeType,
      scope,
      sourceLogicalKey,
      targetLogicalKey,
      originEndpointId: identityInput.originEndpointId ?? null,
      originVendor: identityInput.originVendor ?? null,
    });
  return {
    logicalKey,
    sourceLogicalKey,
    targetLogicalKey,
    externalId: identityInput.externalId ?? null,
    originEndpointId: identityInput.originEndpointId ?? null,
    originVendor: identityInput.originVendor ?? null,
    phase: identityInput.phase ?? null,
    provenance: identityInput.provenance ?? null,
  };
}

function buildGraphEntityLogicalKey(params: {
  entityType: string;
  scope: GraphScope;
  canonicalPath?: string | null;
  fallbackId?: string | null;
  originEndpointId?: string | null;
  originVendor?: string | null;
  externalId?: Record<string, unknown> | null;
}): string {
  return hashLogicalKey([
    "entity",
    params.entityType,
    params.scope.orgId,
    params.scope.projectId ?? "",
    params.scope.domainId ?? "",
    params.scope.teamId ?? "",
    params.originEndpointId ?? "",
    params.originVendor ?? "",
    params.canonicalPath ?? "",
    params.fallbackId ?? "",
    stableStringify(params.externalId ?? null),
  ]);
}

function buildGraphEdgeLogicalKey(params: {
  edgeType: string;
  scope: GraphScope;
  sourceLogicalKey: string;
  targetLogicalKey: string;
  originEndpointId?: string | null;
  originVendor?: string | null;
}): string {
  return hashLogicalKey([
    "edge",
    params.edgeType,
    params.scope.orgId,
    params.scope.projectId ?? "",
    params.scope.domainId ?? "",
    params.scope.teamId ?? "",
    params.originEndpointId ?? "",
    params.originVendor ?? "",
    params.sourceLogicalKey,
    params.targetLogicalKey,
  ]);
}

function hashLogicalKey(parts: (string | null | undefined)[]): string {
  const hash = createHash("sha256");
  hash.update(parts.map((part) => (part ?? "")).join("|"));
  return hash.digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value === "undefined") {
    return "";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function mapRecordToGraphEmbedding(record: MetadataRecord<GraphEmbeddingRecordPayload>): GraphEmbedding {
  return {
    id: record.id,
    tenantId: record.payload.tenantId,
    projectId: record.projectId,
    entityId: record.payload.entityId,
    modelId: record.payload.modelId,
    vector: record.payload.vector,
    hash: record.payload.hash,
    metadata: record.payload.metadata ?? {},
    createdAt: record.createdAt,
  };
}

export function createGraphStore(options: GraphStoreFactoryOptions): GraphStore {
  const driver = (options.driver ?? "metadata").toLowerCase();
  switch (driver) {
    case "metadata":
    case "postgres":
      return new MetadataGraphStore(options.metadataStore);
    default:
      throw new Error(`Unsupported graph store driver: ${driver}`);
  }
}

export interface ObjectStore {
  putObject(key: string, body: Buffer | Uint8Array | string): Promise<void>;
  getObject(key: string): Promise<Buffer | null>;
  deleteObject(key: string): Promise<void>;
  generatePresignedUrl?(key: string, options?: { expiresInSeconds?: number }): Promise<string>;
}

export type ObjectStoreFactoryOptions = {
  driver?: string;
  rootDir?: string;
  bucket?: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
};

class FileObjectStore implements ObjectStore {
  constructor(private readonly rootDir: string) {}

  async putObject(key: string, body: Buffer | Uint8Array | string): Promise<void> {
    const resolved = this.resolvePath(key);
    await ensureParentDir(resolved);
    const data = typeof body === "string" ? body : Buffer.from(body);
    await writeFile(resolved, data);
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const resolved = this.resolvePath(key);
      const data = await readFile(resolved);
      return data;
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await unlink(this.resolvePath(key));
    } catch {
      // ignore
    }
  }

  async generatePresignedUrl(key: string): Promise<string> {
    const resolved = this.resolvePath(key);
    return pathToFileURL(resolved).toString();
  }

  private resolvePath(key: string): string {
    const normalized = key.replace(/^\/+/, "");
    return path.resolve(this.rootDir, normalized);
  }
}

class S3ObjectStore implements ObjectStore {
  constructor(private readonly client: S3Client, private readonly bucket: string) {}

  async putObject(key: string, body: Buffer | Uint8Array | string): Promise<void> {
    const payload = typeof body === "string" ? Buffer.from(body) : Buffer.isBuffer(body) ? body : Buffer.from(body);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: payload,
      }),
    );
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      if (!response.Body) {
        return null;
      }
      const chunks: Uint8Array[] = [];
      const stream = response.Body as NodeJS.ReadableStream;
      for await (const chunk of stream) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async generatePresignedUrl(key: string, options?: { expiresInSeconds?: number }): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: options?.expiresInSeconds ?? 300 });
  }
}

export function createObjectStore(options?: ObjectStoreFactoryOptions): ObjectStore {
  const driver = (options?.driver ?? process.env.OBJECT_STORE_DRIVER ?? "file").toLowerCase();
  switch (driver) {
    case "file":
      return new FileObjectStore(options?.rootDir ?? process.env.OBJECT_STORE_ROOT ?? DEFAULT_OBJECT_STORE_DIR);
    case "s3": {
      const bucket = options?.bucket ?? process.env.OBJECT_STORE_BUCKET;
      if (!bucket) {
        throw new Error("OBJECT_STORE_BUCKET is required for s3 driver");
      }
      const endpoint = options?.endpoint ?? process.env.OBJECT_STORE_ENDPOINT;
      const region = options?.region ?? process.env.OBJECT_STORE_REGION ?? "us-east-1";
      const accessKeyId = options?.accessKeyId ?? process.env.OBJECT_STORE_ACCESS_KEY;
      const secretAccessKey = options?.secretAccessKey ?? process.env.OBJECT_STORE_SECRET_KEY;
      if (!accessKeyId || !secretAccessKey) {
        throw new Error("OBJECT_STORE_ACCESS_KEY and OBJECT_STORE_SECRET_KEY are required for s3 driver");
      }
      const forcePathStyle =
        options?.forcePathStyle ??
        (process.env.OBJECT_STORE_FORCE_PATH_STYLE ? process.env.OBJECT_STORE_FORCE_PATH_STYLE === "true" : true);
      const client = new S3Client({
        region,
        endpoint,
        forcePathStyle,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      return new S3ObjectStore(client, bucket);
    }
    default:
      throw new Error(`Unsupported object store driver: ${driver}`);
  }
}

export interface KeyValueStore {
  get<T = unknown>(key: string): Promise<{ value: T | null; version: string | null }>;
  put<T = unknown>(key: string, value: T, options?: { expectedVersion?: string | null }): Promise<string>;
  delete(key: string, options?: { expectedVersion?: string | null }): Promise<void>;
}

type KeyValueStoreFactoryOptions = {
  driver?: string;
  filePath?: string;
};

type FileKeyValueEntry = {
  value: unknown;
  version: string;
  updatedAt: string;
};

class FileKeyValueStore implements KeyValueStore {
  constructor(private readonly filePath: string) {}

  async get<T = unknown>(key: string): Promise<{ value: T | null; version: string | null }> {
    const store = await this.load();
    const entry = store[key];
    if (!entry) {
      return { value: null, version: null };
    }
    return {
      value: entry.value as T,
      version: entry.version,
    };
  }

  async put<T = unknown>(key: string, value: T, options?: { expectedVersion?: string | null }): Promise<string> {
    const store = await this.load();
    const current = store[key];
    if (options?.expectedVersion && current?.version !== options.expectedVersion) {
      throw new Error("CAS mismatch");
    }
    const version = cryptoRandomId();
    store[key] = {
      value,
      version,
      updatedAt: new Date().toISOString(),
    };
    await this.persist(store);
    return version;
  }

  async delete(key: string, options?: { expectedVersion?: string | null }): Promise<void> {
    const store = await this.load();
    const current = store[key];
    if (!current) {
      return;
    }
    if (options?.expectedVersion && current.version !== options.expectedVersion) {
      throw new Error("CAS mismatch");
    }
    delete store[key];
    await this.persist(store);
  }

  private async load(): Promise<Record<string, FileKeyValueEntry>> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed ? (parsed as Record<string, FileKeyValueEntry>) : {};
    } catch {
      return {};
    }
  }

  private async persist(store: Record<string, FileKeyValueEntry>): Promise<void> {
    await ensureParentDir(this.filePath);
    await writeFile(this.filePath, JSON.stringify(store, null, 2), "utf-8");
  }
}

export function createKeyValueStore(options?: KeyValueStoreFactoryOptions): KeyValueStore {
  const driver = (options?.driver ?? process.env.KV_STORE_DRIVER ?? "file").toLowerCase();
  switch (driver) {
    case "file":
      return new FileKeyValueStore(options?.filePath ?? process.env.KV_STORE_FILE ?? DEFAULT_KV_STORE_FILE);
    default:
      throw new Error(`Unsupported KV store driver: ${driver}`);
  }
}

export interface JsonDocumentStore {
  getDocument<T = unknown>(collection: string, id: string): Promise<T | null>;
  upsertDocument<T = unknown>(collection: string, id: string, document: T): Promise<void>;
  deleteDocument(collection: string, id: string): Promise<void>;
}

type JsonDocumentStoreFactoryOptions = {
  driver?: string;
  rootDir?: string;
  objectStoreOptions?: ObjectStoreFactoryOptions;
};

class FileJsonDocumentStore implements JsonDocumentStore {
  constructor(private readonly rootDir: string) {}

  async getDocument<T = unknown>(collection: string, id: string): Promise<T | null> {
    try {
      const raw = await readFile(this.resolve(collection, id), "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async upsertDocument<T = unknown>(collection: string, id: string, document: T): Promise<void> {
    const resolved = this.resolve(collection, id);
    await ensureParentDir(resolved);
    await writeFile(resolved, JSON.stringify(document, null, 2), "utf-8");
  }

  async deleteDocument(collection: string, id: string): Promise<void> {
    try {
      await unlink(this.resolve(collection, id));
    } catch {
      // ignore
    }
  }

  private resolve(collection: string, id: string): string {
    return path.resolve(this.rootDir, collection, `${id}.json`);
  }
}

class ObjectJsonDocumentStore implements JsonDocumentStore {
  constructor(private readonly store: ObjectStore, private readonly prefix: string) {}

  async getDocument<T = unknown>(collection: string, id: string): Promise<T | null> {
    const key = this.key(collection, id);
    const data = await this.store.getObject(key);
    if (!data) {
      return null;
    }
    return JSON.parse(data.toString("utf-8")) as T;
  }

  async upsertDocument<T = unknown>(collection: string, id: string, document: T): Promise<void> {
    const key = this.key(collection, id);
    const payload = JSON.stringify(document, null, 2);
    await this.store.putObject(key, payload);
  }

  async deleteDocument(collection: string, id: string): Promise<void> {
    const key = this.key(collection, id);
    await this.store.deleteObject(key);
  }

  private key(collection: string, id: string): string {
    return `${this.prefix}/${collection}/${id}.json`;
  }
}

export function createJsonDocumentStore(options?: JsonDocumentStoreFactoryOptions): JsonDocumentStore {
  const driver = (options?.driver ?? process.env.JSON_STORE_DRIVER ?? "file").toLowerCase();
  switch (driver) {
    case "file":
      return new FileJsonDocumentStore(options?.rootDir ?? process.env.JSON_STORE_ROOT ?? DEFAULT_JSON_STORE_DIR);
    case "s3": {
      const prefix = process.env.JSON_STORE_PREFIX ?? "json";
      const objectStore =
        options?.objectStoreOptions && options.objectStoreOptions.driver
          ? createObjectStore(options.objectStoreOptions)
          : createObjectStore({ driver: "s3" });
      return new ObjectJsonDocumentStore(objectStore, prefix);
    }
    default:
      throw new Error(`Unsupported JSON store driver: ${driver}`);
  }
}

export interface CodeStore {
  saveSnippet(input: { path: string; content: string }): Promise<void>;
  readSnippet(path: string): Promise<string | null>;
  deleteSnippet(path: string): Promise<void>;
}

type CodeStoreFactoryOptions = {
  driver?: string;
  rootDir?: string;
  objectStoreOptions?: ObjectStoreFactoryOptions;
};

class FileCodeStore implements CodeStore {
  constructor(private readonly rootDir: string) {}

  async saveSnippet(input: { path: string; content: string }): Promise<void> {
    const resolved = this.resolve(input.path);
    await ensureParentDir(resolved);
    await writeFile(resolved, input.content, "utf-8");
  }

  async readSnippet(pathName: string): Promise<string | null> {
    try {
      return await readFile(this.resolve(pathName), "utf-8");
    } catch {
      return null;
    }
  }

  async deleteSnippet(pathName: string): Promise<void> {
    try {
      await unlink(this.resolve(pathName));
    } catch {
      // ignore
    }
  }

  private resolve(pathName: string): string {
    const normalized = pathName.replace(/^\/+/, "");
    return path.resolve(this.rootDir, normalized);
  }
}

class ObjectCodeStore implements CodeStore {
  constructor(private readonly store: ObjectStore, private readonly prefix: string) {}

  async saveSnippet(input: { path: string; content: string }): Promise<void> {
    const key = this.key(input.path);
    await this.store.putObject(key, input.content);
  }

  async readSnippet(pathName: string): Promise<string | null> {
    const key = this.key(pathName);
    const data = await this.store.getObject(key);
    return data ? data.toString("utf-8") : null;
  }

  async deleteSnippet(pathName: string): Promise<void> {
    const key = this.key(pathName);
    await this.store.deleteObject(key);
  }

  private key(pathName: string): string {
    const normalized = pathName.replace(/^\/+/, "");
    return `${this.prefix}/${normalized}`;
  }
}

export function createCodeStore(options?: CodeStoreFactoryOptions): CodeStore {
  const driver = (options?.driver ?? process.env.CODE_STORE_DRIVER ?? "file").toLowerCase();
  switch (driver) {
    case "file":
      return new FileCodeStore(options?.rootDir ?? process.env.CODE_STORE_ROOT ?? DEFAULT_CODE_STORE_DIR);
    case "s3": {
      const prefix = process.env.CODE_STORE_PREFIX ?? "code";
      const objectStore =
        options?.objectStoreOptions && options.objectStoreOptions.driver
          ? createObjectStore(options.objectStoreOptions)
          : createObjectStore({ driver: "s3" });
      return new ObjectCodeStore(objectStore, prefix);
    }
    default:
      throw new Error(`Unsupported code store driver: ${driver}`);
  }
}

function hashVector(vector: number[]): string {
  const hash = createHash("sha256");
  vector.forEach((value) => {
    hash.update(value.toString());
    hash.update("|");
  });
  return hash.digest("hex");
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (!magA || !magB) {
    return 0;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
