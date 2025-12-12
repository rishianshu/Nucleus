# SPEC — KG CDM and Signals Bridge v1

## Problem

Nucleus has:
- CDM data (e.g., cdm.work.item, cdm.doc.item) in CDM tables/stores,
- Signal definitions and instances in their own store,
- a Knowledge Graph (KG) implementation with a meta registry and GraphWrite API.

However, CDM entities and Signal instances are not yet systematically projected
into the KG via GraphWrite. A large part of the "brain" is missing from the graph:
work items, docs, and their signals remain invisible to KG queries and KB tools.

We need a bridge layer that reads CDM and Signal data and publishes KG nodes/edges
according to the registry, in a paging and idempotent way.

## Interfaces / Contracts

### 1. CDM→KG Bridge

We introduce a CDM bridge module in metadata-api:

```ts
export interface CdmToKgBridge {
  syncWorkItemsToKg(options?: { limit?: number; offset?: number }): Promise<{ processed: number }>;
  syncDocItemsToKg(options?: { limit?: number; offset?: number }): Promise<{ processed: number }>;
  syncAllToKg(options?: { batchSize?: number }): Promise<{ workItems: number; docItems: number }>;
}
```

For v1, we focus on:
- cdm.work.item (e.g., issues/tickets),
- cdm.doc.item (e.g., Confluence/OneDrive docs),

Each sync function:
- Reads rows from the relevant CDM store in batches.
- For each row, builds a nodeType and properties object for GraphWrite.
- Calls GraphWrite.upsertNode.
- Optionally adds edges via GraphWrite.upsertEdge (e.g., BELONGS_TO_PROJECT).
- Returns a processed count.

### 2. Signals→KG Bridge

```ts
export interface SignalsToKgBridge {
  syncSignalsToKg(options?: { limit?: number; offset?: number }): Promise<{ processed: number }>;
}
```

This bridge:
- Reads SignalInstance rows in batches.
- Uses KG nodeType "signal.instance".
- Creates a HAS_SIGNAL edge from the target entity to the signal.instance node.
- Returns a processed count.

### 3. Batch/sync entrypoints

```ts
export async function syncCdmAndSignalsToKg(): Promise<void> {
  // calls CdmToKgBridge.syncAllToKg and SignalsToKgBridge.syncSignalsToKg
}
```

## Data & State

### Sources
- CDM data: existing CDM work/doc stores in metadata-api.
- Signal data: SignalDefinition/SignalInstance tables and SignalStore.

### Target
- KG nodes and edges via GraphStore, validated against kg_node_types/kg_edge_types.

### Idempotency
- Bridges must be idempotent via stable nodeId conventions and GraphWrite upserts.

### Performance
- Batching: each sync function operates in pages (e.g., pageSize 100–500).
- No full table loads into memory.

## Acceptance Mapping
- AC1 → CDM work/doc entities projected into KG via GraphWrite
- AC2 → Signal instances projected with HAS_SIGNAL edges
- AC3 → Idempotent bridge behavior
- AC4 → KG/KB read helpers see CDM entities + Signals after sync

## Risks / Open Questions
- R1: EntityRef / nodeId mapping for signals may need careful handling
- R2: Only work/doc bridged in v1; other CDM families can be added later
