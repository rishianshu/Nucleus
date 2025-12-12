import type { GraphWrite } from "../graph/graphWrite.js";
import type { SignalInstance, SignalStore } from "../signals/types.js";
import { PrismaSignalStore } from "../signals/signalStore.js";
import {
  cleanProperties,
  clampBatchSize,
  encodeOffsetCursor,
  normalizeCdmEntityId,
  normalizeGenericNodeId,
  toIsoString,
} from "./utils.js";

const SIGNAL_NODE_TYPE = "signal.instance";
const SIGNAL_EDGE_TYPE = "HAS_SIGNAL";
const WORK_NODE_TYPE = "cdm.work.item";
const DOC_NODE_TYPE = "cdm.doc.item";

type SignalStoreDeps = Pick<SignalStore, "listInstances" | "listInstancesPaged">;

type PagedSignalResult = {
  rows: SignalInstance[];
  cursorOffset: number;
  hasNextPage: boolean;
};

export interface SignalsToKgBridge {
  syncSignalsToKg(options?: { limit?: number; offset?: number }): Promise<{ processed: number }>;
}

export class DefaultSignalsToKgBridge implements SignalsToKgBridge {
  private readonly graphWrite: GraphWrite;
  private readonly signalStore: SignalStoreDeps;
  private readonly defaultBatchSize: number;

  constructor(options: { graphWrite: GraphWrite; signalStore?: SignalStoreDeps; batchSize?: number }) {
    this.graphWrite = options.graphWrite;
    this.signalStore = options.signalStore ?? new PrismaSignalStore();
    this.defaultBatchSize = clampBatchSize(options.batchSize);
  }

  async syncSignalsToKg(options?: { limit?: number; offset?: number }): Promise<{ processed: number }> {
    const batchSize = clampBatchSize(options?.limit, this.defaultBatchSize, 200);
    if (this.signalStore.listInstancesPaged) {
      return { processed: await this.syncPaged(batchSize, options?.offset) };
    }
    const rows = await this.signalStore.listInstances({ limit: batchSize + (options?.offset ?? 0) });
    const slice = typeof options?.offset === "number" ? rows.slice(options.offset, options.offset + batchSize) : rows;
    for (const instance of slice) {
      await this.upsertSignalInstance(instance);
    }
    return { processed: slice.length };
  }

  private async syncPaged(batchSize: number, initialOffset?: number): Promise<number> {
    let after: string | null | undefined = encodeOffsetCursor(initialOffset) ?? null;
    let processed = 0;
    while (true) {
      const page = (await this.signalStore.listInstancesPaged?.({
        limit: batchSize,
        after: after ?? undefined,
      })) as PagedSignalResult | undefined;
      if (!page || !page.rows.length) {
        break;
      }
      for (const instance of page.rows) {
        await this.upsertSignalInstance(instance);
      }
      processed += page.rows.length;
      if (!page.hasNextPage) {
        break;
      }
      after = encodeOffsetCursor(page.cursorOffset + page.rows.length);
    }
    return processed;
  }

  private async upsertSignalInstance(instance: SignalInstance): Promise<void> {
    const target = this.resolveTarget(instance);
    const nodeId = this.normalizeSignalNodeId(instance.id);
    const properties = cleanProperties({
      displayName: instance.summary,
      summary: instance.summary,
      severity: instance.severity,
      status: instance.status,
      entityKind: instance.entityKind,
      entityRef: target.nodeId,
      definitionId: instance.definitionId,
      firstSeenAt: toIsoString(instance.firstSeenAt),
      lastSeenAt: toIsoString(instance.lastSeenAt),
      resolvedAt: toIsoString(instance.resolvedAt ?? null),
    });

    await this.graphWrite.upsertNode({
      nodeType: SIGNAL_NODE_TYPE,
      nodeId,
      properties,
    });

    await this.graphWrite.upsertEdge({
      edgeType: SIGNAL_EDGE_TYPE,
      fromNodeId: target.nodeId,
      toNodeId: nodeId,
    });
  }

  private resolveTarget(instance: SignalInstance): { nodeType: string; nodeId: string } {
    const ref = instance.entityRef ?? "";
    const kind = instance.entityKind?.toLowerCase() ?? "";
    const prefixFromRef = this.resolvePrefixFromRef(ref);
    const prefix = prefixFromRef ?? this.resolvePrefixFromKind(kind);
    if (!prefix) {
      throw new Error(`Unsupported signal entityRef ${instance.entityRef}`);
    }
    if (prefix === WORK_NODE_TYPE || prefix === DOC_NODE_TYPE) {
      return { nodeType: prefix, nodeId: normalizeCdmEntityId(prefix, ref) };
    }
    return { nodeType: prefix, nodeId: normalizeGenericNodeId(prefix, ref) };
  }

  private resolvePrefixFromRef(ref: string): string | null {
    if (ref.startsWith(WORK_NODE_TYPE)) {
      return WORK_NODE_TYPE;
    }
    if (ref.startsWith(DOC_NODE_TYPE)) {
      return DOC_NODE_TYPE;
    }
    if (ref.startsWith("kg.cluster")) {
      return "kg.cluster";
    }
    return null;
  }

  private resolvePrefixFromKind(kind: string): string | null {
    if (!kind) {
      return null;
    }
    if (kind.includes("work")) {
      return WORK_NODE_TYPE;
    }
    if (kind.includes("doc")) {
      return DOC_NODE_TYPE;
    }
    if (kind.includes("cluster")) {
      return "kg.cluster";
    }
    return null;
  }

  private normalizeSignalNodeId(id: string): string {
    const value = String(id ?? "");
    if (value.startsWith(`${SIGNAL_NODE_TYPE}:`) || value.startsWith(SIGNAL_NODE_TYPE)) {
      return value;
    }
    return value;
  }
}
