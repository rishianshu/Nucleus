// Package cdm provides Common Data Model entities for UCL.
// CDM defines canonical schemas for semantic sinks and analytics.
package cdm

import "time"

// CDM Model IDs (constants for referencing)
const (
	// Work domain model IDs
	ModelWorkProject = "cdm.work.project"
	ModelWorkUser    = "cdm.work.user"
	ModelWorkItem    = "cdm.work.item"
	ModelWorkComment = "cdm.work.comment"
	ModelWorkLog     = "cdm.work.worklog"

	// Docs domain model IDs
	ModelDocSpace    = "cdm.doc.space"
	ModelDocItem     = "cdm.doc.item"
	ModelDocRevision = "cdm.doc.revision"
	ModelDocLink     = "cdm.doc.link"
)

// =============================================================================
// WORK DOMAIN - Projects, Issues, Users
// Source: Jira, Azure DevOps, Linear, etc.
// =============================================================================

// WorkProject represents a project in the work domain.
// ID format: cdm:work:project:<source_system>:<native_key>
type WorkProject struct {
	CdmID            string
	SourceSystem     string
	SourceProjectKey string
	Name             string
	Description      string
	URL              string
	Properties       map[string]any
}

// WorkUser represents a user in the work domain.
// ID format: cdm:work:user:<source_system>:<account_id>
type WorkUser struct {
	CdmID        string
	SourceSystem string
	SourceUserID string
	DisplayName  string
	Email        string
	Active       bool
	Properties   map[string]any
}

// WorkItem represents a task/issue/epic.
// ID format: cdm:work:item:<source_system>:<issue_key>
type WorkItem struct {
	CdmID          string
	SourceSystem   string
	SourceIssueKey string
	ProjectCdmID   string
	ReporterCdmID  string
	AssigneeCdmID  string
	IssueType      string
	Status         string
	StatusCategory string
	Priority       string
	Summary        string
	Description    string
	Labels         []string
	CreatedAt      *time.Time
	UpdatedAt      *time.Time
	ClosedAt       *time.Time
	Properties     map[string]any
}

// WorkComment represents a comment on a work item.
// ID format: cdm:work:comment:<source_system>:<issue_key>:<comment_id>
type WorkComment struct {
	CdmID           string
	SourceSystem    string
	SourceCommentID string
	ItemCdmID       string
	AuthorCdmID     string
	Body            string
	CreatedAt       *time.Time
	UpdatedAt       *time.Time
	Visibility      string
	Properties      map[string]any
}

// WorkLog represents time tracking on a work item.
// ID format: cdm:work:worklog:<source_system>:<issue_key>:<worklog_id>
type WorkLog struct {
	CdmID            string
	SourceSystem     string
	SourceWorklogID  string
	ItemCdmID        string
	AuthorCdmID      string
	StartedAt        *time.Time
	TimeSpentSeconds int
	Comment          string
	Visibility       string
	Properties       map[string]any
}

// =============================================================================
// DOCS DOMAIN - Spaces, Documents, Revisions
// Source: Confluence, SharePoint, Notion, etc.
// =============================================================================

// DocSpace represents a document space/container.
// ID format: cdm:doc:space:<source_system>:<space_id>
type DocSpace struct {
	CdmID         string
	SourceSystem  string
	SourceSpaceID string
	Key           string
	Name          string
	Description   string
	URL           string
	Properties    map[string]any
}

// DocItem represents a document/page/file.
// ID format: cdm:doc:item:<source_system>:<item_id>
type DocItem struct {
	CdmID             string
	SourceSystem      string
	SourceItemID      string
	SpaceCdmID        string
	ParentItemCdmID   string
	Title             string
	DocType           string
	MimeType          string
	CreatedByCdmID    string
	UpdatedByCdmID    string
	CreatedAt         *time.Time
	UpdatedAt         *time.Time
	URL               string
	Tags              []string
	Properties        map[string]any
}

// DocRevision represents a document version/revision.
// ID format: cdm:doc:revision:<source_system>:<revision_id>
type DocRevision struct {
	CdmID            string
	SourceSystem     string
	SourceRevisionID string
	ItemCdmID        string
	RevisionNumber   int
	RevisionLabel    string
	AuthorCdmID      string
	CreatedAt        *time.Time
	Summary          string
	Properties       map[string]any
}

// DocLink represents a link between documents.
// ID format: cdm:doc:link:<source_system>:<link_id>
type DocLink struct {
	CdmID          string
	SourceSystem   string
	SourceLinkID   string
	FromItemCdmID  string
	ToItemCdmID    string
	URL            string
	LinkType       string
	CreatedAt      *time.Time
	Properties     map[string]any
}
