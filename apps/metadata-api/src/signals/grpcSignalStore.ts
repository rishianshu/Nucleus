/**
 * gRPC Bridge for Signal Service
 * Calls Go store-core SignalService via gRPC
 */
import { credentials, type ServiceError } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import { loadPackageDefinition } from "@grpc/grpc-js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Signal types (moved from deleted signals/types.ts)
export type SignalStatus = "ACTIVE" | "DISABLED" | "DRAFT";
export type SignalInstanceStatus = "OPEN" | "RESOLVED" | "SUPPRESSED";
export type SignalSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";
export type SignalImplMode = "DSL" | "CODE";

export type SignalDefinition = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  status: SignalStatus;
  implMode: SignalImplMode;
  sourceFamily?: string | null;
  entityKind?: string | null;
  severity: SignalSeverity;
  tags: string[];
  definitionSpec: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type SignalInstance = {
  id: string;
  definitionId: string;
  status: SignalInstanceStatus;
  entityRef: string;
  entityKind: string;
  severity: SignalSeverity;
  summary: string;
  details?: Record<string, unknown> | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt?: Date | null;
  sourceRunId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  definition?: SignalDefinition;
};

export type SignalDefinitionFilter = {
  status?: SignalStatus[];
  entityKind?: string[];
  sourceFamily?: string[];
};

export type SignalInstanceFilter = {
  definitionIds?: string[];
  entityRefs?: string[];
  status?: SignalInstanceStatus[];
  severity?: SignalSeverity[];
};

export interface SignalStore {
  getDefinition(id: string): Promise<SignalDefinition | null>;
  listDefinitions(filter?: SignalDefinitionFilter): Promise<SignalDefinition[]>;
  getInstance(id: string): Promise<SignalInstance | null>;
  listInstances(filter?: SignalInstanceFilter): Promise<SignalInstance[]>;
  upsertInstance(input: Partial<SignalInstance>): Promise<SignalInstance>;
  updateInstanceStatus(definitionId: string, entityRef: string, status: SignalInstanceStatus): Promise<SignalInstance>;
}

// gRPC client
let grpcClient: any = null;

function getProtoPath(): string {
  // Try multiple paths for proto file
  const candidates = [
    path.join(__dirname, "../../../../platform/store-core/proto/signal.proto"),
    path.join(__dirname, "../../../../../platform/store-core/proto/signal.proto"),
    path.join(__dirname, "../../../platform/store-core/proto/signal.proto"),
    // CWD-based paths (more reliable in ESM)
    path.join(process.cwd(), "../../platform/store-core/proto/signal.proto"),
    // Absolute path fallback for development
    "/Users/rishikeshkumar/Development/Nucleus/platform/store-core/proto/signal.proto",
    process.env.SIGNAL_PROTO_PATH || "",
  ].filter(Boolean);
  
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  throw new Error(`Could not find signal.proto. Tried: ${candidates.join(', ')}`);
}

function getGrpcClient(): any {
  if (grpcClient) return grpcClient;
  
  const protoPath = getProtoPath();
  const packageDefinition = loadSync(protoPath, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  
  const proto = loadPackageDefinition(packageDefinition);
  const addr = process.env.SIGNAL_GRPC_ADDR || "localhost:9099";
  
  grpcClient = new (proto as any).signal.SignalService(
    addr,
    credentials.createInsecure()
  );
  
  return grpcClient;
}

function promisify<T>(fn: (callback: (err: ServiceError | null, response: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, response) => {
      if (err) reject(err);
      else resolve(response);
    });
  });
}

// gRPC SignalStore implementation
export class GrpcSignalStore implements SignalStore {
  private _client: any = null;
  
  private get client(): any {
    if (!this._client) {
      this._client = getGrpcClient();
    }
    return this._client;
  }

  async getDefinition(id: string): Promise<SignalDefinition | null> {
    // Not directly supported, use list with filter
    const defs = await this.listDefinitions();
    return defs.find(d => d.id === id) || null;
  }

  async listDefinitions(filter?: SignalDefinitionFilter): Promise<SignalDefinition[]> {
    const response = await promisify<any>(cb => 
      this.client.listDefinitions({ sourceFamily: filter?.sourceFamily?.[0] || "" }, cb)
    );
    return (response.definitions || []).map(mapDefinition);
  }

  async getInstance(id: string): Promise<SignalInstance | null> {
    const instances = await this.listInstances({ definitionIds: [id] });
    return instances[0] || null;
  }

  async listInstances(filter?: SignalInstanceFilter): Promise<SignalInstance[]> {
    if (!filter?.definitionIds?.length) return [];
    const response = await promisify<any>(cb =>
      this.client.listInstancesForDefinition({ definitionId: filter.definitionIds![0] }, cb)
    );
    return (response.instances || []).map(mapInstance);
  }

  async upsertInstance(input: Partial<SignalInstance>): Promise<SignalInstance> {
    const response = await promisify<any>(cb =>
      this.client.upsertInstance({ instance: input }, cb)
    );
    return mapInstance(response.instance || input);
  }

  async updateInstanceStatus(definitionId: string, entityRef: string, status: SignalInstanceStatus): Promise<SignalInstance> {
    await promisify<any>(cb =>
      this.client.updateInstanceStatus({ definitionId, entityRef, status }, cb)
    );
    return { definitionId, entityRef, status } as any;
  }
}

function mapDefinition(d: any): SignalDefinition {
  return {
    id: d.id,
    slug: d.slug,
    title: d.title,
    description: d.description || null,
    status: d.status as SignalStatus,
    implMode: (d.implMode || "CODE") as SignalImplMode,
    sourceFamily: d.sourceFamily || null,
    entityKind: d.entityKind || null,
    severity: (d.severity || "INFO") as SignalSeverity,
    tags: d.tags || [],
    definitionSpec: d.definitionSpec || {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function mapInstance(i: any): SignalInstance {
  return {
    id: i.id || "",
    definitionId: i.definitionId,
    status: (i.status || "OPEN") as SignalInstanceStatus,
    entityRef: i.entityRef,
    entityKind: i.entityKind || "",
    severity: (i.severity || "INFO") as SignalSeverity,
    summary: i.summary || "",
    details: i.details || null,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    resolvedAt: null,
    sourceRunId: i.sourceRunId || null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Export singleton
export const grpcSignalStore = new GrpcSignalStore();
