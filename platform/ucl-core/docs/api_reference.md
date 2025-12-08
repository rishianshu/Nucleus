# UCL API Reference (V2)

## 1. Gateway Service (`api/v1/gateway.proto`)

### Data Plane Operations
These operations provide feature parity with the legacy "SourceEndpoint" capabilities.

#### `GetSchema`
Retrieves the structure of a remote dataset.
- **Input**: `endpoint_id`, `dataset_id` (e.g. "users_table").
- **Output**: List of fields, types, and primary keys.
- **Usage**: Used by the UI to show column mapping, or Metadata Service to catalog assets.

#### `ReadData`
Streams data from the source.
- **Input**: 
    - `dataset_id`
    - `filter`: SQL-like or JSON-based filter.
    - `limit`: For UI Previews (replace `SupportPreview`).
- **Output**: Stream of JSON records.
- **Streaming**: This is a gRPC Server Stream. The client receives messages as they are yielded by the connector.

### Control Plane Operations
These operations provide the new "Action" capabilities.

#### `ListActions`
Discovers what *operational* tasks are supported (e.g. "update_user", "send_email").

#### `ExecuteAction`
Performs the operation.
- **Mode**: `SYNC` (Block) or `ASYNC` (Temporal).

---

## 2. Connector Service (`api/v1/connector.proto`)

The Interface for Plugin Developers.

### `ListDatasets` (Discovery)
Equivalent to `list_units`. Returns what "tables" or "objects" are available to ingest.

### `Read` (Ingestion)
The workhorse for data movement.
- **Request**: Contains `Config` and `Filter`.
- **Response**: Stream of `Record`.
- **Note**: For "Bulk" connectors (like S3 or Snowflake Export), the `Record` might contain a *pointer* to a file (e.g. `s3://bucket/export.csv`) rather than the row itself, allowing hybrid data plane capabilities.

### `Execute` (Action)
The handler for side-effects.
- **Request**: `Action Name` + `Parameters`.
- **Response**: `Result` struct.
