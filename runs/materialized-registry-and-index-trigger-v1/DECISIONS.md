* Artifact uniqueness is keyed as `(tenantId, sourceRunId, artifactKind)` with `artifactKind` set from the dataset slug (e.g., `raw.code.file_chunk`) and handle URIs carrying runId/sink/tenant context.
* Indexing from a registry ID resolves the profile from artifact family/kind (defaults to `code.github.v1` for code/github artifacts); other families will need explicit profile mappings when added.
