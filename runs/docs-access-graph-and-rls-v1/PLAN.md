# Plan (initial)
- Confirm KB ACL model and registry updates: principal:user/group nodes, doc node reuse, edges CAN_VIEW_DOC and HAS_MEMBER with source/synced_at metadata; decide additive schema encoding and any RLS index table.
- Design ACL ingestion path for Confluence and OneDrive: source API/stub payloads, mapping to principals/docs, incremental strategy, and how to write KB edges + RLS index via ingestion units.
- Add secured CDM Docs resolver behavior (secured=true default, secured=false admin-only), wire principal resolution, and update Docs Explorer/UI + KB admin views to use secured queries and show access summary; add tests and run ci-check.
