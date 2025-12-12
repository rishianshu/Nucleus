-- Metadata API Go Migration
-- Initial schema matching Prisma models from TypeScript implementation

-- =============================================================================
-- PROJECTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS metadata_projects (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metadata_projects_slug ON metadata_projects(slug);

-- =============================================================================
-- METADATA RECORDS
-- =============================================================================

CREATE TABLE IF NOT EXISTS metadata_records (
    id TEXT NOT NULL,
    domain TEXT NOT NULL,
    project_id TEXT REFERENCES metadata_projects(id),
    labels TEXT[] DEFAULT '{}',
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (domain, id)
);

CREATE INDEX IF NOT EXISTS idx_metadata_records_project ON metadata_records(project_id);
CREATE INDEX IF NOT EXISTS idx_metadata_records_domain ON metadata_records(domain);
CREATE INDEX IF NOT EXISTS idx_metadata_records_labels ON metadata_records USING GIN(labels);

-- =============================================================================
-- ENDPOINTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS metadata_endpoints (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    source_id TEXT,
    project_id TEXT REFERENCES metadata_projects(id),
    name TEXT NOT NULL,
    description TEXT,
    verb TEXT NOT NULL DEFAULT 'POST',
    url TEXT NOT NULL,
    auth_policy TEXT,
    domain TEXT,
    labels TEXT[] DEFAULT '{}',
    config JSONB DEFAULT '{}',
    detected_version TEXT,
    version_hint TEXT,
    capabilities TEXT[] DEFAULT '{}',
    delegated_connected BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    deletion_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_metadata_endpoints_project ON metadata_endpoints(project_id);
CREATE INDEX IF NOT EXISTS idx_metadata_endpoints_source ON metadata_endpoints(source_id);
CREATE INDEX IF NOT EXISTS idx_metadata_endpoints_domain ON metadata_endpoints(domain);

-- =============================================================================
-- COLLECTIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS metadata_collections (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    endpoint_id TEXT NOT NULL REFERENCES metadata_endpoints(id) ON DELETE CASCADE,
    schedule_cron TEXT,
    schedule_timezone TEXT NOT NULL DEFAULT 'UTC',
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    temporal_schedule_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metadata_collections_endpoint ON metadata_collections(endpoint_id);

-- =============================================================================
-- COLLECTION RUNS
-- =============================================================================

CREATE TYPE metadata_collection_run_status AS ENUM (
    'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED'
);

CREATE TABLE IF NOT EXISTS metadata_collection_runs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    endpoint_id TEXT NOT NULL REFERENCES metadata_endpoints(id) ON DELETE CASCADE,
    collection_id TEXT REFERENCES metadata_collections(id) ON DELETE SET NULL,
    status metadata_collection_run_status NOT NULL DEFAULT 'QUEUED',
    requested_by TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    workflow_id TEXT,
    temporal_run_id TEXT,
    error TEXT,
    filters JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_collection_runs_endpoint ON metadata_collection_runs(endpoint_id);
CREATE INDEX IF NOT EXISTS idx_collection_runs_collection ON metadata_collection_runs(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_runs_status ON metadata_collection_runs(status);
CREATE INDEX IF NOT EXISTS idx_collection_runs_requested_at ON metadata_collection_runs(requested_at DESC);

-- =============================================================================
-- INGESTION UNIT CONFIGS
-- =============================================================================

CREATE TABLE IF NOT EXISTS ingestion_unit_configs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    endpoint_id TEXT NOT NULL REFERENCES metadata_endpoints(id) ON DELETE CASCADE,
    dataset_id TEXT NOT NULL,
    unit_id TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    run_mode TEXT NOT NULL DEFAULT 'auto',
    mode TEXT NOT NULL DEFAULT 'incremental',
    sink_id TEXT NOT NULL DEFAULT 'kb',
    sink_endpoint_id TEXT REFERENCES metadata_endpoints(id),
    schedule_kind TEXT NOT NULL DEFAULT 'manual',
    schedule_interval_minutes INTEGER,
    policy JSONB DEFAULT '{}',
    filter JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(endpoint_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_ingestion_configs_endpoint ON ingestion_unit_configs(endpoint_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_configs_dataset ON ingestion_unit_configs(dataset_id);

-- =============================================================================
-- INGESTION UNIT STATE
-- =============================================================================

CREATE TYPE ingestion_state AS ENUM (
    'IDLE', 'RUNNING', 'PAUSED', 'FAILED', 'SUCCEEDED'
);

CREATE TABLE IF NOT EXISTS ingestion_unit_states (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    endpoint_id TEXT NOT NULL REFERENCES metadata_endpoints(id) ON DELETE CASCADE,
    unit_id TEXT NOT NULL,
    sink_id TEXT NOT NULL,
    state ingestion_state NOT NULL DEFAULT 'IDLE',
    last_run_id TEXT,
    last_run_at TIMESTAMPTZ,
    last_error TEXT,
    stats JSONB DEFAULT '{}',
    checkpoint JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(endpoint_id, unit_id, sink_id)
);

CREATE INDEX IF NOT EXISTS idx_ingestion_states_endpoint ON ingestion_unit_states(endpoint_id);

-- =============================================================================
-- INGESTION CHECKPOINTS (for optimistic locking)
-- =============================================================================

CREATE TABLE IF NOT EXISTS ingestion_checkpoints (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    endpoint_id TEXT NOT NULL,
    unit_id TEXT NOT NULL,
    sink_id TEXT NOT NULL,
    vendor TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(endpoint_id, unit_id, sink_id, vendor)
);

-- =============================================================================
-- TRANSIENT STATE
-- =============================================================================

CREATE TABLE IF NOT EXISTS ingestion_transient_states (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    endpoint_id TEXT NOT NULL,
    unit_id TEXT NOT NULL,
    sink_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    state JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(endpoint_id, unit_id, sink_id)
);

-- =============================================================================
-- GRAPH NODES
-- =============================================================================

CREATE TABLE IF NOT EXISTS graph_nodes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    tenant_id TEXT NOT NULL,
    project_id TEXT,
    entity_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    canonical_path TEXT,
    source_system TEXT,
    spec_ref TEXT,
    properties JSONB NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    phase TEXT,
    logical_key TEXT NOT NULL,
    external_id JSONB DEFAULT '{}',
    provenance JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, logical_key)
);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_tenant ON graph_nodes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(entity_type);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_project ON graph_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_logical_key ON graph_nodes(logical_key);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_properties ON graph_nodes USING GIN(properties);

-- =============================================================================
-- GRAPH EDGES
-- =============================================================================

CREATE TABLE IF NOT EXISTS graph_edges (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    tenant_id TEXT NOT NULL,
    project_id TEXT,
    edge_type TEXT NOT NULL,
    source_entity_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    target_entity_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    confidence DOUBLE PRECISION,
    spec_ref TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    logical_key TEXT NOT NULL,
    source_logical_key TEXT NOT NULL,
    target_logical_key TEXT NOT NULL,
    provenance JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, logical_key)
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_tenant ON graph_edges(tenant_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON graph_edges(edge_type);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_logical ON graph_edges(source_logical_key, target_logical_key);

-- =============================================================================
-- ENDPOINT TEMPLATES (cache from Python registry)
-- =============================================================================

CREATE TABLE IF NOT EXISTS endpoint_templates (
    id TEXT PRIMARY KEY,
    family TEXT NOT NULL,
    title TEXT NOT NULL,
    vendor TEXT NOT NULL,
    description TEXT,
    domain TEXT,
    categories TEXT[] DEFAULT '{}',
    protocols TEXT[] DEFAULT '{}',
    versions TEXT[] DEFAULT '{}',
    default_port INTEGER,
    driver TEXT,
    docs_url TEXT,
    agent_prompt TEXT,
    default_labels TEXT[] DEFAULT '{}',
    fields JSONB NOT NULL DEFAULT '[]',
    capabilities JSONB NOT NULL DEFAULT '[]',
    sample_config JSONB DEFAULT '{}',
    connection JSONB DEFAULT '{}',
    descriptor_version TEXT,
    min_version TEXT,
    max_version TEXT,
    probing JSONB DEFAULT '{}',
    extras JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_endpoint_templates_family ON endpoint_templates(family);
CREATE INDEX IF NOT EXISTS idx_endpoint_templates_vendor ON endpoint_templates(vendor);

-- =============================================================================
-- ONEDRIVE AUTH SESSIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS onedrive_auth_sessions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    endpoint_id TEXT NOT NULL REFERENCES metadata_endpoints(id) ON DELETE CASCADE,
    state TEXT NOT NULL UNIQUE,
    code_verifier TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_onedrive_sessions_state ON onedrive_auth_sessions(state);

-- =============================================================================
-- ONEDRIVE DELEGATED TOKENS
-- =============================================================================

CREATE TABLE IF NOT EXISTS onedrive_delegated_tokens (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    endpoint_id TEXT NOT NULL UNIQUE REFERENCES metadata_endpoints(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
