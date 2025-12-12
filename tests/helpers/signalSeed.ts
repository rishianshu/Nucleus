import { Pool } from "pg";

let seededSignals = false;

export async function seedSignalData() {
  if (seededSignals) {
    return;
  }
  const connectionUrl =
    process.env.METADATA_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5434/postgres?schema=metadata";
  const pool = new Pool({ connectionString: connectionUrl, max: 2 });
  try {
    const definitionResult = await pool.query<{ id: string }>(
      `
        INSERT INTO metadata.signal_definitions (
          slug,
          title,
          description,
          status,
          impl_mode,
          source_family,
          entity_kind,
          policy_kind,
          severity,
          tags,
          cdm_model_id,
          owner,
          definition_spec
        )
        VALUES ($1, $2, $3, 'ACTIVE', 'DSL', 'jira', 'WORK_ITEM', 'FRESHNESS', 'WARNING', ARRAY['seed'], 'cdm.work.item', 'signal-tests', '{}'::jsonb)
        ON CONFLICT (slug) DO UPDATE SET
          title = EXCLUDED.title,
          source_family = EXCLUDED.source_family,
          entity_kind = EXCLUDED.entity_kind,
          policy_kind = EXCLUDED.policy_kind,
          severity = EXCLUDED.severity
        RETURNING id
      `,
      [
        "signals.seeded.eng1",
        "Seeded ENG-1 signal",
        "Seeded signal instance for CDM work item ENG-1",
      ],
    );
    const definitionId = definitionResult.rows[0]?.id;
    if (!definitionId) {
      throw new Error("Failed to seed signal definition");
    }
    await pool.query(
      `
        INSERT INTO metadata.signal_instances (
          definition_id,
          status,
          entity_ref,
          entity_kind,
          severity,
          summary,
          details,
          first_seen_at,
          last_seen_at,
          source_run_id
        )
        VALUES ($1, 'OPEN', $2, 'WORK_ITEM', 'WARNING', $3, $4::jsonb, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', 'seeded-signals')
        ON CONFLICT DO NOTHING
      `,
      [
        definitionId,
        "cdm.work.item:cdm:work:item:seed:ENG-1",
        "Seeded signal on ENG-1",
        JSON.stringify({ reason: "seeded" }),
      ],
    );
    seededSignals = true;
  } finally {
    await pool.end().catch(() => {});
  }
}
