# Acceptance Criteria

1) Confluence endpoint template registered and usable
   - Type: unit / integration
   - Evidence:
     - A template with id `http.confluence` is registered in the endpoint registry.
     - Descriptor includes:
       - family `"HTTP"` (or equivalent),
       - vendor `"Atlassian"`,
       - required config fields (base_url, auth).
       - capabilities: `metadata`, `preview`, `datasets` including `confluence.space`, `confluence.page`, `confluence.attachment`.
     - GraphQL API exposes the template and the Metadata UI “Register Endpoint” flow can render and submit a Confluence endpoint configuration.

2) Metadata collection for Confluence produces normalized records
   - Type: integration (Python + worker)
   - Evidence:
     - Running a metadata collection for a Confluence endpoint:
       - calls the Confluence endpoint’s metadata subsystem,
       - fetches spaces/pages (and optionally attachments) from a test/stubbed Confluence instance,
       - emits normalized metadata records with domains `confluence.space`, `confluence.page`, `confluence.attachment`.
     - Unit/integration tests assert shape of emitted payloads (keys, titles, URLs, timestamps, etc.).

3) Confluence datasets appear in catalog UI
   - Type: e2e (Playwright)
   - Evidence:
     - After metadata collection, the catalog page:
       - lists Confluence datasets or entities,
       - allows filtering or grouping by endpoint/template,
       - shows basic fields (e.g., dataset/domain, endpoint, row counts).
     - Clicking into a Confluence page dataset shows Confluence-backed rows/entities.

4) Preview works for Confluence pages
   - Type: e2e / integration
   - Evidence:
     - From the catalog dataset view for Confluence pages, the “Preview” action:
       - triggers a GraphQL/Temporal preview call to the Confluence endpoint,
       - returns non-empty content for at least one test page,
       - renders a snippet (HTML/markdown or plain text) in the UI without error.
     - Attachments either:
       - show a minimal preview (metadata only), or
       - are clearly indicated as “no inline preview” with a link to Confluence.

5) Tests and CI
   - Type: meta
   - Evidence:
     - New Python unit/integration tests for Confluence endpoint + metadata subsystem.
     - TS/GraphQL tests for endpoint registration + collections.
     - Playwright test exercising:
       - endpoint registration (or using a seeded endpoint),
       - metadata collection,
       - catalog view and preview.
     - `pnpm ci-check` remains green.


⸻

4) runs/semantic-confluence-source-v1/RUNCARD.md

