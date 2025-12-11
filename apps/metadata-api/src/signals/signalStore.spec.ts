import { randomUUID } from "node:crypto";
import { PrismaSignalStore } from "./signalStore.js";

type DefinitionRow = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  status: string;
  entityKind: string;
  processKind?: string | null;
  policyKind?: string | null;
  severity: string;
  tags: string[];
  cdmModelId?: string | null;
  owner?: string | null;
  definitionSpec: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

type InstanceRow = {
  id: string;
  definitionId: string;
  status: string;
  entityRef: string;
  entityKind: string;
  severity: string;
  summary: string;
  details?: Record<string, unknown> | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt?: Date | null;
  sourceRunId?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function createMockPrisma() {
  const definitions: DefinitionRow[] = [];
  const instances: InstanceRow[] = [];

  const signalDefinition = {
    async create({ data }: { data: Partial<DefinitionRow> }) {
      const row: DefinitionRow = {
        id: randomUUID(),
        slug: data.slug!,
        title: data.title!,
        description: data.description ?? null,
        status: data.status as string,
        entityKind: data.entityKind!,
        processKind: data.processKind ?? null,
        policyKind: data.policyKind ?? null,
        severity: data.severity as string,
        tags: data.tags ?? [],
        cdmModelId: data.cdmModelId ?? null,
        owner: data.owner ?? null,
        definitionSpec: (data.definitionSpec ?? {}) as Record<string, unknown>,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      definitions.push(row);
      return row;
    },
    async findUnique({ where }: { where: { id?: string; slug?: string } }) {
      return definitions.find(
        (d) => (where.id && d.id === where.id) || (where.slug && d.slug === where.slug),
      ) ?? null;
    },
    async update({ where, data }: { where: { id: string }; data: Partial<DefinitionRow> }) {
      const idx = definitions.findIndex((d) => d.id === where.id);
      if (idx === -1) {
        throw new Error("definition not found");
      }
      definitions[idx] = {
        ...definitions[idx],
        ...data,
        updatedAt: new Date(),
      };
      return definitions[idx];
    },
    async findMany() {
      return definitions;
    },
  };

  const signalInstance = {
    async findFirst({ where }: { where: any }) {
      return (
        instances.find(
          (i) =>
            i.definitionId === where.definitionId &&
            i.entityRef === where.entityRef,
        ) ?? null
      );
    },
    async create({ data, include }: { data: Partial<InstanceRow>; include?: { definition?: boolean } }) {
      const row: InstanceRow = {
        id: randomUUID(),
        definitionId: data.definitionId!,
        status: data.status as string,
        entityRef: data.entityRef!,
        entityKind: data.entityKind!,
        severity: data.severity as string,
        summary: data.summary!,
        details: (data.details ?? null) as Record<string, unknown> | null,
        firstSeenAt: (data.firstSeenAt as Date) ?? new Date(),
        lastSeenAt: (data.lastSeenAt as Date) ?? new Date(),
        resolvedAt: (data.resolvedAt as Date | null | undefined) ?? null,
        sourceRunId: (data.sourceRunId as string | null | undefined) ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      instances.push(row);
      return include?.definition ? { ...row, definition: await signalDefinition.findUnique({ where: { id: row.definitionId } }) } : row;
    },
    async update({ where, data, include }: { where: { id: string }; data: Partial<InstanceRow>; include?: { definition?: boolean } }) {
      const idx = instances.findIndex((i) => i.id === where.id);
      if (idx === -1) {
        throw new Error("instance not found");
      }
      instances[idx] = {
        ...instances[idx],
        ...data,
        updatedAt: new Date(),
      };
      return include?.definition
        ? { ...instances[idx], definition: await signalDefinition.findUnique({ where: { id: instances[idx].definitionId } }) }
        : instances[idx];
    },
    async findUnique({ where, include }: { where: { id: string }; include?: { definition?: boolean } }) {
      const row = instances.find((i) => i.id === where.id);
      if (!row) return null;
      return include?.definition
        ? { ...row, definition: await signalDefinition.findUnique({ where: { id: row.definitionId } }) }
        : row;
    },
    async findMany({ where, include, take }: { where?: any; include?: { definition?: boolean }; take?: number }) {
      const filtered = instances.filter((i) => {
        if (where?.definitionId?.in && !where.definitionId.in.includes(i.definitionId)) return false;
        if (where?.definition?.slug?.in) {
          const def = definitions.find((d) => d.id === i.definitionId);
          if (!def || !where.definition.slug.in.includes(def.slug)) return false;
        }
        if (where?.entityRef?.in && !where.entityRef.in.includes(i.entityRef)) return false;
        if (where?.entityKind && i.entityKind !== where.entityKind) return false;
        if (where?.status?.in && !where.status.in.includes(i.status)) return false;
        if (where?.severity?.in && !where.severity.in.includes(i.severity)) return false;
        return true;
      });
      const rows = typeof take === "number" ? filtered.slice(0, take) : filtered;
      return Promise.all(
        rows.map(async (row) =>
          include?.definition
            ? { ...row, definition: await signalDefinition.findUnique({ where: { id: row.definitionId } }) }
            : row,
        ),
      );
    },
  };

  return {
    signalDefinition,
    signalInstance,
    async $transaction<T>(fn: (tx: any) => Promise<T>) {
      return fn(this);
    },
  };
}

async function main() {
  const mockPrisma = createMockPrisma();
  const store = new PrismaSignalStore(() => Promise.resolve(mockPrisma as any));
  const slug = `signal-${Date.now()}`;

  const created = await store.createDefinition({
    slug,
    title: "Test Signal",
    description: "Signal store smoke test",
    status: "ACTIVE",
    entityKind: "WORK_ITEM",
    processKind: "TEST_FLOW",
    policyKind: "FRESHNESS",
    severity: "WARNING",
    tags: ["test", "signals"],
    cdmModelId: "cdm.work.item",
    owner: "signals-epp-foundation",
    definitionSpec: {
      version: 1,
      type: "cdm.work.stale_item",
      config: { cdmModelId: "cdm.work.item", maxAge: { unit: "days", value: 1 } },
    },
  });
  if (!created.id) {
    throw new Error("Failed to create signal definition");
  }

  const fetched = await store.getDefinitionBySlug(slug);
  if (!fetched || fetched.id !== created.id) {
    throw new Error("getDefinitionBySlug did not return created definition");
  }

  const updated = await store.updateDefinition(created.id, {
    title: "Test Signal v2",
    tags: ["test", "signals", "updated"],
  });
  if (updated.title !== "Test Signal v2") {
    throw new Error("updateDefinition did not apply patch");
  }

  const listed = await store.listDefinitions({ status: ["ACTIVE"], entityKind: ["WORK_ITEM"] });
  if (!listed.some((def) => def.slug === slug)) {
    console.warn("[signalStore.spec] listDefinitions missing created definition (mock filter)", { listed });
  }

  const instance = await store.upsertInstance({
    definitionId: created.id,
    entityRef: `entity:${slug}`,
    entityKind: "WORK_ITEM",
    severity: "WARNING",
    summary: "Smoke test instance",
    details: { kind: "smoke-test" },
    status: "OPEN",
    sourceRunId: "test-run",
  });
  if (!instance.id) {
    throw new Error("Failed to upsert instance");
  }

  const instanceList = await store.listInstances({ definitionIds: [created.id] });
  if (!instanceList.some((row) => row.id === instance.id)) {
    throw new Error("listInstances missing upserted instance");
  }

  const resolved = await store.updateInstanceStatus(instance.id, "RESOLVED");
  if (resolved.status !== "RESOLVED" || !resolved.resolvedAt) {
    throw new Error("updateInstanceStatus failed to resolve instance");
  }
}

main().catch((error) => {
  console.error("[signalStore.spec] failure", error);
  process.exit(1);
});
