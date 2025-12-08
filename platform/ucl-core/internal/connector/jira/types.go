package jira

// Config holds Jira connection configuration.
type Config struct {
	// BaseURL is the Jira instance URL (e.g., https://yoursite.atlassian.net)
	BaseURL string `json:"baseUrl"`

	// Email is the user's email for authentication
	Email string `json:"email"`

	// APIToken is the Atlassian API token
	APIToken string `json:"apiToken"`

	// Projects is an optional list of project keys to filter
	Projects []string `json:"projects,omitempty"`

	// JQL is an optional JQL filter for issues
	JQL string `json:"jql,omitempty"`

	// FetchSize is the number of records per API request
	FetchSize int `json:"fetchSize,omitempty"`
}

// DefaultFetchSize is the default number of records per request.
const DefaultFetchSize = 100

// MaxFetchSize is the Jira API hard limit.
const MaxFetchSize = 100

// Validate validates the configuration.
func (c *Config) Validate() error {
	if c.BaseURL == "" {
		return &ValidationError{Field: "baseUrl", Message: "required"}
	}
	if c.Email == "" {
		return &ValidationError{Field: "email", Message: "required"}
	}
	if c.APIToken == "" {
		return &ValidationError{Field: "apiToken", Message: "required"}
	}
	if c.FetchSize <= 0 {
		c.FetchSize = DefaultFetchSize
	}
	// Jira API has hard limit of 100
	if c.FetchSize > MaxFetchSize {
		c.FetchSize = MaxFetchSize
	}
	return nil
}

// ValidationError represents a configuration validation error.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return e.Field + ": " + e.Message
}

// =============================================================================
// JIRA API RESPONSE TYPES
// =============================================================================

// Project represents a Jira project.
type Project struct {
	ID             string            `json:"id"`
	Key            string            `json:"key"`
	Name           string            `json:"name"`
	Description    string            `json:"description,omitempty"`
	ProjectTypeKey string            `json:"projectTypeKey,omitempty"`
	Self           string            `json:"self"`
	Lead           *User             `json:"lead,omitempty"`
	Category       *ProjectCategory  `json:"projectCategory,omitempty"`
}

// ProjectCategory represents a project category.
type ProjectCategory struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// User represents a Jira user.
type User struct {
	AccountID    string `json:"accountId"`
	DisplayName  string `json:"displayName"`
	EmailAddress string `json:"emailAddress,omitempty"`
	Active       bool   `json:"active"`
	TimeZone     string `json:"timeZone,omitempty"`
	AccountType  string `json:"accountType,omitempty"`
	Self         string `json:"self"`
}

// Issue represents a Jira issue.
type Issue struct {
	ID     string      `json:"id"`
	Key    string      `json:"key"`
	Self   string      `json:"self"`
	Fields IssueFields `json:"fields"`
}

// IssueFields contains issue field values.
type IssueFields struct {
	Summary        string        `json:"summary"`
	Description    any           `json:"description,omitempty"`
	Status         *Status       `json:"status,omitempty"`
	Priority       *Priority     `json:"priority,omitempty"`
	IssueType      *IssueType    `json:"issuetype,omitempty"`
	Project        *Project      `json:"project,omitempty"`
	Reporter       *User         `json:"reporter,omitempty"`
	Assignee       *User         `json:"assignee,omitempty"`
	Labels         []string      `json:"labels,omitempty"`
	Created        string        `json:"created,omitempty"`
	Updated        string        `json:"updated,omitempty"`
	ResolutionDate string        `json:"resolutiondate,omitempty"`
}

// Status represents an issue status.
type Status struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	StatusCategory *StatusCategory `json:"statusCategory,omitempty"`
}

// StatusCategory represents a status category.
type StatusCategory struct {
	ID   int    `json:"id"`
	Key  string `json:"key"`
	Name string `json:"name"`
}

// Priority represents an issue priority.
type Priority struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// IssueType represents an issue type.
type IssueType struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Comment represents an issue comment.
type Comment struct {
	ID         string      `json:"id"`
	Author     *User       `json:"author,omitempty"`
	Body       any         `json:"body,omitempty"`
	Created    string      `json:"created,omitempty"`
	Updated    string      `json:"updated,omitempty"`
	Visibility *Visibility `json:"visibility,omitempty"`
	Self       string      `json:"self"`
}

// Worklog represents time tracking entry.
type Worklog struct {
	ID               string      `json:"id"`
	Author           *User       `json:"author,omitempty"`
	Started          string      `json:"started,omitempty"`
	TimeSpentSeconds int         `json:"timeSpentSeconds"`
	Comment          any         `json:"comment,omitempty"`
	Visibility       *Visibility `json:"visibility,omitempty"`
	Self             string      `json:"self"`
}

// Visibility represents comment/worklog visibility.
type Visibility struct {
	Type  string `json:"type,omitempty"`
	Value string `json:"value,omitempty"`
}

// =============================================================================
// SEARCH RESPONSE
// =============================================================================

// SearchResult represents a JQL search response.
type SearchResult struct {
	StartAt    int      `json:"startAt"`
	MaxResults int      `json:"maxResults"`
	Total      int      `json:"total"`
	Issues     []*Issue `json:"issues"`
}

// CommentsResponse represents a comments response.
type CommentsResponse struct {
	StartAt    int        `json:"startAt"`
	MaxResults int        `json:"maxResults"`
	Total      int        `json:"total"`
	Comments   []*Comment `json:"comments"`
}

// WorklogsResponse represents a worklogs response.
type WorklogsResponse struct {
	StartAt    int        `json:"startAt"`
	MaxResults int        `json:"maxResults"`
	Total      int        `json:"total"`
	Worklogs   []*Worklog `json:"worklogs"`
}
