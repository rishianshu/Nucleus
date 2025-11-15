# Metadata SDK

Thin client that lets any system publish or explore metadata without importing
runtime internals. The SDK sits on top of the shared transport abstraction so it
works with embedded repositories today and remote services tomorrow.

## Architecture

```
runtime-core  <-- shared models (MetadataRecord, MetadataTarget, ...)
metadata-gateway <-- storage abstraction (embedded, remote)
metadata-sdk <-- domain services + transports + CDM models
↑
Ingestion / Reconciliation / LLM tools / External services
```

Key components:

- **Transports** – `Transport` protocol with an `EmbeddedTransport` implementation.
  Future transports can wrap HTTP, gRPC, or GraphQL endpoints.
- **ContextBuilder** – centralises source/run identity so emitted records keep
  consistent provenance.
- **Domain services** – `sdk.ingestion`, `sdk.schemas`, `sdk.catalog` expose
  task-oriented helpers for emitting metrics, fetching snapshots, or describing
  datasets.
- **CDM models** – `DataVolumeMetric`, `RuntimeMetric`, `SchemaProfile`, plus
  `build_custom_record` for bespoke kinds.

### Creating a client

```python
from metadata_sdk import MetadataSDK
from metadata_sdk.transports import EmbeddedTransport
from metadata_sdk.context import ContextOptions, ContextBuilder

transport = EmbeddedTransport(repository, gateway=gateway)
context = ContextBuilder(ContextOptions(source_id="ingestion-prod"))
sdk = MetadataSDK(transport=transport, context=context)
```

### Emitting metrics

```python
from metadata_sdk import DataVolumeMetric, RuntimeMetric
from runtime_core import MetadataTarget

target = MetadataTarget(source_id="ingestion-prod", namespace="FOO", entity="BAR")

sdk.ingestion.emit_volume(
    DataVolumeMetric(target=target, rows=12345, mode="full", load_date="2024-02-01")
)

sdk.ingestion.emit_runtime(
    RuntimeMetric(target=target, status="success", duration_seconds=42.3)
)
```

### Querying metadata

```python
snapshot = sdk.schemas.latest_snapshot(target)
volume_history = sdk.ingestion.history(target, limit=30)
description = sdk.catalog.describe(target)
search_results = sdk.catalog.search("customer churn")
```

### Metadata about metadata

The SDK will continue to grow with discovery-oriented helpers (`catalog.search`,
`catalog.describe`, lineage lookups) so LLM agents and tooling can explore the
metadata graph without bespoke integrations.

## Next steps

- Add HTTP/gRPC transport adapters once the standalone metadata service is live.
- Expand discovery APIs (faceted search, lineage graph, domain/tag filtering).
- Publish the package separately so external platforms can adopt it directly.
