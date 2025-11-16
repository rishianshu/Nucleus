# Story — collection-lifecycle

- 2025-11-15: Run blocked immediately after kickoff because the repository only contains the metadata API/Prisma assets—UI directories (apps/metadata-console or apps/reporting-designer) and the related start scripts referenced by the Run Card are missing, so required Endpoint/Collections UI work and Playwright evidence cannot begin.
- 2025-11-16: Completed collection lifecycle feature—added canonical dataset identities, Prisma migrations, Temporal workflow/schedule plumbing, GraphQL + UI wiring, and new e2e coverage; `pnpm check:metadata-lifecycle` and `pnpm check:metadata-auth` now pass with the metadata API/UI dev servers running.
