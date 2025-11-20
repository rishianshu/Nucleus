# Metadata API

This package exposes the GraphQL API, schedulers, and supporting scripts used by the metadata workspace. Common commands:

```bash
# Start the API locally (requires .env)
pnpm --dir apps/metadata-api dev

# Run Prisma commands
pnpm --dir apps/metadata-api prisma <subcommand>
```

## Graph identity backfill

The graph identity hardening work introduced dedicated `graph_nodes`/`graph_edges` tables with scope-aware logical keys. Existing deployments can migrate legacy graph data by running:

```bash
pnpm --dir apps/metadata-api exec tsx src/scripts/backfillGraphIdentity.ts
```

The script automatically uses the configured metadata store (Prisma or file-backed) and writes a JSON summary under `.artifacts/<timestamp>-graph-backfill.json` capturing counts, errors, and any edges referencing missing nodes. Re-run is safe; upserts are idempotent by logical key.

## Knowledge Base GraphQL queries

The metadata API now exposes additive queries used by the Knowledge Base admin console:

- `kbNodes` / `kbEdges` return cursor-paginated connections with scope filtering (org/project/team) plus identity + provenance metadata.
- `kbNode` resolves a single node (used by side panels/provenance).
- `kbScene` / `kbNeighbors` build bounded subgraphs (≤300 nodes / 600 edges) honoring edge-type allowlists.

When running in local/file-store mode the resolvers fall back to a small synthetic graph seeded from `fixtures/sample-metadata.json`, ensuring the console and tests have representative data even before collections populate the graph tables.
