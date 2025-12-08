package jira

import (
	"time"

	"github.com/nucleus/ucl-core/internal/core/cdm"
	"github.com/nucleus/ucl-core/internal/endpoint"
)

// =============================================================================
// CDM MAPPER
// Optional mapper that converts Jira records to CDM entities.
// Only applied if the orchestrator opts-in based on cdm_model_id.
// =============================================================================

// CDMMapper converts Jira records to CDM work entities.
type CDMMapper struct {
	SourceSystem string
}

// NewCDMMapper creates a new CDM mapper.
func NewCDMMapper() *CDMMapper {
	return &CDMMapper{SourceSystem: "jira"}
}

// SupportsDataset returns true if the dataset has CDM mapping.
func (m *CDMMapper) SupportsDataset(datasetID string) bool {
	def, ok := DatasetDefinitions[datasetID]
	return ok && def.CdmModelID != ""
}

// GetCDMModelID returns the CDM model ID for a dataset.
func (m *CDMMapper) GetCDMModelID(datasetID string) string {
	if def, ok := DatasetDefinitions[datasetID]; ok {
		return def.CdmModelID
	}
	return ""
}

// MapRecord converts a Jira record to a CDM entity.
// Returns the CDM entity (for ToRecord()) or nil if not mappable.
func (m *CDMMapper) MapRecord(datasetID string, record endpoint.Record) any {
	raw := record["_raw"]
	if raw == nil {
		return nil
	}

	switch datasetID {
	case "jira.projects":
		if p, ok := raw.(*Project); ok {
			return m.mapProject(p)
		}
	case "jira.users":
		if u, ok := raw.(*User); ok {
			return m.mapUser(u)
		}
	case "jira.issues":
		if i, ok := raw.(*Issue); ok {
			return m.mapIssue(i)
		}
	case "jira.comments":
		if c, ok := raw.(*Comment); ok {
			issueKey, _ := record["issueKey"].(string)
			return m.mapComment(c, issueKey)
		}
	case "jira.worklogs":
		if w, ok := raw.(*Worklog); ok {
			issueKey, _ := record["issueKey"].(string)
			return m.mapWorklog(w, issueKey)
		}
	}
	return nil
}

// =============================================================================
// MAPPING FUNCTIONS
// =============================================================================

func (m *CDMMapper) mapProject(p *Project) *cdm.WorkProject {
	props := map[string]any{
		"projectType": p.ProjectTypeKey,
		"raw":         p,
	}
	if p.Lead != nil {
		props["lead"] = p.Lead.DisplayName
	}
	if p.Category != nil {
		props["category"] = p.Category.Name
	}

	return &cdm.WorkProject{
		CdmID:            cdm.WorkProjectID(m.SourceSystem, p.Key),
		SourceSystem:     m.SourceSystem,
		SourceProjectKey: p.Key,
		Name:             p.Name,
		Description:      p.Description,
		URL:              p.Self,
		Properties:       props,
	}
}

func (m *CDMMapper) mapUser(u *User) *cdm.WorkUser {
	if u == nil {
		return nil
	}

	return &cdm.WorkUser{
		CdmID:        cdm.WorkUserID(m.SourceSystem, u.AccountID),
		SourceSystem: m.SourceSystem,
		SourceUserID: u.AccountID,
		DisplayName:  u.DisplayName,
		Email:        u.EmailAddress,
		Active:       u.Active,
		Properties: map[string]any{
			"timeZone":    u.TimeZone,
			"accountType": u.AccountType,
			"raw":         u,
		},
	}
}

func (m *CDMMapper) mapIssue(issue *Issue) *cdm.WorkItem {
	fields := issue.Fields

	projectCdmID := ""
	if fields.Project != nil {
		projectCdmID = cdm.WorkProjectID(m.SourceSystem, fields.Project.Key)
	}

	reporterCdmID := ""
	if fields.Reporter != nil {
		reporterCdmID = cdm.WorkUserID(m.SourceSystem, fields.Reporter.AccountID)
	}

	assigneeCdmID := ""
	if fields.Assignee != nil {
		assigneeCdmID = cdm.WorkUserID(m.SourceSystem, fields.Assignee.AccountID)
	}

	issueType := ""
	if fields.IssueType != nil {
		issueType = fields.IssueType.Name
	}

	status := ""
	statusCategory := ""
	if fields.Status != nil {
		status = fields.Status.Name
		if fields.Status.StatusCategory != nil {
			statusCategory = fields.Status.StatusCategory.Name
		}
	}

	priority := ""
	if fields.Priority != nil {
		priority = fields.Priority.Name
	}

	return &cdm.WorkItem{
		CdmID:          cdm.WorkItemID(m.SourceSystem, issue.Key),
		SourceSystem:   m.SourceSystem,
		SourceIssueKey: issue.Key,
		ProjectCdmID:   projectCdmID,
		ReporterCdmID:  reporterCdmID,
		AssigneeCdmID:  assigneeCdmID,
		IssueType:      issueType,
		Status:         status,
		StatusCategory: statusCategory,
		Priority:       priority,
		Summary:        fields.Summary,
		Description:    descriptionToString(fields.Description),
		Labels:         fields.Labels,
		CreatedAt:      parseJiraTime(fields.Created),
		UpdatedAt:      parseJiraTime(fields.Updated),
		ClosedAt:       parseJiraTime(fields.ResolutionDate),
		Properties: map[string]any{
			"rawFields": fields,
			"raw":       issue,
		},
	}
}

func (m *CDMMapper) mapComment(c *Comment, issueKey string) *cdm.WorkComment {
	authorCdmID := ""
	if c.Author != nil {
		authorCdmID = cdm.WorkUserID(m.SourceSystem, c.Author.AccountID)
	}

	visibility := ""
	if c.Visibility != nil {
		visibility = c.Visibility.Value
	}

	itemCdmID := cdm.WorkItemID(m.SourceSystem, issueKey)

	return &cdm.WorkComment{
		CdmID:           cdm.WorkCommentID(m.SourceSystem, issueKey, c.ID),
		SourceSystem:    m.SourceSystem,
		SourceCommentID: c.ID,
		ItemCdmID:       itemCdmID,
		AuthorCdmID:     authorCdmID,
		Body:            bodyToString(c.Body),
		CreatedAt:       parseJiraTime(c.Created),
		UpdatedAt:       parseJiraTime(c.Updated),
		Visibility:      visibility,
		Properties:      map[string]any{"raw": c},
	}
}

func (m *CDMMapper) mapWorklog(w *Worklog, issueKey string) *cdm.WorkLog {
	authorCdmID := ""
	if w.Author != nil {
		authorCdmID = cdm.WorkUserID(m.SourceSystem, w.Author.AccountID)
	}

	visibility := ""
	if w.Visibility != nil {
		visibility = w.Visibility.Value
	}

	itemCdmID := cdm.WorkItemID(m.SourceSystem, issueKey)

	return &cdm.WorkLog{
		CdmID:            cdm.WorkLogID(m.SourceSystem, issueKey, w.ID),
		SourceSystem:     m.SourceSystem,
		SourceWorklogID:  w.ID,
		ItemCdmID:        itemCdmID,
		AuthorCdmID:      authorCdmID,
		StartedAt:        parseJiraTime(w.Started),
		TimeSpentSeconds: w.TimeSpentSeconds,
		Comment:          bodyToString(w.Comment),
		Visibility:       visibility,
		Properties:       map[string]any{"raw": w},
	}
}

// =============================================================================
// HELPERS
// =============================================================================

func parseJiraTime(s string) *time.Time {
	if s == "" {
		return nil
	}
	layouts := []string{
		"2006-01-02T15:04:05.000-0700",
		"2006-01-02T15:04:05.000Z",
		"2006-01-02T15:04:05-0700",
		"2006-01-02T15:04:05Z",
		time.RFC3339,
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return &t
		}
	}
	return nil
}

func descriptionToString(desc any) string {
	if desc == nil {
		return ""
	}
	if s, ok := desc.(string); ok {
		return s
	}
	return "[ADF content]"
}
