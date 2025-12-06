# STORY — docs-access-graph-and-rls-v1

- 2025-12-06: Added docs ACL/RLS scaffolding. Introduced `cdm_doc_access` RLS table (migration), secured doc filtering with principal injection (subject/email), and access-aware doc store. Added Confluence/OneDrive ACL ingestion units emitting `cdm.doc.access` records with minimal principal enrichment, plus sink/Resolver tests. Builds/tests green.
