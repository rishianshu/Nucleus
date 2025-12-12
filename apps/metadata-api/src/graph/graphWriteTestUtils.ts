import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { createGraphStore, FileMetadataStore, type GraphStore, type TenantContext } from "@metadata/core";
import {
  DEFAULT_EDGE_TYPE_SEEDS,
  DEFAULT_NODE_TYPE_SEEDS,
  GraphWriteService,
  InMemoryKgRegistry,
  type KgEdgeTypeRecord,
  type KgNodeTypeRecord,
} from "./graphWrite.js";

export type GraphWriteFixture = {
  graphWrite: GraphWriteService;
  graphStore: GraphStore;
  registry: InMemoryKgRegistry;
  tenant: TenantContext;
  cleanup: () => Promise<void>;
};

export async function createGraphWriteFixture(options?: {
  nodeTypes?: KgNodeTypeRecord[];
  edgeTypes?: KgEdgeTypeRecord[];
  tenant?: TenantContext;
}): Promise<GraphWriteFixture> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "graphwrite-"));
  const metadataStore = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore });
  const registry = new InMemoryKgRegistry({
    nodeTypes: DEFAULT_NODE_TYPE_SEEDS,
    edgeTypes: DEFAULT_EDGE_TYPE_SEEDS,
  });
  options?.nodeTypes?.forEach((entry) => registry.addNodeType(entry));
  options?.edgeTypes?.forEach((entry) => registry.addEdgeType(entry));
  const tenant: TenantContext = options?.tenant ?? { tenantId: "test-tenant", projectId: "test-project" };
  const graphWrite = new GraphWriteService({ graphStore, registry, tenant });
  const cleanup = async () => {
    await rm(rootDir, { recursive: true, force: true });
  };
  return { graphWrite, graphStore, registry, tenant, cleanup };
}
