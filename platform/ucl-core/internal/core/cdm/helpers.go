package cdm

import (
	"fmt"
	"time"
)

// =============================================================================
// CDM ID HELPERS
// Utility functions for generating standardized CDM IDs.
// =============================================================================

// WorkProjectID generates a CDM ID for a work project.
func WorkProjectID(sourceSystem, projectKey string) string {
	return fmt.Sprintf("cdm:work:project:%s:%s", sourceSystem, projectKey)
}

// WorkUserID generates a CDM ID for a work user.
func WorkUserID(sourceSystem, accountID string) string {
	return fmt.Sprintf("cdm:work:user:%s:%s", sourceSystem, accountID)
}

// WorkItemID generates a CDM ID for a work item.
func WorkItemID(sourceSystem, issueKey string) string {
	return fmt.Sprintf("cdm:work:item:%s:%s", sourceSystem, issueKey)
}

// WorkCommentID generates a CDM ID for a work comment.
func WorkCommentID(sourceSystem, issueKey, commentID string) string {
	return fmt.Sprintf("cdm:work:comment:%s:%s:%s", sourceSystem, issueKey, commentID)
}

// WorkLogID generates a CDM ID for a work log.
func WorkLogID(sourceSystem, issueKey, worklogID string) string {
	return fmt.Sprintf("cdm:work:worklog:%s:%s:%s", sourceSystem, issueKey, worklogID)
}

// DocSpaceID generates a CDM ID for a doc space.
func DocSpaceID(sourceSystem, spaceID string) string {
	return fmt.Sprintf("cdm:doc:space:%s:%s", sourceSystem, spaceID)
}

// DocItemID generates a CDM ID for a doc item.
func DocItemID(sourceSystem, itemID string) string {
	return fmt.Sprintf("cdm:doc:item:%s:%s", sourceSystem, itemID)
}

// DocRevisionID generates a CDM ID for a doc revision.
func DocRevisionID(sourceSystem, revisionID string) string {
	return fmt.Sprintf("cdm:doc:revision:%s:%s", sourceSystem, revisionID)
}

// DocLinkID generates a CDM ID for a doc link.
func DocLinkID(sourceSystem, linkID string) string {
	return fmt.Sprintf("cdm:doc:link:%s:%s", sourceSystem, linkID)
}

// =============================================================================
// CDM RECORD CONVERSION
// Helpers for converting CDM entities to generic records.
// =============================================================================

// ToRecord converts a CDM entity to a map for serialization.
func (p *WorkProject) ToRecord() map[string]any {
	return map[string]any{
		"cdm_id":             p.CdmID,
		"source_system":      p.SourceSystem,
		"source_project_key": p.SourceProjectKey,
		"name":               p.Name,
		"description":        p.Description,
		"url":                p.URL,
		"properties":         p.Properties,
	}
}

// ToRecord converts a WorkUser to a map.
func (u *WorkUser) ToRecord() map[string]any {
	return map[string]any{
		"cdm_id":         u.CdmID,
		"source_system":  u.SourceSystem,
		"source_user_id": u.SourceUserID,
		"display_name":   u.DisplayName,
		"email":          u.Email,
		"active":         u.Active,
		"properties":     u.Properties,
	}
}

// ToRecord converts a WorkItem to a map.
func (i *WorkItem) ToRecord() map[string]any {
	rec := map[string]any{
		"cdm_id":           i.CdmID,
		"source_system":    i.SourceSystem,
		"source_issue_key": i.SourceIssueKey,
		"project_cdm_id":   i.ProjectCdmID,
		"reporter_cdm_id":  i.ReporterCdmID,
		"assignee_cdm_id":  i.AssigneeCdmID,
		"issue_type":       i.IssueType,
		"status":           i.Status,
		"status_category":  i.StatusCategory,
		"priority":         i.Priority,
		"summary":          i.Summary,
		"description":      i.Description,
		"labels":           i.Labels,
		"properties":       i.Properties,
	}
	if i.CreatedAt != nil {
		rec["created_at"] = i.CreatedAt.Format(time.RFC3339)
	}
	if i.UpdatedAt != nil {
		rec["updated_at"] = i.UpdatedAt.Format(time.RFC3339)
	}
	if i.ClosedAt != nil {
		rec["closed_at"] = i.ClosedAt.Format(time.RFC3339)
	}
	return rec
}

// ToRecord converts a WorkComment to a map.
func (c *WorkComment) ToRecord() map[string]any {
	rec := map[string]any{
		"cdm_id":            c.CdmID,
		"source_system":     c.SourceSystem,
		"source_comment_id": c.SourceCommentID,
		"item_cdm_id":       c.ItemCdmID,
		"author_cdm_id":     c.AuthorCdmID,
		"body":              c.Body,
		"visibility":        c.Visibility,
		"properties":        c.Properties,
	}
	if c.CreatedAt != nil {
		rec["created_at"] = c.CreatedAt.Format(time.RFC3339)
	}
	if c.UpdatedAt != nil {
		rec["updated_at"] = c.UpdatedAt.Format(time.RFC3339)
	}
	return rec
}

// ToRecord converts a WorkLog to a map.
func (l *WorkLog) ToRecord() map[string]any {
	rec := map[string]any{
		"cdm_id":             l.CdmID,
		"source_system":      l.SourceSystem,
		"source_worklog_id":  l.SourceWorklogID,
		"item_cdm_id":        l.ItemCdmID,
		"author_cdm_id":      l.AuthorCdmID,
		"time_spent_seconds": l.TimeSpentSeconds,
		"comment":            l.Comment,
		"visibility":         l.Visibility,
		"properties":         l.Properties,
	}
	if l.StartedAt != nil {
		rec["started_at"] = l.StartedAt.Format(time.RFC3339)
	}
	return rec
}
