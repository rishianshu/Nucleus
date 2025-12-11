-- Seed DSL-based signal packs for Jira work and Confluence docs

UPDATE "signal_definitions"
SET impl_mode = 'DSL'
WHERE impl_mode IS NULL;

UPDATE "signal_definitions"
SET source_family = COALESCE(source_family, 'generic')
WHERE slug IN ('work.stale_item', 'doc.orphaned');

INSERT INTO "signal_definitions" (
  slug,
  title,
  description,
  status,
  impl_mode,
  source_family,
  entity_kind,
  process_kind,
  policy_kind,
  severity,
  tags,
  cdm_model_id,
  owner,
  definition_spec,
  surface_hints
)
VALUES
  (
    'jira.work.stale_item.default',
    'Jira work items stale',
    'In-progress Jira issues untouched beyond freshness window.',
    'DRAFT',
    'DSL',
    'jira',
    'WORK_ITEM',
    'DELIVERY_FLOW',
    'FRESHNESS',
    'WARNING',
    ARRAY['jira', 'work', 'freshness', 'pack'],
    'cdm.work.item',
    'signals-team',
    jsonb_build_object(
      'version', 1,
      'type', 'cdm.work.stale_item',
      'config', jsonb_build_object(
        'cdmModelId', 'cdm.work.item',
        'maxAge', jsonb_build_object('unit', 'days', 'value', 14),
        'statusExclude', jsonb_build_array('Done', 'Cancelled'),
        'severityMapping', jsonb_build_object(
          'warnAfter', jsonb_build_object('unit', 'days', 'value', 7),
          'errorAfter', jsonb_build_object('unit', 'days', 'value', 14)
        )
      )
    ),
    jsonb_build_object('pack', 'jira.work', 'category', 'health')
  ),
  (
    'jira.work.unassigned_blocker',
    'Jira blockers without owner',
    'Blocker priority issues missing assignee outside done states.',
    'DRAFT',
    'DSL',
    'jira',
    'WORK_ITEM',
    'DELIVERY_FLOW',
    'OWNERSHIP',
    'ERROR',
    ARRAY['jira', 'work', 'ownership', 'pack'],
    'cdm.work.item',
    'signals-team',
    jsonb_build_object(
      'version', 1,
      'type', 'cdm.generic.filter',
      'config', jsonb_build_object(
        'cdmModelId', 'cdm.work.item',
        'where', jsonb_build_array(
          jsonb_build_object('field', 'priority', 'op', 'EQ', 'value', 'Blocker'),
          jsonb_build_object('field', 'assignee', 'op', 'IS_NULL'),
          jsonb_build_object('field', 'status', 'op', 'NOT_IN', 'value', jsonb_build_array('Done', 'Cancelled'))
        ),
        'severityRules', jsonb_build_array(
          jsonb_build_object(
            'when', jsonb_build_array(jsonb_build_object('field', 'priority', 'op', 'EQ', 'value', 'Blocker')),
            'severity', 'ERROR'
          )
        ),
        'summaryTemplate', 'Unassigned blocker {{source_issue_key}}'
      )
    ),
    jsonb_build_object('pack', 'jira.work', 'category', 'health')
  ),
  (
    'jira.work.reopened_often',
    'Jira issues reopened frequently',
    'Issues reopened repeatedly, indicating instability or churn.',
    'DRAFT',
    'DSL',
    'jira',
    'WORK_ITEM',
    'DELIVERY_FLOW',
    'QUALITY',
    'WARNING',
    ARRAY['jira', 'work', 'quality', 'pack'],
    'cdm.work.item',
    'signals-team',
    jsonb_build_object(
      'version', 1,
      'type', 'cdm.generic.filter',
      'config', jsonb_build_object(
        'cdmModelId', 'cdm.work.item',
        'where', jsonb_build_array(
          jsonb_build_object('field', 'properties.reopen_count', 'op', 'GT', 'value', 2)
        ),
        'severityRules', jsonb_build_array(
          jsonb_build_object(
            'when', jsonb_build_array(jsonb_build_object('field', 'properties.reopen_count', 'op', 'GT', 'value', 4)),
            'severity', 'ERROR'
          )
        ),
        'summaryTemplate', '[{{source_issue_key}}] reopened {{properties.reopen_count}} times'
      )
    ),
    jsonb_build_object('pack', 'jira.work', 'category', 'health')
  ),
  (
    'confluence.doc.orphan',
    'Confluence orphaned documents',
    'Documents missing ownership or workspace linkage.',
    'DRAFT',
    'DSL',
    'confluence',
    'DOC',
    'KNOWLEDGE_FLOW',
    'COMPLETENESS',
    'WARNING',
    ARRAY['confluence', 'docs', 'ownership', 'pack'],
    'cdm.doc.item',
    'signals-team',
    jsonb_build_object(
      'version', 1,
      'type', 'cdm.doc.orphan',
      'config', jsonb_build_object(
        'cdmModelId', 'cdm.doc.item',
        'minAge', jsonb_build_object('unit', 'days', 'value', 30),
        'minViewCount', 1,
        'requireProjectLink', true
      )
    ),
    jsonb_build_object('pack', 'confluence.doc', 'category', 'health')
  ),
  (
    'confluence.doc.stale_low_views',
    'Confluence docs stale with low views',
    'Older Confluence documents with limited engagement.',
    'DRAFT',
    'DSL',
    'confluence',
    'DOC',
    'KNOWLEDGE_FLOW',
    'FRESHNESS',
    'WARNING',
    ARRAY['confluence', 'docs', 'freshness', 'pack'],
    'cdm.doc.item',
    'signals-team',
    jsonb_build_object(
      'version', 1,
      'type', 'cdm.generic.filter',
      'config', jsonb_build_object(
        'cdmModelId', 'cdm.doc.item',
        'where', jsonb_build_array(
          jsonb_build_object('field', 'ageDays', 'op', 'GT', 'value', 30),
          jsonb_build_object('field', 'viewCount', 'op', 'LT', 'value', 5)
        ),
        'severityRules', jsonb_build_array(
          jsonb_build_object(
            'when', jsonb_build_array(jsonb_build_object('field', 'viewCount', 'op', 'LT', 'value', 1)),
            'severity', 'ERROR'
          )
        ),
        'summaryTemplate', 'Doc {{title}} stale with {{viewCount}} views'
      )
    ),
    jsonb_build_object('pack', 'confluence.doc', 'category', 'health')
  )
ON CONFLICT (slug) DO NOTHING;
