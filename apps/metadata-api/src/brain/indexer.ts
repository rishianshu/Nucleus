import { getPrismaClient } from "../prismaClient.js";
import { PrismaIndexProfileStore } from "./indexProfileStore.js";
import { PrismaVectorIndexStore, VECTOR_DIMENSION } from "./vectorIndexStore.js";
import type { EmbeddingProvider, IndexProfile, IndexProfileStore, NodeIndexer, VectorIndexStore } from "./types.js";

type PrismaClientInstance = Awaited<ReturnType<typeof getPrismaClient>>;

const DEFAULT_BATCH_SIZE = 25;

export class GraphNodeIndexer implements NodeIndexer {
  private readonly resolvePrisma: () => Promise<PrismaClientInstance>;
  private readonly profileStore: IndexProfileStore;
  private readonly vectorStore: VectorIndexStore;
  private readonly embeddingProvider: EmbeddingProvider;

  constructor(options: {
    embeddingProvider: EmbeddingProvider;
    resolvePrisma?: () => Promise<PrismaClientInstance>;
    profileStore?: IndexProfileStore;
    vectorStore?: VectorIndexStore;
  }) {
    this.embeddingProvider = options.embeddingProvider;
    this.resolvePrisma = options.resolvePrisma ?? getPrismaClient;
    this.profileStore = options.profileStore ?? new PrismaIndexProfileStore(this.resolvePrisma);
    this.vectorStore = options.vectorStore ?? new PrismaVectorIndexStore(this.resolvePrisma);
  }

  async indexNodesForProfile(args: { profileId: string; nodeIds?: string[]; batchSize?: number }): Promise<{ indexed: number }> {
    const profile = await this.profileStore.getProfile(args.profileId);
    if (!profile) {
      throw new Error(`Index profile not found: ${args.profileId}`);
    }
    if (profile.enabled === false) {
      return { indexed: 0 };
    }
    const prisma = await this.resolvePrisma();
    const where: Record<string, unknown> = { entityType: profile.nodeType };
    if (args.nodeIds?.length) {
      where.id = { in: args.nodeIds };
    }
    const nodes = await prisma.graphNode.findMany({ where, orderBy: { updatedAt: "desc" } });
    const batchSize = Math.max(1, args.batchSize ?? DEFAULT_BATCH_SIZE);
    let indexed = 0;

    for (let offset = 0; offset < nodes.length; offset += batchSize) {
      const slice = nodes.slice(offset, offset + batchSize);
      type EmbedEntry = { node: (typeof nodes)[0]; properties: Record<string, unknown>; text: string };
      const toEmbed: EmbedEntry[] = slice
        .map((node: (typeof nodes)[0]) => {
          const properties = toRecord(node.properties);
          const text = extractText(profile, properties);
          if (!text) {
            return null;
          }
          return {
            node,
            properties,
            text,
          };
        })
        .filter((entry: EmbedEntry | null): entry is EmbedEntry => Boolean(entry));
      if (!toEmbed.length) {
        continue;
      }
      const embeddings = await this.embeddingProvider.embedText(profile.embeddingModel, toEmbed.map((e: EmbedEntry) => e.text));
      if (embeddings.length !== toEmbed.length) {
        throw new Error("EmbeddingProvider returned mismatched result count");
      }
      const entries = toEmbed.map((entry: EmbedEntry, idx: number) => {
        const embedding = embeddings[idx];
        if (embedding.length !== VECTOR_DIMENSION) {
          throw new Error(`Embedding dimension ${embedding.length} does not match expected ${VECTOR_DIMENSION}`);
        }
        const projectKey = resolveProjectKey(entry.node, entry.properties);
        return {
          nodeId: entry.node.id,
          profileId: profile.id,
          chunkId: "chunk-0",
          embedding,
          tenantId: entry.node.scopeOrgId ?? entry.node.tenantId,
          projectKey,
          profileKind: profile.profileKind,
          sourceSystem: entry.node.sourceSystem ?? null,
          rawMetadata: buildRawMetadata(entry.node, entry.properties, projectKey, profile),
        };
      });
      await this.vectorStore.upsertEntries(entries);
      indexed += entries.length;
    }

    return { indexed };
  }
}

function extractText(profile: IndexProfile, properties: Record<string, unknown>): string | null {
  const source = profile.textSource ?? {};
  const fromKey = typeof source.from === "string" ? source.from : undefined;
  const base = fromKey && properties[fromKey] && typeof properties[fromKey] === "object" ? (properties[fromKey] as Record<string, unknown>) : properties;
  const path = Array.isArray((source as Record<string, unknown>).path)
    ? ((source as Record<string, unknown>).path as unknown[]).filter((value): value is string => typeof value === "string" && value.length > 0)
    : undefined;
  const field: string | undefined = typeof (source as Record<string, unknown>).field === "string" ? (source as Record<string, unknown>).field as string : undefined;
  if (path && path.length > 0) {
    const value = dig(base, path);
    const text = stringifyValue(value);
    if (text) return text;
  }
  if (field) {
    const direct = dig(base, [field]);
    const text = stringifyValue(direct) ?? deepFindString(base, field);
    if (text) return text;
  }
  return (
    stringifyValue(base["summary"]) ??
    stringifyValue(base["body"]) ??
    stringifyValue(base["text"]) ??
    stringifyValue(base["content"]) ??
    null
  );
}

function resolveProjectKey(node: any, properties: Record<string, unknown>): string | null {
  const candidates = [
    properties["projectKey"],
    properties["project_key"],
    properties["source_project_key"],
    properties["sourceProjectKey"],
    properties["project"],
    properties["projectId"],
    properties["project_id"],
  ];
  const metadata = properties["_metadata"];
  if (metadata && typeof metadata === "object") {
    const meta = metadata as Record<string, unknown>;
    candidates.push(meta["projectKey"], meta["project_key"], meta["source_project_key"]);
  }
  candidates.push(node.scopeProjectId, node.projectId);
  const value = candidates.find((entry) => typeof entry === "string" && entry.trim().length > 0);
  return value ? (value as string).trim() : null;
}

function buildRawMetadata(
  node: any,
  properties: Record<string, unknown>,
  projectKey: string | null,
  profile: IndexProfile,
): Record<string, unknown> {
  return {
    entityType: node.entityType,
    scopeOrgId: node.scopeOrgId,
    scopeProjectId: node.scopeProjectId ?? node.projectId,
    projectKey,
    profileKind: profile.profileKind,
    sourceSystem: node.sourceSystem,
    properties,
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function dig(root: Record<string, unknown>, path: string[]): unknown {
  let cursor: unknown = root;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function stringifyValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const parts = value.map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter((part) => part.length > 0);
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }
  return null;
}

function deepFindString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record[key] === "string" && (record[key] as string).trim().length > 0) {
    return (record[key] as string).trim();
  }
  for (const entry of Object.values(record)) {
    const found = deepFindString(entry, key);
    if (found) return found;
  }
  return null;
}
