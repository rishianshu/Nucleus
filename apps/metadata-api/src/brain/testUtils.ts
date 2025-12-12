import { randomUUID } from "node:crypto";
import { getPrismaClient } from "../prismaClient.js";
import type { EmbeddingProvider } from "./types.js";
import { buildOneHotVector, hashTextToVector } from "./embeddingUtils.js";
import { VECTOR_DIMENSION } from "./vectorIndexStore.js";

export const prismaPromise = getPrismaClient();

export async function clearVectorIndex(): Promise<void> {
  const prisma = await prismaPromise;
  await prisma.vectorIndexEntry.deleteMany();
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly resolver: (text: string) => number[]) {}

  async embedText(_model: string, texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.resolver(text));
  }
}

export { buildOneHotVector, hashTextToVector };

export function buildDenseVector(seed: number): number[] {
  return Array.from({ length: VECTOR_DIMENSION }, (_, idx) => Number(((seed + idx % 5) / (VECTOR_DIMENSION + idx + 1)).toFixed(6)));
}

export async function createGraphNode(prisma: any, options: {
  id?: string;
  entityType: string;
  displayName?: string;
  canonicalPath?: string;
  sourceSystem?: string | null;
  properties?: Record<string, unknown>;
  scopeOrgId?: string;
  scopeProjectId?: string | null;
  projectId?: string | null;
  logicalKey?: string;
  originVendor?: string | null;
}): Promise<any> {
  const id = options.id ?? randomUUID();
  const logicalKey = options.logicalKey ?? id;
  const tenantId = options.scopeOrgId ?? "tenant-acme";
  const projectId = options.scopeProjectId ?? options.projectId ?? "project-alpha";
  return prisma.graphNode.create({
    data: {
      id,
      tenantId,
      projectId,
      entityType: options.entityType,
      displayName: options.displayName ?? id,
      canonicalPath: options.canonicalPath ?? id,
      sourceSystem: options.sourceSystem ?? null,
      specRef: null,
      properties: options.properties ?? {},
      version: 1,
      scopeOrgId: tenantId,
      scopeProjectId: projectId,
      scopeDomainId: null,
      scopeTeamId: null,
      originEndpointId: null,
      originVendor: options.originVendor ?? options.sourceSystem ?? null,
      logicalKey,
      externalId: null,
      phase: null,
      provenance: null,
    },
  });
}
