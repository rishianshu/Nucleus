## PLAN — kb-admin-console-v1

1. **Recon + Design Outline**
   - Review current nav shell, GraphStore helpers, and metadata UI structure (App.tsx, MetadataWorkspace, etc.).
   - Catalog existing GraphQL capabilities to extend.
   - Produce TODO list referencing ACs.

2. **Backend GraphQL Additions**
   - Implement `kbNodes`, `kbEdges`, `kbNode`, `kbNeighbors`, `kbScene` resolvers + schema updates; ensure RBAC scope filtering & pagination contracts.
   - Add supporting data loaders/utilities and tests (unit/integration) covering identity/scope/provenance exposure.

3. **Frontend Knowledge Base Console**
   - Add top-level navigation entry + routes for Overview, Explorer (nodes/edges), Scenes, and Provenance.
   - Build shared hooks/components (filters, search, pagination) and implement the required UI states + side panels.
   - Replace legacy “Graph identities” list with link into KB Explorer.

4. **Scenes + Provenance UX**
   - Implement neighborhood visualization/list sync with depth & edge-type filters + truncation notice.
   - Build provenance tab for nodes showing recent writes.

5. **Testing & Finalization**
   - Update/add Playwright coverage for AC1–AC6, plus targeted unit/contract tests.
   - Run relevant test suites, update docs/story/state artifacts, and prepare for commit.
