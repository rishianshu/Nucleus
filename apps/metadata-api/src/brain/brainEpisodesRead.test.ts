import { strict as assert } from "node:assert";
import test from "node:test";
import type { TenantContext } from "@metadata/core";
import { ClusterBuilderService, ClusterReadService } from "./clusters.js";
import type { BrainVectorSearch } from "./types.js";
import { createGraphWriteFixture } from "../graph/graphWriteTestUtils.js";
import { GraphWriteService } from "../graph/graphWrite.js";
import { createResolvers } from "../schema.js";
import type {
  SignalDefinition,
  SignalDefinitionFilter,
  SignalInstance,
  SignalInstanceFilter,
  SignalInstancePage,
  SignalInstanceStatus,
  SignalSeverity,
  SignalStore,
  UpsertSignalInstanceInput,
} from "../signals/types.js";

class FakeVectorSearch implements BrainVectorSearch {
  constructor(private readonly neighborIds: string[]) {}

  async search(args: {
    profileId: string;
    queryText: string;
    topK: number;
    tenantId: string;
    projectKeyIn?: string[];
    profileKindIn?: string[];
  }): Promise<Array<{ nodeId: string; score: number; profileId: string }>> {
    return this.neighborIds.slice(0, args.topK).map((nodeId, idx) => ({
      nodeId,
      score: 0.95 - idx * 0.05,
      profileId: args.profileId,
    }));
  }
}

class FakeSignalStore implements SignalStore {
  private readonly definitions = new Map<string, SignalDefinition>();
  private readonly instances = new Map<string, SignalInstance>();

  constructor(seed?: { definitions?: SignalDefinition[]; instances?: SignalInstance[] }) {
    seed?.definitions?.forEach((def) => this.definitions.set(def.id, def));
    seed?.instances?.forEach((instance) => this.instances.set(instance.id, instance));
  }

  async getDefinition(id: string): Promise<SignalDefinition | null> {
    return this.definitions.get(id) ?? null;
  }

  async getDefinitionBySlug(slug: string): Promise<SignalDefinition | null> {
    return Array.from(this.definitions.values()).find((entry) => entry.slug === slug) ?? null;
  }

  async listDefinitions(_filter?: SignalDefinitionFilter | undefined): Promise<SignalDefinition[]> {
    return Array.from(this.definitions.values());
  }

  async createDefinition(input: any): Promise<SignalDefinition> {
    const definition: SignalDefinition = {
      id: input.id ?? `def-${this.definitions.size + 1}`,
      slug: input.slug ?? input.id ?? `def-${this.definitions.size + 1}`,
      title: input.title ?? "Untitled",
      description: input.description ?? null,
      status: input.status ?? "ACTIVE",
      implMode: input.implMode ?? "DSL",
      sourceFamily: input.sourceFamily ?? null,
      entityKind: input.entityKind ?? null,
      processKind: input.processKind ?? null,
      policyKind: input.policyKind ?? null,
      severity: input.severity ?? "INFO",
      tags: input.tags ?? [],
      cdmModelId: input.cdmModelId ?? null,
      surfaceHints: input.surfaceHints ?? null,
      owner: input.owner ?? null,
      definitionSpec: input.definitionSpec ?? {},
      createdAt: input.createdAt ?? new Date(),
      updatedAt: input.updatedAt ?? new Date(),
    };
    this.definitions.set(definition.id, definition);
    return definition;
  }

  async updateDefinition(id: string, patch: any): Promise<SignalDefinition> {
    const existing = this.definitions.get(id);
    if (!existing) {
      throw new Error("definition not found");
    }
    const updated: SignalDefinition = { ...existing, ...patch, updatedAt: patch.updatedAt ?? new Date() };
    this.definitions.set(id, updated);
    return updated;
  }

  async getInstance(id: string): Promise<SignalInstance | null> {
    return this.instances.get(id) ?? null;
  }

  async listInstances(filter?: SignalInstanceFilter | null): Promise<SignalInstance[]> {
    let values = Array.from(this.instances.values());
    if (filter?.entityRef) {
      values = values.filter((entry) => entry.entityRef === filter.entityRef);
    }
    if (filter?.entityRefs && filter.entityRefs.length > 0) {
      values = values.filter((entry) => filter.entityRefs?.includes(entry.entityRef));
    }
    if (filter?.definitionIds && filter.definitionIds.length > 0) {
      values = values.filter((entry) => filter.definitionIds?.includes(entry.definitionId));
    }
    return values;
  }

  async listInstancesPaged(filter?: SignalInstanceFilter | null): Promise<SignalInstancePage> {
    const rows = await this.listInstances(filter);
    return { rows, cursorOffset: 0, hasNextPage: false };
  }

  async upsertInstance(input: UpsertSignalInstanceInput): Promise<SignalInstance> {
    const id = `instance-${this.instances.size + 1}`;
    const instance: SignalInstance = {
      id,
      definitionId: input.definitionId,
      status: input.status ?? ("OPEN" as SignalInstanceStatus),
      entityRef: input.entityRef,
      entityKind: input.entityKind,
      severity: input.severity as SignalSeverity,
      summary: input.summary,
      details: input.details ?? null,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      resolvedAt: input.resolvedAt ? new Date(input.resolvedAt) : null,
      sourceRunId: input.sourceRunId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.instances.set(id, instance);
    return instance;
  }

  async updateInstanceStatus(id: string, status: SignalInstanceStatus): Promise<SignalInstance> {
    const existing = this.instances.get(id);
    if (!existing) {
      throw new Error("instance not found");
    }
    const updated: SignalInstance = { ...existing, status, updatedAt: new Date() };
    this.instances.set(id, updated);
    return updated;
  }
}

function buildResolverContext(tenant: TenantContext) {
  return {
    auth: {
      tenantId: tenant.tenantId,
      projectId: tenant.projectId,
      roles: ["viewer", "editor"],
      subject: "user-brain",
    },
    userId: "user-brain",
    bypassWrites: false,
  };
}

test("brainEpisodes lists clusters for a tenant/project and reflects KG membership", async (t) => {
  const { graphWrite, graphStore, metadataStore, tenant, cleanup } = await createGraphWriteFixture({
    tenant: { tenantId: "tenant-episodes", projectId: "OPS" },
  });
  t.after(cleanup);
  const work = await graphWrite.upsertNode({
    nodeType: "cdm.work.item",
    nodeId: "work-episodes-1",
    properties: { projectKey: tenant.projectId, summary: "Investigate outage", sourceIssueKey: "OPS-101" },
  });
  const doc = await graphWrite.upsertNode({
    nodeType: "cdm.doc.item",
    nodeId: "doc-episodes-1",
    properties: { projectKey: tenant.projectId, title: "Outage doc", sourceUrl: "https://example.com/doc" },
  });
  const builder = new ClusterBuilderService({
    graphWrite,
    graphStore,
    vectorSearch: new FakeVectorSearch([doc.nodeId, work.nodeId]),
    scoreThreshold: 0,
    now: () => new Date("2024-05-01T00:00:00Z"),
  });
  await builder.buildClustersForProject({ tenantId: tenant.tenantId, projectKey: tenant.projectId });

  const signalStore = new FakeSignalStore();
  const resolvers = createResolvers(metadataStore, {
    graphStore,
    signalStore,
    clusterRead: new ClusterReadService(graphStore),
  });
  const ctx = buildResolverContext(tenant);
  const result = await (resolvers.Query.brainEpisodes as any)(
    null,
    { tenantId: tenant.tenantId, projectKey: tenant.projectId, limit: 10, offset: 0 },
    ctx as any,
  );

  assert.equal(result.totalCount, 1);
  assert.equal(result.nodes.length, 1);
  const episode = result.nodes[0];
  assert.equal(episode.tenantId, tenant.tenantId);
  assert.equal(episode.projectKey, tenant.projectId);
  const memberIds = episode.members.map((member: any) => member.nodeId).sort();
  assert.deepEqual(memberIds, [doc.nodeId, work.nodeId].sort());
  const edges = await graphStore.listEdges(
    { edgeTypes: ["IN_CLUSTER"], targetEntityId: episode.id },
    { tenantId: tenant.tenantId, projectId: tenant.projectId },
  );
  const edgeMembers = edges.map((edge) => edge.sourceEntityId).sort();
  assert.deepEqual(edgeMembers, memberIds);
});

test("brainEpisode hydrates members and signals", async (t) => {
  const { graphWrite, graphStore, metadataStore, tenant, cleanup } = await createGraphWriteFixture({
    tenant: { tenantId: "tenant-detail", projectId: "BRAIN" },
  });
  t.after(cleanup);
  const work = await graphWrite.upsertNode({
    nodeType: "cdm.work.item",
    nodeId: "work-detail-1",
    properties: { projectKey: tenant.projectId, summary: "Fix flaky test", sourceIssueKey: "BRAIN-7" },
  });
  const doc = await graphWrite.upsertNode({
    nodeType: "cdm.doc.item",
    nodeId: "doc-detail-1",
    properties: { projectKey: tenant.projectId, title: "Flaky test doc", sourceUrl: "https://example.com/flaky" },
  });
  const definition: SignalDefinition = {
    id: "sig-def-detail",
    slug: "stale-work",
    title: "Stale work item",
    description: null,
    status: "ACTIVE",
    implMode: "DSL",
    sourceFamily: null,
    entityKind: null,
    processKind: null,
    policyKind: null,
    severity: "WARNING",
    tags: [],
    cdmModelId: null,
    surfaceHints: null,
    owner: null,
    definitionSpec: {},
    createdAt: new Date("2024-05-02T00:00:00Z"),
    updatedAt: new Date("2024-05-02T00:00:00Z"),
  };
  const instance: SignalInstance = {
    id: "sig-instance-detail",
    definitionId: definition.id,
    status: "OPEN",
    entityRef: work.nodeId,
    entityKind: "cdm.work.item",
    severity: "ERROR",
    summary: "Work item is stale",
    details: null,
    firstSeenAt: new Date("2024-05-02T01:00:00Z"),
    lastSeenAt: new Date("2024-05-02T01:00:00Z"),
    resolvedAt: null,
    sourceRunId: null,
    createdAt: new Date("2024-05-02T01:00:00Z"),
    updatedAt: new Date("2024-05-02T01:00:00Z"),
    definition,
  };
  await graphWrite.upsertNode({
    nodeType: "signal.instance",
    nodeId: instance.id,
    properties: {
      severity: instance.severity,
      status: instance.status,
      summary: instance.summary,
      definitionId: instance.definitionId,
      entityRef: instance.entityRef,
      entityKind: instance.entityKind,
    },
  });
  await graphWrite.upsertEdge({
    edgeType: "HAS_SIGNAL",
    fromNodeId: work.nodeId,
    toNodeId: instance.id,
  });
  const builder = new ClusterBuilderService({
    graphWrite,
    graphStore,
    vectorSearch: new FakeVectorSearch([doc.nodeId, work.nodeId]),
    scoreThreshold: 0,
    now: () => new Date("2024-05-02T00:00:00Z"),
  });
  await builder.buildClustersForProject({ tenantId: tenant.tenantId, projectKey: tenant.projectId });

  const signalStore = new FakeSignalStore({ definitions: [definition], instances: [instance] });
  const resolvers = createResolvers(metadataStore, {
    graphStore,
    signalStore,
    clusterRead: new ClusterReadService(graphStore),
  });
  const ctx = buildResolverContext(tenant);
  const list = await (resolvers.Query.brainEpisodes as any)(
    null,
    { tenantId: tenant.tenantId, projectKey: tenant.projectId },
    ctx as any,
  );
  const episodeId = list.nodes[0].id;
  const episode = await (resolvers.Query.brainEpisode as any)(
    null,
    { tenantId: tenant.tenantId, projectKey: tenant.projectId, id: episodeId },
    ctx as any,
  );

  assert.ok(episode);
  assert.equal(episode.clusterKind, "work-doc-episode");
  assert.equal(episode.size, 2);
  const workMember = episode.members.find((member: any) => member.nodeId === work.nodeId);
  assert.ok(workMember);
  assert.equal(workMember.workKey, "BRAIN-7");
  const docMember = episode.members.find((member: any) => member.nodeId === doc.nodeId);
  assert.ok(docMember);
  assert.equal(docMember.docUrl, "https://example.com/flaky");
  assert.equal(episode.signals.length, 1);
  const signal = episode.signals[0];
  assert.equal(signal.id, instance.id);
  assert.equal(signal.definitionSlug, definition.slug);
  assert.equal(signal.severity, instance.severity);
  assert.equal(signal.status, instance.status);
});

test("brainEpisodes enforces tenant and project scoping", async (t) => {
  const { graphWrite, graphStore, metadataStore, tenant, registry, cleanup } = await createGraphWriteFixture({
    tenant: { tenantId: "tenant-scope-a", projectId: "OPS" },
  });
  t.after(cleanup);
  const clusterRead = new ClusterReadService(graphStore);
  const signalStore = new FakeSignalStore();
  const resolvers = createResolvers(metadataStore, { graphStore, signalStore, clusterRead });
  const ctx = buildResolverContext(tenant);

  const workA = await graphWrite.upsertNode({
    nodeType: "cdm.work.item",
    nodeId: "work-scope-a",
    properties: { projectKey: tenant.projectId, summary: "A-side", sourceIssueKey: "OPS-1" },
  });
  const docA = await graphWrite.upsertNode({
    nodeType: "cdm.doc.item",
    nodeId: "doc-scope-a",
    properties: { projectKey: tenant.projectId, title: "A doc" },
  });
  const builderA = new ClusterBuilderService({
    graphWrite,
    graphStore,
    vectorSearch: new FakeVectorSearch([docA.nodeId, workA.nodeId]),
    scoreThreshold: 0,
    now: () => new Date("2024-05-03T00:00:00Z"),
  });
  await builderA.buildClustersForProject({ tenantId: tenant.tenantId, projectKey: tenant.projectId });

  const otherTenant: TenantContext = { tenantId: "tenant-scope-b", projectId: "OTHER" };
  const otherGraphWrite = new GraphWriteService({ graphStore, registry, tenant: otherTenant });
  const workB = await otherGraphWrite.upsertNode({
    nodeType: "cdm.work.item",
    nodeId: "work-scope-b",
    properties: { projectKey: otherTenant.projectId, summary: "B-side", sourceIssueKey: "OTHER-1" },
  });
  const docB = await otherGraphWrite.upsertNode({
    nodeType: "cdm.doc.item",
    nodeId: "doc-scope-b",
    properties: { projectKey: otherTenant.projectId, title: "B doc" },
  });
  const builderB = new ClusterBuilderService({
    graphWrite: otherGraphWrite,
    graphStore,
    vectorSearch: new FakeVectorSearch([docB.nodeId, workB.nodeId]),
    scoreThreshold: 0,
    now: () => new Date("2024-05-03T00:00:00Z"),
  });
  await builderB.buildClustersForProject({ tenantId: otherTenant.tenantId, projectKey: otherTenant.projectId });

  const list = await (resolvers.Query.brainEpisodes as any)(
    null,
    { tenantId: tenant.tenantId, projectKey: tenant.projectId },
    ctx as any,
  );
  assert.equal(list.totalCount, 1);
  assert.equal(list.nodes[0].projectKey, tenant.projectId);

  const otherClusters = await clusterRead.listClustersForProject({
    tenantId: otherTenant.tenantId,
    projectKey: otherTenant.projectId,
  });
  assert.equal(otherClusters.length, 1);
  const foreignClusterId = otherClusters[0].clusterNodeId;

  await assert.rejects(
    (resolvers.Query.brainEpisode as any)(
      null,
      { tenantId: otherTenant.tenantId, projectKey: otherTenant.projectId, id: foreignClusterId },
      ctx as any,
    ),
    /scope mismatch/i,
  );

  const nullResult = await (resolvers.Query.brainEpisode as any)(
    null,
    { tenantId: tenant.tenantId, projectKey: tenant.projectId, id: foreignClusterId },
    ctx as any,
  );
  assert.equal(nullResult, null);
});
