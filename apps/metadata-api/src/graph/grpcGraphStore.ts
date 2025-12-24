import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import type {
  GraphStore,
  GraphStoreCapabilities,
  GraphEntity,
  GraphEdge,
  GraphEntityInput,
  GraphEdgeInput,
  GraphEntityFilter,
  GraphEdgeFilter,
  GraphEmbedding,
  GraphEmbeddingInput,
  TenantContext,
} from "@metadata/core";

type KgNode = { id: string; type: string; properties?: Record<string, string> };
type KgEdge = { id: string; type: string; from_id: string; to_id: string; properties?: Record<string, string> };

export class GrpcGraphStore implements GraphStore {
  private readonly client: any;

  constructor(address = process.env.KG_GRPC_ADDR ?? "localhost:50051") {
    const pkgDef = protoLoader.loadSync("platform/ucl-core/proto/kg.proto", {
      enums: String,
      longs: String,
      defaults: true,
      arrays: true,
      keepCase: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const proto = grpc.loadPackageDefinition(pkgDef) as any;
    const svc = proto.kg?.KgService;
    if (!svc) throw new Error("KgService not found in proto");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    this.client = new svc(address, grpc.credentials.createInsecure());
  }

  async capabilities(): Promise<GraphStoreCapabilities> {
    return { vectorSearch: false, pathQueries: false, annotations: false };
  }

  async upsertEntity(input: GraphEntityInput, context: TenantContext): Promise<GraphEntity> {
    const req = {
      tenant_id: context.tenantId,
      project_id: context.projectId,
      node: { id: input.id, type: input.entityType, properties: stringifyProps(input.properties) },
    };
    const res: any = await this.call("UpsertNode", req);
    return this.toEntity(res?.node, context);
  }

  async getEntity(id: string, context: TenantContext): Promise<GraphEntity | null> {
    const req = { tenant_id: context.tenantId, project_id: context.projectId, node_id: id };
    const res: any = await this.call("GetNode", req);
    return res?.node ? this.toEntity(res.node, context) : null;
  }

  async listEntities(filter: GraphEntityFilter | undefined, context: TenantContext): Promise<GraphEntity[]> {
    const req = {
      tenant_id: context.tenantId,
      project_id: context.projectId,
      entity_types: filter?.entityTypes ?? [],
      limit: filter?.limit ?? 100,
    };
    const res: any = await this.call("ListEntities", req);
    return Array.isArray(res?.nodes) ? res.nodes.map((n: any) => this.toEntity(n, context)) : [];
  }

  async upsertEdge(input: GraphEdgeInput, context: TenantContext): Promise<GraphEdge> {
    const req = {
      tenant_id: context.tenantId,
      project_id: context.projectId,
      edge: {
        id: input.id ?? `${input.sourceEntityId}->${input.edgeType}->${input.targetEntityId}`,
        type: input.edgeType,
        from_id: input.sourceEntityId,
        to_id: input.targetEntityId,
        properties: stringifyProps(input.metadata),
      },
    };
    const res: any = await this.call("UpsertEdge", req);
    return this.toEdge(res?.edge, context, input);
  }

  async listEdges(filter: GraphEdgeFilter | undefined, context: TenantContext): Promise<GraphEdge[]> {
    const req = {
      tenant_id: context.tenantId,
      project_id: context.projectId,
      edge_types: filter?.edgeTypes ?? [],
      source_id: filter?.sourceEntityId ?? "",
      target_id: filter?.targetEntityId ?? "",
      limit: filter?.limit ?? 100,
    };
    const res: any = await this.call("ListEdges", req);
    return Array.isArray(res?.edges) ? res.edges.map((e: any) => this.toEdge(e, context)) : [];
  }

  async putEmbedding(_input: GraphEmbeddingInput, _context: TenantContext): Promise<GraphEmbedding> {
    throw new Error("putEmbedding not supported in gRPC KG stub");
  }

  async searchEmbeddings(): Promise<GraphEmbedding[]> {
    return [];
  }

  private toEntity(node: KgNode, context: TenantContext): GraphEntity {
    const now = new Date().toISOString();
    return {
      id: node.id,
      entityType: node.type,
      displayName: node.properties?.displayName ?? node.id,
      canonicalPath: node.properties?.canonicalPath,
      tenantId: context.tenantId,
      projectId: context.projectId ?? null,
      properties: node.properties ?? {},
      scope: { orgId: context.tenantId, projectId: context.projectId ?? null },
      identity: {
        logicalKey: node.id,
        originEndpointId: null,
        originVendor: null,
      },
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  private toEdge(edge: KgEdge, context: TenantContext, input?: GraphEdgeInput): GraphEdge {
    const now = new Date().toISOString();
    return {
      id: edge.id,
      edgeType: edge.type,
      sourceEntityId: edge.from_id,
      targetEntityId: edge.to_id,
      confidence: input?.confidence ?? undefined,
      metadata: edge.properties ?? {},
      tenantId: context.tenantId,
      projectId: context.projectId ?? null,
      scope: { orgId: context.tenantId, projectId: context.projectId ?? null },
      identity: {
        logicalKey: edge.id,
        sourceLogicalKey: edge.from_id,
        targetLogicalKey: edge.to_id,
        originEndpointId: null,
        originVendor: null,
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  private async call(method: string, payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.client[method](payload, (err: Error | null, res: any) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
  }
}

function stringifyProps(props?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!props) return out;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string") out[k] = v;
    else out[k] = JSON.stringify(v);
  }
  return out;
}
