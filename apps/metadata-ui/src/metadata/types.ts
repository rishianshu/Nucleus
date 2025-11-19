import type { MetadataDataset as BaseMetadataDataset } from "@metadata/client";

export type CatalogDatasetField = BaseMetadataDataset["fields"][number];

export type CatalogDatasetProfile = {
  recordCount?: number | null;
  sampleSize?: number | null;
  lastProfiledAt?: string | null;
  raw?: Record<string, unknown> | null;
};

export type CatalogDataset = BaseMetadataDataset & {
  upstreamId?: string | null;
  projectIds?: string[] | null;
  labels?: string[] | null;
  schema?: string | null;
  entity?: string | null;
  collectedAt?: string | null;
  sourceEndpointId?: string | null;
  profile?: CatalogDatasetProfile | null;
  sampleRows?: Array<Record<string, unknown>>;
  statistics?: Record<string, unknown> | null;
  sourceEndpoint?: { id: string; name: string; capabilities?: string[] | null } | null;
  lastCollectionRun?: {
    id: string;
    status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
    requestedAt?: string | null;
    completedAt?: string | null;
  } | null;
};

export type DatasetPreviewResult = {
  rows: Array<Record<string, unknown>>;
  sampledAt?: string | null;
};

export type EndpointDatasetRecord = {
  id: string;
  projectId: string;
  domain: string;
  labels: string[];
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type MetadataCollectionRunSummary = {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  requestedAt: string;
  requestedBy?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  filters?: Record<string, unknown> | null;
  endpoint?: { id: string; name: string; isDeleted?: boolean | null } | null;
  collection?: { id: string; endpointId: string } | null;
};

export type MetadataEndpointSummary = {
  id: string;
  sourceId: string;
  name: string;
  description?: string | null;
  verb: string;
  url: string;
  authPolicy?: string | null;
  domain?: string | null;
  labels?: string[] | null;
  config?: Record<string, unknown> | null;
  detectedVersion?: string | null;
  versionHint?: string | null;
  capabilities?: string[] | null;
  deletedAt?: string | null;
  deletionReason?: string | null;
  isDeleted: boolean;
  runs?: MetadataCollectionRunSummary[] | null;
};

export type MetadataCollectionSummary = {
  id: string;
  endpointId: string;
  scheduleCron?: string | null;
  scheduleTimezone?: string | null;
  isEnabled: boolean;
  temporalScheduleId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MetadataEndpointTemplateOption = {
  label: string;
  value: string;
  description?: string | null;
};

export type MetadataEndpointFieldVisibilityRule = {
  field: string;
  values: string[];
};

export type MetadataEndpointTemplateField = {
  key: string;
  label: string;
  required: boolean;
  valueType:
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
  semantic?: string | null;
  description?: string | null;
  placeholder?: string | null;
  helpText?: string | null;
  options?: MetadataEndpointTemplateOption[] | null;
  regex?: string | null;
  min?: number | null;
  max?: number | null;
  defaultValue?: string | null;
  advanced?: boolean | null;
  sensitive?: boolean | null;
  dependsOn?: string | null;
  dependsValue?: string | null;
  visibleWhen?: MetadataEndpointFieldVisibilityRule[] | null;
};

export type CatalogDatasetConnection = {
  nodes: CatalogDataset[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor?: string | null;
    endCursor?: string | null;
  };
  totalCount: number;
};

export type MetadataEndpointTemplateCapability = {
  key: string;
  label: string;
  description?: string | null;
};

export type MetadataEndpointProbingMethod = {
  key: string;
  label: string;
  strategy: string;
  statement?: string | null;
  description?: string | null;
  requires?: string[] | null;
  returnsVersion?: boolean | null;
  returnsCapabilities?: string[] | null;
};

export type MetadataEndpointProbingPlan = {
  methods: MetadataEndpointProbingMethod[];
  fallbackMessage?: string | null;
};

export type MetadataEndpointTemplate = {
  id: string;
  family: "JDBC" | "HTTP" | "STREAM";
  title: string;
  vendor: string;
  description?: string | null;
  domain?: string | null;
  categories: string[];
  protocols: string[];
  versions: string[];
  defaultPort?: number | null;
  driver?: string | null;
  docsUrl?: string | null;
  agentPrompt?: string | null;
  defaultLabels?: string[] | null;
  fields: MetadataEndpointTemplateField[];
  capabilities: MetadataEndpointTemplateCapability[];
  sampleConfig?: Record<string, unknown> | null;
  connection?: { urlTemplate?: string | null; defaultVerb?: string | null } | null;
  descriptorVersion?: string | null;
  minVersion?: string | null;
  maxVersion?: string | null;
  probing?: MetadataEndpointProbingPlan | null;
};

export type MetadataEndpointTestResult = {
  ok: boolean;
  diagnostics: Array<{
    level: string;
    code: string;
    message: string;
    hint?: string | null;
    field?: string | null;
  }>;
};
