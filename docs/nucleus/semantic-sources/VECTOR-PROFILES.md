# Vector Profiles

Vector namespaces follow `vec/<orgId>/<domain>` with optional `/projectKey` suffix.

## Work Items
- **Fields**: `summary`, `description`, normalized comments (latest 5)
- **Chunking**: `issue` (single chunk) or `issue+thread` (each major comment thread).
- **Namespace**: `vec/<orgId>/work` (optionally `/projectKey`).
- **Metadata**: { workItemId, projectKey, status, priority, endpointId }

## Doc Pages
- **Fields**: HTML stripped to plaintext; include headings + paragraphs.
- **Chunking**: heading-aware paragraphs (max 1k tokens). Each chunk references heading path.
- **Namespace**: `vec/<orgId>/doc` or `vec/<orgId>/doc/<spaceKey>`.
- **Metadata**: { docPageId, spaceKey, url, endpointId }

## File Items
- **Fields**: Extracted text via MIME-specific parsers (Office/PDF/txt). Fallback to preview text.
- **Chunking**: page/section sized (~800 tokens) with `page_number` metadata.
- **Namespace**: `vec/<orgId>/file` (optionally `/driveId`).
- **Metadata**: { fileItemId, driveId, path, mime_type }

All vectors store `provenance` (endpointId, runId) and respect access scope when queried.
