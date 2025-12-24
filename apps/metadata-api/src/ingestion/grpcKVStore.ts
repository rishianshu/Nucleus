/**
 * gRPC KV Store Client
 * 
 * Implements KeyValueStore interface using store-core gRPC service (store.kv.v1.KVService).
 * This enables checkpoint persistence via PostgreSQL-backed KV store instead of file-based store.
 */
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Default tenant/project for checkpoint operations (scoped per endpoint/unit)
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID ?? "default";
const DEFAULT_PROJECT_ID = process.env.DEFAULT_PROJECT_ID ?? "default";

// gRPC address for store-core service
const KV_GRPC_ADDR = process.env.KV_GRPC_ADDR ?? process.env.STORE_GRPC_ADDR ?? "localhost:9099";

// Get the directory of this file (ESM compatible)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findProtoPath(): string {
  // First check env var
  if (process.env.KV_PROTO_PATH && fs.existsSync(process.env.KV_PROTO_PATH)) {
    return process.env.KV_PROTO_PATH;
  }
  
  // Common possible locations for the proto file
  const candidates = [
    // Absolute path (most reliable)
    "/Users/rishikeshkumar/Development/Nucleus/platform/store-core/proto/kv.proto",
    // From __dirname (apps/metadata-api/src/ingestion -> Nucleus root)
    path.resolve(__dirname, "../../../../platform/store-core/proto/kv.proto"),
    // From process.cwd (could be Nucleus or apps/metadata-api)
    path.resolve(process.cwd(), "platform/store-core/proto/kv.proto"),
    path.resolve(process.cwd(), "../../platform/store-core/proto/kv.proto"),
    // From this file's location in compiled output
    path.resolve(__dirname, "../../../platform/store-core/proto/kv.proto"),
  ];
  
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      console.log(`[grpc-kv] Found proto file at: ${candidate}`);
      return candidate;
    }
  }
  
  console.error(`[grpc-kv] Proto file not found in any location. Candidates tried: ${candidates.join(", ")}`);
  return candidates[0]; // Return first candidate as default (will fail with better error)
}

const PROTO_PATH = findProtoPath();

export interface KVRecord<T = unknown> {
  value: T | null;
  version: string | null;
}

export interface GrpcKVStoreOptions {
  address?: string;
  tenantId?: string;
  projectId?: string;
}

/**
 * GrpcKVStore - KeyValue store backed by store-core gRPC service
 */
export class GrpcKVStore {
  private client: any;
  private tenantId: string;
  private projectId: string;
  private connected: boolean = false;

  constructor(options: GrpcKVStoreOptions = {}) {
    this.tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
    this.projectId = options.projectId ?? DEFAULT_PROJECT_ID;
    const address = options.address ?? KV_GRPC_ADDR;
    
    try {
      const pkgDef = protoLoader.loadSync(PROTO_PATH, {
        enums: String,
        longs: String,
        defaults: true,
        arrays: true,
        keepCase: true,
      });
      const proto = grpc.loadPackageDefinition(pkgDef) as any;
      const svc = proto.store?.kv?.v1?.KVService;
      if (!svc) {
        throw new Error("KVService not found in proto definition");
      }
      this.client = new svc(address, grpc.credentials.createInsecure());
      this.connected = true;
      console.log(`[grpc-kv] Connected to KV service at ${address}`);
    } catch (err) {
      console.error(`[grpc-kv] Failed to connect to KV service at ${address}:`, err);
      this.connected = false;
    }
  }

  /**
   * Get a value by key
   */
  async get<T>(key: string): Promise<KVRecord<T>> {
    if (!this.connected || !this.client) {
      console.warn("[grpc-kv] Not connected, returning null");
      return { value: null, version: null };
    }

    const request = {
      key: {
        tenant_id: this.tenantId,
        project_id: this.projectId,
        key: key,
      },
    };

    try {
      const response = await this.call<{ value: Buffer; version: number; content_type: string }>("Get", request);
      if (!response || !response.value || response.value.length === 0) {
        return { value: null, version: null };
      }
      const valueStr = response.value.toString("utf-8");
      const parsed = JSON.parse(valueStr) as T;
      return {
        value: parsed,
        version: String(response.version ?? 0),
      };
    } catch (err: any) {
      // NotFound is expected - return null
      if (err?.code === 5 || err?.message?.includes("not found")) {
        return { value: null, version: null };
      }
      console.error(`[grpc-kv] Get error for key ${key}:`, err);
      return { value: null, version: null };
    }
  }

  /**
   * Put a value by key
   */
  async put<T>(key: string, value: T, _options?: { expectedVersion?: string | null }): Promise<string> {
    if (!this.connected || !this.client) {
      throw new Error("[grpc-kv] Not connected to KV service");
    }

    const valueJson = JSON.stringify(value);
    const request = {
      key: {
        tenant_id: this.tenantId,
        project_id: this.projectId,
        key: key,
      },
      value: Buffer.from(valueJson, "utf-8"),
      content_type: "application/json",
    };

    try {
      const response = await this.call<{ version: number }>("Put", request);
      return String(response?.version ?? 1);
    } catch (err) {
      console.error(`[grpc-kv] Put error for key ${key}:`, err);
      throw err;
    }
  }

  /**
   * Delete a key
   */
  async delete(key: string): Promise<void> {
    if (!this.connected || !this.client) {
      return; // Silently ignore if not connected
    }

    const request = {
      key: {
        tenant_id: this.tenantId,
        project_id: this.projectId,
        key: key,
      },
    };

    try {
      await this.call("Delete", request);
    } catch (err: any) {
      // NotFound is acceptable for delete
      if (err?.code === 5 || err?.message?.includes("not found")) {
        return;
      }
      console.error(`[grpc-kv] Delete error for key ${key}:`, err);
    }
  }

  /**
   * List keys by prefix
   */
  async list(prefix: string, limit = 100): Promise<string[]> {
    if (!this.connected || !this.client) {
      return [];
    }

    const request = {
      tenant_id: this.tenantId,
      project_id: this.projectId,
      prefix: prefix,
      limit: limit,
    };

    try {
      const response = await this.call<{ entries: Array<{ key: string; version: number }> }>("List", request);
      return response?.entries?.map((e) => e.key) ?? [];
    } catch (err) {
      console.error(`[grpc-kv] List error for prefix ${prefix}:`, err);
      return [];
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Generic gRPC call helper
   */
  private call<T>(method: string, payload: any): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.client[method]) {
        reject(new Error(`Method ${method} not available`));
        return;
      }
      this.client[method](payload, (err: Error | null, res: T) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
  }
}

// Singleton instance
let grpcKVStoreInstance: GrpcKVStore | null = null;

/**
 * Get or create the gRPC KV store singleton
 */
export function getGrpcKVStore(options?: GrpcKVStoreOptions): GrpcKVStore {
  if (!grpcKVStoreInstance) {
    grpcKVStoreInstance = new GrpcKVStore(options);
  }
  return grpcKVStoreInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function __resetGrpcKVStoreForTests(): void {
  grpcKVStoreInstance = null;
}
