/**
 * UCL gRPC Client - TypeScript wrapper for UCL gRPC service
 * 
 * This replaces the Python CLI (runRegistryCommand) with gRPC calls.
 * The gRPC server runs on platform/ucl-core/cmd/server at :50051
 */

import * as protoLoader from "@grpc/proto-loader";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Proto path relative to this file
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(
  moduleDir,
  "..",
  "..",
  "..",
  "..",
  "platform",
  "ucl-core",
  "proto",
  "ucl.proto"
);

// gRPC server address
const UCL_GRPC_ADDRESS = process.env.UCL_GRPC_ADDRESS ?? "localhost:50051";

// Types matching proto definitions
export interface AuthModeDescriptor {
  mode: string;
  label?: string;
  requiredFields?: string[];
  scopes?: string[];
  interactive?: boolean;
}

export interface ProfileBindingDescriptor {
  supported: boolean;
  principalKinds?: string[];
  notes?: string;
}

export interface AuthDescriptor {
  modes?: AuthModeDescriptor[];
  profileBinding?: ProfileBindingDescriptor | null;
}

export interface EndpointTemplate {
  id: string;
  family: string;
  displayName: string;
  vendor: string;
  description: string;
  fields: FieldDescriptor[];
  categories: string[];
  
  // Extended fields
  domain?: string;
  protocols?: string[];
  defaultPort?: number;
  driver?: string;
  docsUrl?: string;
  agentPrompt?: string;
  defaultLabels?: string[];
  descriptorVersion?: string;
  minVersion?: string;
  maxVersion?: string;
  capabilities?: Capability[];
  connection?: ConnectionConfig;
  probing?: ProbingPlan;
  auth?: AuthDescriptor;
  sampleConfig?: string;
  extras?: Record<string, string>;
}

export interface Capability {
  key: string;
  label: string;
  description: string;
}

export interface ConnectionConfig {
  urlTemplate?: string;
  defaultVerb?: string;
}

export interface ProbingPlan {
  methods: ProbingMethod[];
  fallbackMessage?: string;
}

export interface ProbingMethod {
  key: string;
  label: string;
  strategy: string;
  statement?: string;
  description?: string;
  requires?: string[];
  returnsVersion?: boolean;
  returnsCapabilities?: string[];
}

export interface FieldDescriptor {
  name: string;
  type: string;
  label: string;
  description: string;
  required: boolean;
  defaultValue: string;
  options: string[];
  
  // Extended metadata
  placeholder?: string;
  regex?: string;
  helpText?: string;
  semantic?: string;
  advanced?: boolean;
  sensitive?: boolean;
  dependsOn?: string;
  dependsValue?: string;
  minValue?: number;
  maxValue?: number;
  visibleWhen?: VisibleWhen;
}

export interface VisibleWhen {
  field: string;
  values: string[];
}

export interface Dataset {
  id: string;
  name: string;
  description: string;
  kind: string;
  supportsIncremental: boolean;
  cdmModelId: string;
  ingestionStrategy: string;
  incrementalColumn: string;
  incrementalLiteral: string;
  primaryKeys: string[];
  metadata: Record<string, string>;
}

export interface SchemaField {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  description: string;
  precision: number;
  scale: number;
  length: number;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  error?: string;
  latencyMs: number;
  
  // Extended fields
  detectedVersion?: string;
  capabilities?: string[];
  details?: Record<string, string>;
}

export interface BuildConfigResult {
  success: boolean;
  config: Record<string, string>;
  connectionUrl?: string;
  error?: string;
}

export interface ErrorDetail {
  code?: string;
  message?: string;
  retryable?: boolean;
  requiredScopes?: string[];
  resolutionHint?: string;
}

export interface CapabilityProbeResult {
  capabilities: string[];
  constraints?: Record<string, string>;
  auth?: AuthDescriptor;
  supportedOperations?: string[];
  error?: ErrorDetail | null;
}

export type OperationStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "OPERATION_STATUS_UNSPECIFIED";

export interface OperationState {
  operationId: string;
  kind?: string;
  status: OperationStatus;
  startedAt?: number;
  completedAt?: number;
  retryable?: boolean;
  error?: ErrorDetail | null;
  stats?: Record<string, string>;
}

export interface StartOperationResult {
  operationId: string;
  state: OperationState;
}

export interface RunSummary {
  artifactId: string;
  tenantId: string;
  sourceFamily: string;
  sinkEndpointId: string;
  versionHash: string;
  nodesTouched: number;
  edgesTouched: number;
  cacheHits: number;
  logEventsPath: string;
  logSnapshotPath: string;
}

// Lazy-loaded gRPC client
let clientPromise: Promise<any> | null = null;

async function getClient(): Promise<any> {
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const packageDefinition = await protoLoader.load(PROTO_PATH, {
      keepCase: false, // CODEX FIX: Use camelCase to match TypeScript interfaces
      longs: Number, // CODEX FIX: Convert longs to Number for latencyMs
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const grpc = await import("@grpc/grpc-js");
    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
    const ucl = (protoDescriptor as any).ucl.v1;

    const client = new ucl.UCLService(
      UCL_GRPC_ADDRESS,
      grpc.credentials.createInsecure()
    );

    return client;
  })();

  return clientPromise;
}

/**
 * List available endpoint templates, optionally filtered by family
 */
export async function listEndpointTemplates(family?: string): Promise<EndpointTemplate[]> {
  const client = await getClient();

  return new Promise((resolve, reject) => {
    client.ListEndpointTemplates({ family: family ?? "" }, (err: Error | null, response: any) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(response.templates ?? []);
    });
  });
}

/**
 * Build endpoint configuration from a template
 */
export async function buildEndpointConfig(
  templateId: string,
  parameters: Record<string, string>,
  labels?: string[]
): Promise<BuildConfigResult> {
  const client = await getClient();

  return new Promise((resolve, reject) => {
    client.BuildEndpointConfig(
      // Use camelCase keys because proto-loader default keepCase=false
      { templateId, parameters, labels: labels ?? [] },
      (err: Error | null, response: any) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({
          success: response.success,
          config: response.config ?? {},
          // Proto field `connection_url` is exposed as `connectionUrl` because keepCase=false
          connectionUrl: response.connectionUrl ?? response.connection_url,
          error: response.error,
        });
      }
    );
  });
}

/**
 * Test connectivity to an endpoint
 */
export async function testEndpointConnection(
  templateId: string,
  parameters: Record<string, string>
): Promise<ConnectionTestResult> {
  const client = await getClient();

  return new Promise((resolve, reject) => {
    client.TestEndpointConnection(
      // Use camelCase keys because proto-loader default keepCase=false
      { templateId, parameters },
      (err: Error | null, response: any) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({
          success: response.success,
          message: response.message,
          error: response.error,
          latencyMs: response.latencyMs ?? 0,
          detectedVersion: response.detectedVersion,
          capabilities: response.capabilities ?? [],
          details: response.details ?? {},
        });
      }
    );
  });
}

/**
 * List datasets available from an endpoint
 */
export async function listDatasets(
  endpointId: string,
  config: Record<string, string>
): Promise<Dataset[]> {
  const client = await getClient();

  return new Promise((resolve, reject) => {
    client.ListDatasets(
      { endpoint_id: endpointId, config },
      (err: Error | null, response: any) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(response.datasets ?? []);
      }
    );
  });
}

/**
 * Get schema for a dataset
 */
export async function getSchema(
  endpointId: string,
  datasetId: string,
  config: Record<string, string>
): Promise<SchemaField[]> {
  const client = await getClient();

  return new Promise((resolve, reject) => {
    client.GetSchema(
      { endpoint_id: endpointId, dataset_id: datasetId, config },
      (err: Error | null, response: any) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(response.fields ?? []);
      }
    );
  });
}

export async function probeEndpointCapabilities(input: {
  templateId?: string;
  endpointId?: string;
  parameters?: Record<string, string>;
}): Promise<CapabilityProbeResult> {
  const client = await getClient();

  return new Promise((resolve, reject) => {
    client.ProbeEndpointCapabilities(
      {
        templateId: input.templateId ?? "",
        endpointId: input.endpointId ?? "",
        parameters: input.parameters ?? {},
      },
      (err: Error | null, response: any) => {
        if (err) {
          reject(err);
          return;
        }
        const payload = response?.result ?? response ?? {};
        resolve(normalizeCapabilityProbeResult(payload));
      }
    );
  });
}

export async function startOperation(input: {
  templateId?: string;
  endpointId?: string;
  kind?: string;
  parameters?: Record<string, string>;
  idempotencyKey?: string;
}): Promise<StartOperationResult> {
  const client = await getClient();

  return new Promise((resolve, reject) => {
    client.StartOperation(
      {
        templateId: input.templateId ?? "",
        endpointId: input.endpointId ?? "",
        kind: input.kind ?? "METADATA_RUN",
        parameters: input.parameters ?? {},
        idempotencyKey: input.idempotencyKey ?? "",
      },
      (err: Error | null, response: any) => {
        if (err) {
          reject(err);
          return;
        }
        const state = normalizeOperationState(response?.state ?? response);
        resolve({
          operationId: response?.operationId ?? state.operationId,
          state,
        });
      }
    );
  });
}

export async function getOperation(operationId: string): Promise<OperationState> {
  const client = await getClient();

  return new Promise((resolve, reject) => {
    client.GetOperation(
      { operationId },
      (err: Error | null, response: any) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(normalizeOperationState(response));
      }
    );
  });
}

export async function getRunSummary(artifactId: string): Promise<RunSummary> {
  const client = await getClient();
  return new Promise((resolve, reject) => {
    client.GetRunSummary({ artifactId }, (err: Error | null, res: any) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({
        artifactId: res?.artifactId ?? artifactId,
        tenantId: res?.tenantId ?? "",
        sourceFamily: res?.sourceFamily ?? "",
        sinkEndpointId: res?.sinkEndpointId ?? "",
        versionHash: res?.versionHash ?? "",
        nodesTouched: Number(res?.nodesTouched ?? 0),
        edgesTouched: Number(res?.edgesTouched ?? 0),
        cacheHits: Number(res?.cacheHits ?? 0),
        logEventsPath: res?.logEventsPath ?? "",
        logSnapshotPath: res?.logSnapshotPath ?? "",
      });
    });
  });
}

export async function diffRunSummaries(leftArtifactId: string, rightArtifactId: string): Promise<{
  left: RunSummary;
  right: RunSummary;
  versionEqual: boolean;
  notes: string;
  logEventsPath?: string;
}> {
  const client = await getClient();
  return new Promise((resolve, reject) => {
    client.DiffRunSummaries({ leftArtifactId, rightArtifactId }, (err: Error | null, res: any) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({
        left: {
          artifactId: res?.left?.artifactId ?? leftArtifactId,
          tenantId: res?.left?.tenantId ?? "",
          sourceFamily: res?.left?.sourceFamily ?? "",
          sinkEndpointId: res?.left?.sinkEndpointId ?? "",
          versionHash: res?.left?.versionHash ?? "",
          nodesTouched: Number(res?.left?.nodesTouched ?? 0),
          edgesTouched: Number(res?.left?.edgesTouched ?? 0),
          cacheHits: Number(res?.left?.cacheHits ?? 0),
          logEventsPath: res?.left?.logEventsPath ?? "",
          logSnapshotPath: res?.left?.logSnapshotPath ?? "",
        },
        right: {
          artifactId: res?.right?.artifactId ?? rightArtifactId,
          tenantId: res?.right?.tenantId ?? "",
          sourceFamily: res?.right?.sourceFamily ?? "",
          sinkEndpointId: res?.right?.sinkEndpointId ?? "",
          versionHash: res?.right?.versionHash ?? "",
          nodesTouched: Number(res?.right?.nodesTouched ?? 0),
          edgesTouched: Number(res?.right?.edgesTouched ?? 0),
          cacheHits: Number(res?.right?.cacheHits ?? 0),
          logEventsPath: res?.right?.logEventsPath ?? "",
          logSnapshotPath: res?.right?.logSnapshotPath ?? "",
        },
        versionEqual: !!res?.versionEqual,
        notes: res?.notes ?? "",
        logEventsPath: res?.logEventsPath ?? "",
      });
    });
  });
}

function normalizeCapabilityProbeResult(result: any): CapabilityProbeResult {
  return {
    capabilities: Array.isArray(result?.capabilities) ? result.capabilities : [],
    constraints: (result?.constraints as Record<string, string> | undefined) ?? undefined,
    auth: result?.auth,
    supportedOperations: Array.isArray(result?.supportedOperations) ? result.supportedOperations : [],
    error: normalizeErrorDetail(result?.error),
  };
}

function normalizeErrorDetail(error: any): ErrorDetail | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const requiredScopes = Array.isArray(error.requiredScopes) ? error.requiredScopes : undefined;
  return {
    code: typeof error.code === "string" ? error.code : undefined,
    message: typeof error.message === "string" ? error.message : undefined,
    retryable: typeof error.retryable === "boolean" ? error.retryable : undefined,
    requiredScopes,
    resolutionHint: typeof error.resolutionHint === "string" ? error.resolutionHint : undefined,
  };
}

function normalizeOperationState(state: any): OperationState {
  const normalizedError = normalizeErrorDetail(state?.error);
  return {
    operationId: typeof state?.operationId === "string" ? state.operationId : state?.operation_id ?? "",
    kind: typeof state?.kind === "string" ? state.kind : undefined,
    status: coerceOperationStatus(state?.status),
    startedAt: state?.startedAt ?? state?.started_at,
    completedAt: state?.completedAt ?? state?.completed_at,
    retryable: typeof state?.retryable === "boolean" ? state.retryable : undefined,
    error: normalizedError,
    stats: (state?.stats as Record<string, string> | undefined) ?? undefined,
  };
}

function coerceOperationStatus(raw: any): OperationStatus {
  if (typeof raw === "string" && raw.length > 0) {
    const normalized = raw.toUpperCase();
    if (normalized.startsWith("OPERATION_STATUS_")) {
      return normalized as OperationStatus;
    }
    if (["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"].includes(normalized)) {
      return normalized as OperationStatus;
    }
  }
  if (typeof raw === "number") {
    const numericMap: Record<number, OperationStatus> = {
      1: "QUEUED",
      2: "RUNNING",
      3: "SUCCEEDED",
      4: "FAILED",
      5: "CANCELLED",
    };
    if (numericMap[raw]) {
      return numericMap[raw];
    }
  }
  return "OPERATION_STATUS_UNSPECIFIED";
}

/**
 * Check if gRPC server is available
 */
export async function isServerAvailable(): Promise<boolean> {
  try {
    await listEndpointTemplates();
    return true;
  } catch {
    return false;
  }
}
