# SPEC — Semantic Confluence source v1

## Problem

We now have:

- A solid endpoint + metadata collection stack (JDBC + Jira).
- Work CDM + Jira mapping, and docs CDM defined.
- CDM sinks and explorers for work.

But Confluence is still “outside” Nucleus:

- There is no Confluence endpoint template in the registry.
- The metadata worker does not know how to collect Confluence spaces/pages/attachments.
- The catalog UI cannot show Confluence datasets or preview page content.

We want Confluence to be a **first-class semantic source**:

- Registerable endpoint with clear config and capabilities.
- Metadata subsystem that discovers spaces/pages/attachments.
- Catalog datasets for docs entities that later feed docs CDM ingestion and KB.

## Interfaces / Contracts

### 1. Confluence endpoint template

Python-side endpoint class in `runtime_common.endpoints`, e.g.:

- `ConfluenceEndpoint(MetadataCapableEndpoint, PreviewCapableEndpoint, ...)`

Descriptor (returned by `descriptor()`):

- `id` / template id: `"http.confluence"`
- `family`: `"HTTP"` or `"HTTP_SEMANTIC"`
- `vendor`: `"Atlassian"`
- `title`: `"Confluence Cloud"` (or generic `"Confluence"`)

Config fields (descriptor fields / parameters):

- `base_url` (string, required):  
  - e.g. `https://your-domain.atlassian.net/wiki`
- `auth_type` (enum): `"basic"` | `"api_token"` | `"oauth"` (v1: support `"api_token"`).
- `username_or_email` (string, required for basic/token).
- `api_token` (secret, required for basic/token).
- Optional filters:
  - `space_keys` (array of strings): restrict spaces to collect.
  - `include_archived` (boolean, default `false`).
  - `max_pages_per_space` (int, optional guardrail).

Capabilities:

```python
{
    "metadata": True,
    "preview": True,
    "datasets": [
        "confluence.space",
        "confluence.page",
        "confluence.attachment",
    ],
    "supports_docs_cdm": True,
}

The endpoint must implement:
	•	A metadata_subsystem() returning an object with:
	•	capabilities() — as above.
	•	collect_metadata(...) — used by the metadata worker to fetch normalized records.
	•	A preview(...) method to fetch and normalize content for preview (e.g. HTML/convert-to-plain).

2. Metadata collection contract

Confluence metadata collection is implemented in Python (metadata worker), using the Confluence endpoint.

High-level flow:
	1.	Metadata planner, seeing template "http.confluence", calls a Confluence-specific planning hook that:
	•	Uses endpoint metadata_subsystem capabilities to know dataset types.
	•	Plans jobs per dataset type and space (similar to JDBC table slicing but simpler v1).
	2.	For each planned job:
	•	dataset = "confluence.space":
	•	Collect all spaces (or filtered by space_keys).
	•	Emit normalized records describing each space.
	•	dataset = "confluence.page":
	•	For each space:
	•	List pages (tree) up to limits/filters.
	•	Emit normalized records for each page.
	•	dataset = "confluence.attachment":
	•	Optionally, for each page:
	•	List attachments.
	•	Emit normalized records.
	3.	Metadata worker writes output as MetadataRecord/CatalogSnapshot with domains and payloads consistent with existing catalog conventions.

2.1. Normalized payloads (examples)
For a space:

{
  "domain": "confluence.space",
  "labels": ["confluence", "doc_space"],
  "payload": {
    "id": "123",
    "key": "ENG",
    "name": "Engineering",
    "description": "Eng space",
    "url": "https://.../spaces/ENG",
    "status": "current",
    "type": "global",
    "properties": { ... }
  }
}

For a page:

{
  "domain": "confluence.page",
  "labels": ["confluence", "doc_item"],
  "payload": {
    "id": "456",
    "space_key": "ENG",
    "title": "Design Doc",
    "parent_id": "12345",
    "url": "https://.../pages/456",
    "created_at": "...",
    "updated_at": "...",
    "created_by": { "account_id": "...", "display_name": "..." },
    "updated_by": { ... },
    "properties": {
      "labels": ["design", "backend"],
      "status": "current"
    }
  }
}

For an attachment:

{
  "domain": "confluence.attachment",
  "labels": ["confluence", "doc_attachment"],
  "payload": {
    "id": "789",
    "page_id": "456",
    "file_name": "diagram.png",
    "mime_type": "image/png",
    "size_bytes": 12345,
    "url": "https://.../attachments/789",
    "created_at": "...",
    "created_by": { ... },
    "properties": {}
  }
}

The actual structure should align with your existing normalized metadata conventions, but keep this semantic shape.

3. Catalog integration

The existing metadata → catalog pipeline must treat Confluence metadata like any other:
	•	Each record becomes a catalog.dataset (for the dataset) or catalog.entity (depending on your current modeling).
	•	We should at minimum ensure that:
	•	Confluence spaces appear as datasets or entities with an appropriate domain (e.g., confluence.space or doc.space).
	•	Confluence pages appear under a dataset like confluence.page or doc.item backed by Confluence.
	•	Attachments are either separate datasets or related entities.

For v1, it’s acceptable for Confluence to appear as:
	•	Endpoint: http.confluence
	•	Datasets: confluence.space, confluence.page, confluence.attachment

The catalog UI should:
	•	List Confluence datasets in the dataset list view (filterable by endpoint).
	•	Show basic fields in the dataset detail view.

4. Preview contract

The Confluence endpoint must implement a preview capability:
	•	TS/GraphQL calls a preview activity (as done for JDBC preview) with:
	•	endpoint id,
	•	dataset/domain,
	•	record identifier (e.g., page id),
	•	optional limit.
	•	Python endpoint executes:
	•	For a page:
	•	Fetch page content via Confluence REST (view representation).
	•	Normalize to HTML or markdown snippet; optionally strip macros.
	•	For an attachment:
	•	For v1, it’s acceptable to show metadata only (file name, size, URL) and not fetch the binary content.

The catalog UI “Preview” panel should:
	•	For Confluence pages:
	•	Render a truncated body (HTML or markdown), plus metadata (title, space, updated).
	•	For attachments:
	•	Show basic metadata.

5. Auth & security
	•	Use existing Keycloak auth model for UI/API.
	•	Confluence endpoint config will hold credentials (username/email + API token) stored securely (as you do for other endpoints).
	•	Metadata worker must be able to use those credentials to call Confluence’s REST API.

No Confluence user impersonation required in v1; we can assume a service account with appropriate read scopes.

Data & State
	•	New Confluence endpoint template and metadata subsystem.
	•	New metadata records for Confluence spaces/pages/attachments.
	•	New catalog datasets/entities associated with Confluence endpoints.

No new DB tables are required; we reuse existing metadata & catalog structures.

Constraints
	•	Respect Confluence API rate limits; use reasonable page sizes and avoid hammering the API.
	•	Keep metadata jobs bounded; planner should be able to slice by space and optionally by page count.

Acceptance Mapping
	•	AC1 → Template exists, registry wired, and UI/GraphQL can register a Confluence endpoint.
	•	AC2 → Metadata collection produces normalized Confluence records and catalog datasets.
	•	AC3 → Catalog UI shows Confluence datasets and supports preview for pages.
	•	AC4 → Tests (unit + integration + Playwright) cover the full flow.

Risks / Open Questions
	•	R1: Confluence instances can be very large; we might need more advanced slicing strategies later (per space + time window). v1 can do coarse-grained jobs.
	•	Q1: Whether to use confluence.* vs doc.* domains for datasets; v1 can use confluence.* and map to docs CDM during ingestion.
