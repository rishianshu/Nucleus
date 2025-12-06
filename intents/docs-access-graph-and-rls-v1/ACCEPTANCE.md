# Acceptance Criteria

1) Docs access edges are ingested into KB for Confluence and OneDrive
   - Type: integration
   - Evidence:
     - Ingesting ACLs for a seeded Confluence space and OneDrive root results in KB entries where:
       - `principal:user` and/or `principal:group` nodes exist for at least one test user/group.
       - `doc` nodes exist for seeded docs.
       - `CAN_VIEW_DOC` edges connect principals to docs.
       - (Optionally) `HAS_MEMBER` edges connect groups to users.
     - A KB admin query or resolver returns these edges with source and synced_at metadata.

2) CDM Docs resolvers enforce RLS with a secured flag
   - Type: integration
   - Evidence:
     - Calling the CDM Docs query with `secured=true` as User A returns only docs that:
       - have `CAN_VIEW_DOC` edges from User A or their groups in KB.
     - Calling the same query as User B returns a different set of docs when ACLs differ.
     - An admin role can call `secured=false` and see all docs; non-admins cannot bypass RLS in this way.

3) Docs Explorer hides unauthorized docs
   - Type: e2e (Playwright)
   - Evidence:
     - For a seeded scenario where Doc X is visible to User A but not User B:
       - Logging in as User A and visiting Docs Explorer shows Doc X in the list.
       - Logging in as User B and visiting Docs Explorer does not show Doc X.
     - The UI uses the secured CDM Docs query and no client-side RLS bypass is present.

4) Docs Explorer shows basic access metadata in doc detail
   - Type: e2e / integration
   - Evidence:
     - Clicking on a doc in Docs Explorer opens a detail pane that includes:
       - an access-level indicator (e.g., PRIVATE/SHARED/PUBLIC/UNKNOWN), or
       - a “shared with” summary (counts of groups/users).
     - The values are derived from KB ACL edges (directly or via RLS index), not hard-coded UI fixtures.

5) KB admin tools can inspect docs access edges
   - Type: integration / e2e
   - Evidence:
     - KB admin console or API allows:
       - listing `CAN_VIEW_DOC` edges for a given doc,
       - listing docs accessible to a given principal.
     - Admin can visually confirm a mismatch between ACL data and UI (if any) for debugging.

6) CI remains green
   - Type: meta
   - Evidence:
     - `pnpm ci-check` passes after adding ACL ingestion, KB edges, and RLS.
     - New unit/integration/Playwright tests for ACL/RLS are part of the CI suite.
