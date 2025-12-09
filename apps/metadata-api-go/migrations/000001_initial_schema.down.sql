-- Rollback initial schema

DROP TABLE IF EXISTS onedrive_delegated_tokens;
DROP TABLE IF EXISTS onedrive_auth_sessions;
DROP TABLE IF EXISTS endpoint_templates;
DROP TABLE IF EXISTS graph_edges;
DROP TABLE IF EXISTS graph_nodes;
DROP TABLE IF EXISTS ingestion_transient_states;
DROP TABLE IF EXISTS ingestion_checkpoints;
DROP TABLE IF EXISTS ingestion_unit_states;
DROP TYPE IF EXISTS ingestion_state;
DROP TABLE IF EXISTS ingestion_unit_configs;
DROP TABLE IF EXISTS metadata_collection_runs;
DROP TYPE IF EXISTS metadata_collection_run_status;
DROP TABLE IF EXISTS metadata_collections;
DROP TABLE IF EXISTS metadata_endpoints;
DROP TABLE IF EXISTS metadata_records;
DROP TABLE IF EXISTS metadata_projects;
