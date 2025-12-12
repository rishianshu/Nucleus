import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { TenantContext } from "@metadata/core";
import { BrainSearchService, BrainVectorSearchService, HashingEmbeddingProvider } from "./index.js";
import type { IndexProfile, IndexProfileStore, VectorIndexEntryInput, VectorIndexQueryFilter, VectorIndexStore } from "./types.js";
import { buildOneHotVector } from "./embeddingUtils.js";
import { createResolvers } from "../schema.js";
import { createGraphWriteFixture } from "../graph/graphWriteTestUtils.js";

class InMemoryProfileStore implements IndexProfileStore {
  constructor(private readonly profiles: IndexProfile[]) {}

  async listProfiles(): Promise<IndexProfile[]> {
    return this.profiles;
  }

  async getProfile(id: string): Promise<IndexProfile | null> {
    return this.profiles.find((profile) => profile.id === id) ?? null;
  }
}

class InMemoryVectorIndexStore implements VectorIndexStore {
  private readonly entries: VectorIndexEntryInput[] = [];

  async upsertEntries(entries: VectorIndexEntryInput[]): Promise<void> {
    for (const entry of entries) {
      const existingIdx = this.entries.findIndex(
        (row) => row.nodeId === entry.nodeId && row.profileId === entry.profileId && row.chunkId === entry.chunkId,
      );
      if (existingIdx >= 0) {
        this.entries[existingIdx] = entry;
      } else {
        this.entries.push(entry);
      }
    }
  }

  async query(args: {
    profileId: string;
    queryEmbedding: number[];
    topK: number;
    filter?: VectorIndexQueryFilter;
  }): Promise<Array<{ nodeId: string; score: number; metadata: Record<string, unknown> }>> {
    const filtered = this.entries
      .filter((entry) => entry.profileId === args.profileId)
      .filter((entry) => this.matchesFilter(entry, args.filter));
    const scored = filtered
      .map((entry) => ({ entry, score: this.cosineSimilarity(entry.embedding, args.queryEmbedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, args.topK));
    return scored.map(({ entry, score }) => ({
      nodeId: entry.nodeId,
      score,
      metadata: {
        profileId: entry.profileId,
        profileKind: entry.profileKind,
        projectKey: entry.projectKey ?? null,
        sourceSystem: entry.sourceSystem ?? null,
        tenantId: entry.tenantId,
        raw: entry.rawMetadata ?? null,
      },
    }));
  }

  private matchesFilter(entry: VectorIndexEntryInput, filter?: VectorIndexQueryFilter): boolean {
    if (filter?.tenantId && entry.tenantId !== filter.tenantId) {
      return false;
    }
    if (filter?.projectKeyIn && filter.projectKeyIn.length > 0 && !filter.projectKeyIn.includes(entry.projectKey ?? "")) {
      return false;
    }
    if (filter?.profileKindIn && filter.profileKindIn.length > 0 && !filter.profileKindIn.includes(entry.profileKind)) {
      return false;
    }
    return true;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const length = Math.min(a.length, b.length);
    if (!length) {
      return 0;
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let idx = 0; idx < length; idx += 1) {
      dot += a[idx] * b[idx];
      normA += a[idx] * a[idx];
      normB += b[idx] * b[idx];
    }
    if (normA === 0 || normB === 0) {
      return 0;
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

type BrainSearchFixture = Awaited<ReturnType<typeof setupBrainSearchFixture>>;

async function setupBrainSearchFixture(t: TestContext) {
  const fixture = await createGraphWriteFixture({
    tenant: { tenantId: "tenant-brain-search", projectId: "ENG" } as TenantContext,
  });
  t.after(fixture.cleanup);
  const profiles: IndexProfile[] = [
    {
      id: "cdm.work.summary",
      family: "work",
      nodeType: "cdm.work.item",
      textSource: {},
      embeddingModel: "hash",
      profileKind: "work",
      enabled: true,
    },
    {
      id: "cdm.doc.body",
      family: "doc",
      nodeType: "cdm.doc.item",
      textSource: {},
      embeddingModel: "hash",
      profileKind: "doc",
      enabled: true,
    },
  ];
  const profileStore = new InMemoryProfileStore(profiles);
  const vectorStore = new InMemoryVectorIndexStore();
  const embeddingProvider = new HashingEmbeddingProvider(() => buildOneHotVector(3, 1));
  const vectorSearch = new BrainVectorSearchService({ embeddingProvider, profileStore, vectorStore });
  const brainSearchService = new BrainSearchService({
    graphStore: fixture.graphStore,
    vectorSearch,
  });
  const resolvers = createResolvers(fixture.metadataStore, {
    graphStore: fixture.graphStore,
    brainSearchService,
  });
  const ctx = {
    auth: { tenantId: fixture.tenant.tenantId, projectId: fixture.tenant.projectId, roles: ["viewer"], subject: "user-brain-search" },
    userId: "user-brain-search",
    bypassWrites: false,
  };
  return { ...fixture, profileStore, vectorStore, vectorSearch, brainSearchService, resolvers, ctx };
}

async function seedBrainSearchData(fixture: BrainSearchFixture) {
  const work = await fixture.graphWrite.upsertNode({
    nodeType: "cdm.work.item",
    nodeId: "work-brain-search-1",
    properties: {
      projectKey: fixture.tenant.projectId,
      summary: "Investigate onboarding gaps",
      title: "ENG-100 review onboarding gaps",
      sourceIssueKey: "ENG-100",
      url: "https://example.com/work/eng-100",
    },
  });
  const doc = await fixture.graphWrite.upsertNode({
    nodeType: "cdm.doc.item",
    nodeId: "doc-brain-search-1",
    properties: {
      projectKey: fixture.tenant.projectId,
      title: "Onboarding guide",
      body: "Onboarding guide body content",
      sourceUrl: "https://example.com/docs/onboarding",
    },
  });
  const otherDoc = await fixture.graphWrite.upsertNode({
    nodeType: "cdm.doc.item",
    nodeId: "doc-brain-search-2",
    properties: {
      projectKey: "OPS",
      title: "Ops runbook",
      body: "Operational procedures",
      sourceUrl: "https://example.com/docs/ops",
    },
  });
  const signal = await fixture.graphWrite.upsertNode({
    nodeType: "signal.instance",
    nodeId: "signal-brain-search-1",
    properties: { severity: "WARNING" },
  });
  const cluster = await fixture.graphWrite.upsertNode({
    nodeType: "kg.cluster",
    nodeId: "cluster-brain-search-1",
    properties: {
      tenantId: fixture.tenant.tenantId,
      projectKey: fixture.tenant.projectId,
      clusterKind: "episode",
      seedNodeIds: [doc.nodeId],
      size: 2,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  });
  await fixture.graphWrite.upsertEdge({
    edgeType: "HAS_SIGNAL",
    fromNodeId: doc.nodeId,
    toNodeId: signal.nodeId,
  });
  await fixture.graphWrite.upsertEdge({
    edgeType: "IN_CLUSTER",
    fromNodeId: doc.nodeId,
    toNodeId: cluster.nodeId,
  });
  await fixture.graphWrite.upsertEdge({
    edgeType: "IN_CLUSTER",
    fromNodeId: work.nodeId,
    toNodeId: cluster.nodeId,
  });
  const workEmbedding = buildOneHotVector(3, 1);
  workEmbedding[4] = 0.5;
  await fixture.vectorStore.upsertEntries([
    {
      nodeId: doc.nodeId,
      profileId: "cdm.doc.body",
      chunkId: "chunk-0",
      embedding: buildOneHotVector(3, 1),
      tenantId: fixture.tenant.tenantId,
      projectKey: fixture.tenant.projectId,
      profileKind: "doc",
      sourceSystem: "confluence",
    },
    {
      nodeId: work.nodeId,
      profileId: "cdm.work.summary",
      chunkId: "chunk-0",
      embedding: workEmbedding,
      tenantId: fixture.tenant.tenantId,
      projectKey: fixture.tenant.projectId,
      profileKind: "work",
      sourceSystem: "jira",
    },
    {
      nodeId: otherDoc.nodeId,
      profileId: "cdm.doc.body",
      chunkId: "chunk-0",
      embedding: buildOneHotVector(10, 1),
      tenantId: fixture.tenant.tenantId,
      projectKey: "OPS",
      profileKind: "doc",
      sourceSystem: "confluence",
    },
  ]);
  return { work, doc, otherDoc, signal, cluster };
}

test("brainSearch returns vector hits, expanded graph, and scored episodes", async (t) => {
  const fixture = await setupBrainSearchFixture(t);
  const seeded = await seedBrainSearchData(fixture);
  const result = await (fixture.resolvers.Query as any).brainSearch(
    null,
    {
      queryText: "onboarding context",
      filter: { tenantId: fixture.tenant.tenantId, projectKey: fixture.tenant.projectId, profileKindIn: ["doc", "work"] },
      options: { expandDepth: 1, topK: 5, includeEpisodes: true },
    },
    fixture.ctx as any,
  );

  assert.ok(result.hits.length >= 2, "expected vector hits");
  assert.equal(result.hits[0]?.nodeId, seeded.doc.nodeId);
  assert.ok(result.hits.every((hit: any, idx: number) => idx === 0 || result.hits[idx - 1].score >= hit.score));
  assert.ok(result.hits.every((hit: any) => hit.profileId && hit.profileKind));
  assert.ok(result.hits.every((hit: any) => hit.nodeId !== seeded.otherDoc.nodeId));

  const graphNodeIds = new Set(result.graphNodes.map((node: any) => node.nodeId));
  assert.ok(graphNodeIds.has(seeded.doc.nodeId));
  assert.ok(graphNodeIds.has(seeded.signal.nodeId) || graphNodeIds.has(seeded.cluster.nodeId));
  const edgeTypes = new Set(result.graphEdges.map((edge: any) => edge.edgeType));
  assert.ok(edgeTypes.has("HAS_SIGNAL") || edgeTypes.has("IN_CLUSTER"));

  const clusterEpisode = result.episodes.find((episode: any) => episode.clusterNodeId === seeded.cluster.nodeId);
  assert.ok(clusterEpisode, "expected episode for cluster");
  assert.ok(clusterEpisode.memberNodeIds.includes(seeded.doc.nodeId));
  assert.ok(clusterEpisode.memberNodeIds.includes(seeded.work.nodeId));
  const docHitScore = result.hits.find((hit: any) => hit.nodeId === seeded.doc.nodeId)?.score ?? 0;
  const workHitScore = result.hits.find((hit: any) => hit.nodeId === seeded.work.nodeId)?.score ?? 0;
  assert.equal(clusterEpisode.score, docHitScore + workHitScore);
});

test("brainSearch promptPack is deterministic and cites hits", async (t) => {
  const fixture = await setupBrainSearchFixture(t);
  const seeded = await seedBrainSearchData(fixture);
  const args = {
    queryText: "deterministic brain search",
    filter: { tenantId: fixture.tenant.tenantId, projectKey: fixture.tenant.projectId },
    options: { expandDepth: 1, topK: 5 },
  };
  const first = await (fixture.resolvers.Query as any).brainSearch(null, args, fixture.ctx as any);
  const second = await (fixture.resolvers.Query as any).brainSearch(null, args, fixture.ctx as any);

  assert.equal(first.promptPack.contextMarkdown, second.promptPack.contextMarkdown);
  const citations = (first.promptPack.citations ?? []) as Array<Record<string, unknown>>;
  const citationIds = citations.map((entry) => entry.sourceNodeId);
  assert.ok(citationIds.includes(seeded.doc.nodeId));
  assert.ok(citationIds.includes(seeded.work.nodeId));
  assert.ok(citations.every((entry) => Boolean((entry as any).url)), "citations should include urls when available");
  assert.ok(citations.every((entry) => Boolean((entry as any).title)), "citations should include titles when available");
});
