-- Remove legacy seed datasets that shipped with the initial console bootstrap.
DELETE FROM "MetadataRecord"
WHERE "domain" = 'catalog.dataset'
  AND (payload->>'id') IN (
    'jira_issues_summary',
    'daily_summary_metrics',
    'project_health_trends',
    'sprint_velocity_summary',
    'incident_response_digest',
    'engineer_focus_matrix'
  );
