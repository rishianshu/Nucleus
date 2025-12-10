# Plan

- [x] Review INTENT/SPEC/ACCEPTANCE and existing ingestion/store docs.
- [x] Draft STORES architecture doc covering Metadata/Graph/Signal/Kv/Object responsibilities and access patterns.
- [x] Specify KvStore contract (interface, DB schema, migration from file-backed store).
- [x] Specify ObjectStore interface/backends with streaming semantics and staging key patterns.
- [x] Update ingestion/endpoint docs to route Source→Staging→Sink through ObjectStore + KvStore interfaces for Brain/Workspace surfaces.
