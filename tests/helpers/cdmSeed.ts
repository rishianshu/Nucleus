import { Pool } from "pg";

let seeded = false;
const SEEDED_ENDPOINT_ID = "seeded-endpoint";

function buildSeedProperties(datasetId: string) {
  return JSON.stringify({
    _metadata: {
      sourceDatasetId: datasetId,
      sourceEndpointId: SEEDED_ENDPOINT_ID,
    },
  });
}

export async function seedCdmData() {
  if (seeded) {
    return;
  }
  const connectionUrl = process.env.CDM_WORK_DATABASE_URL ?? process.env.METADATA_DATABASE_URL;
  if (!connectionUrl) {
    console.warn("[cdm-seed] Missing CDM_WORK_DATABASE_URL or METADATA_DATABASE_URL; skipping seed.");
    return;
  }
  const schema = process.env.CDM_WORK_DATABASE_SCHEMA ?? "cdm_work";
  const prefix = process.env.CDM_WORK_DATABASE_TABLE_PREFIX ?? "cdm_";
  const pool = new Pool({ connectionString: connectionUrl });
  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await createTables(pool, schema, prefix);
    await insertSeedRows(pool, schema, prefix);
    seeded = true;
  } finally {
    await pool.end().catch(() => {});
  }
}

async function createTables(pool: Pool, schema: string, prefix: string) {
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."${prefix}work_project" (
    cdm_id TEXT PRIMARY KEY,
    source_system TEXT NOT NULL,
    source_project_key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."${prefix}work_user" (
    cdm_id TEXT PRIMARY KEY,
    display_name TEXT,
    email TEXT
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."${prefix}work_item" (
    cdm_id TEXT PRIMARY KEY,
    source_system TEXT NOT NULL,
    source_issue_key TEXT NOT NULL,
    project_cdm_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT,
    priority TEXT,
    assignee_cdm_id TEXT,
    reporter_cdm_id TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."${prefix}work_comment" (
    cdm_id TEXT PRIMARY KEY,
    item_cdm_id TEXT NOT NULL,
    author_cdm_id TEXT,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}"."${prefix}work_worklog" (
    cdm_id TEXT PRIMARY KEY,
    item_cdm_id TEXT NOT NULL,
    author_cdm_id TEXT,
    started_at TIMESTAMPTZ,
    time_spent_seconds INTEGER,
    comment TEXT
  )`);
}

async function insertSeedRows(pool: Pool, schema: string, prefix: string) {
  const projectId = "cdm:work:project:seed:ENG";
  const reporterId = "cdm:work:user:seed:reporter";
  const assigneeId = "cdm:work:user:seed:assignee";
  const itemId = "cdm:work:item:seed:ENG-1";
  const commentId = "cdm:work:comment:seed:ENG-1:1";
  const worklogId = "cdm:work:worklog:seed:ENG-1:1";

  // Keep the seed deterministic by clearing any previous CDM work rows that may have been
  // created by earlier test runs or manual ingestion checks.
  await pool.query(`DELETE FROM "${schema}"."${prefix}work_worklog"`);
  await pool.query(`DELETE FROM "${schema}"."${prefix}work_comment"`);
  await pool.query(`DELETE FROM "${schema}"."${prefix}work_item"`);
  await pool.query(`DELETE FROM "${schema}"."${prefix}work_project"`);
  await pool.query(`DELETE FROM "${schema}"."${prefix}work_user"`);

  await pool.query(
    `INSERT INTO "${schema}"."${prefix}work_project" (cdm_id, source_system, source_project_key, name, description, url, properties)
     VALUES ($1, 'jira', 'ENG', 'Seed Engineering', 'Seeded project for CDM explorer', NULL, $2::jsonb)
     ON CONFLICT (cdm_id) DO UPDATE SET name = EXCLUDED.name, properties = EXCLUDED.properties`,
    [projectId, buildSeedProperties("jira.projects")],
  );
  await pool.query(
    `INSERT INTO "${schema}"."${prefix}work_user" (cdm_id, source_system, source_user_id, display_name, email, active, properties)
     VALUES ($1, 'jira', 'seed-reporter', 'Seed Reporter', 'reporter@example.com', true, $2::jsonb)
     ON CONFLICT (cdm_id) DO UPDATE SET display_name = EXCLUDED.display_name, properties = EXCLUDED.properties`,
    [reporterId, buildSeedProperties("jira.users")],
  );
  await pool.query(
    `INSERT INTO "${schema}"."${prefix}work_user" (cdm_id, source_system, source_user_id, display_name, email, active, properties)
     VALUES ($1, 'jira', 'seed-assignee', 'Seed Assignee', 'assignee@example.com', true, $2::jsonb)
     ON CONFLICT (cdm_id) DO UPDATE SET display_name = EXCLUDED.display_name, properties = EXCLUDED.properties`,
    [assigneeId, buildSeedProperties("jira.users")],
  );
  await pool.query(
    `INSERT INTO "${schema}"."${prefix}work_item" (cdm_id, source_system, source_issue_key, project_cdm_id, summary, status, priority, assignee_cdm_id, reporter_cdm_id, created_at, updated_at, closed_at, properties)
     VALUES ($1, 'jira', 'ENG-1', $2, 'Seeded issue summary', 'In Progress', 'High', $3, $4, NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 day', NULL, $5::jsonb)
     ON CONFLICT (cdm_id) DO UPDATE SET summary = EXCLUDED.summary, status = EXCLUDED.status, priority = EXCLUDED.priority, properties = EXCLUDED.properties`,
    [itemId, projectId, assigneeId, reporterId, buildSeedProperties("jira.issues")],
  );
  await pool.query(
    `INSERT INTO "${schema}"."${prefix}work_comment" (cdm_id, source_system, item_cdm_id, author_cdm_id, body, created_at, properties)
     VALUES ($1, 'jira', $2, $3, 'Seeded comment body', NOW() - INTERVAL '12 hours', $4::jsonb)
     ON CONFLICT (cdm_id) DO UPDATE SET body = EXCLUDED.body, source_system = EXCLUDED.source_system, properties = EXCLUDED.properties`,
    [commentId, itemId, reporterId, buildSeedProperties("jira.comments")],
  );
  await pool.query(
    `INSERT INTO "${schema}"."${prefix}work_worklog" (cdm_id, source_system, item_cdm_id, author_cdm_id, started_at, time_spent_seconds, comment, properties)
     VALUES ($1, 'jira', $2, $3, NOW() - INTERVAL '6 hours', 5400, 'Seeded implementation work', $4::jsonb)
     ON CONFLICT (cdm_id) DO UPDATE SET time_spent_seconds = EXCLUDED.time_spent_seconds, source_system = EXCLUDED.source_system, properties = EXCLUDED.properties`,
    [worklogId, itemId, assigneeId, buildSeedProperties("jira.worklogs")],
  );
}
