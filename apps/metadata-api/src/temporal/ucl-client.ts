/**
 * UCL gRPC Client - TypeScript wrapper for UCL gRPC service
 * 
 * This replaces the Python CLI (runRegistryCommand) with gRPC calls.
 * The gRPC server runs on platform/ucl-core/cmd/server at :50051
 */

import { credentials, ChannelCredentials } from "@grpc/grpc-js";
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
