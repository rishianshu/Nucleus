package confluence

import (
	"fmt"
)

// DefaultFetchSize is the default number of records per API request.
const DefaultFetchSize = 100

// MaxFetchSize is Confluence Cloud API's hard limit.
const MaxFetchSize = 100

// Config holds Confluence Cloud connection settings.
type Config struct {
	BaseURL   string   // e.g., https://yoursite.atlassian.net
	Email     string   // Account email for basic auth
	APIToken  string   // API token for authentication
	Spaces    []string // Optional: limit to specific space keys
	FetchSize int      // Records per request (default 100)
}

// Validate checks configuration completeness and applies defaults.
func (c *Config) Validate() error {
	if c.BaseURL == "" {
		return fmt.Errorf("baseUrl is required")
	}
	if c.Email == "" {
		return fmt.Errorf("email is required")
	}
	if c.APIToken == "" {
		return fmt.Errorf("apiToken is required")
	}
	if c.FetchSize <= 0 {
		c.FetchSize = DefaultFetchSize
	}
	if c.FetchSize > MaxFetchSize {
		c.FetchSize = MaxFetchSize
	}
	return nil
}

// --- API Response Types ---

// SpacesResponse represents the paginated spaces response.
type SpacesResponse struct {
	Results []Space `json:"results"`
	Start   int     `json:"start"`
	Limit   int     `json:"limit"`
	Size    int     `json:"size"`
	Links   *Links  `json:"_links"`
}

// Space represents a Confluence space.
type Space struct {
	ID          int64              `json:"id"`
	Key         string             `json:"key"`
	Name        string             `json:"name"`
	Type        string             `json:"type"`
	Status      string             `json:"status"`
	Description *SpaceDescription  `json:"description"`
	Links       *Links             `json:"_links"`
	Metadata    map[string]any     `json:"metadata"`
}

// SpaceDescription contains space description variants.
type SpaceDescription struct {
	Plain *DescriptionValue `json:"plain"`
	View  *DescriptionValue `json:"view"`
}

// DescriptionValue holds a text value with representation.
type DescriptionValue struct {
	Value          string `json:"value"`
	Representation string `json:"representation"`
}

// ContentResponse represents paginated content (pages/attachments).
type ContentResponse struct {
	Results []Content `json:"results"`
	Start   int       `json:"start"`
	Limit   int       `json:"limit"`
	Size    int       `json:"size"`
	Links   *Links    `json:"_links"`
}

// Content represents a Confluence page, blog post, or attachment.
type Content struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"` // page, blogpost, attachment
	Status     string          `json:"status"`
	Title      string          `json:"title"`
	Space      *SpaceRef       `json:"space"`
	History    *ContentHistory `json:"history"`
	Version    *ContentVersion `json:"version"`
	Ancestors  []ContentRef    `json:"ancestors"`
	Extensions *Extensions     `json:"extensions"`
	Links      *Links          `json:"_links"`
	Metadata   map[string]any  `json:"metadata"`
}

// SpaceRef is a lightweight space reference.
type SpaceRef struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

// ContentHistory contains creation/update metadata.
type ContentHistory struct {
	Latest      bool    `json:"latest"`
	CreatedBy   *User   `json:"createdBy"`
	CreatedDate string  `json:"createdDate"`
	LastUpdated *UpdateInfo `json:"lastUpdated"`
}

// UpdateInfo contains last update metadata.
type UpdateInfo struct {
	By   *User  `json:"by"`
	When string `json:"when"`
}

// ContentVersion contains version information.
type ContentVersion struct {
	Number int    `json:"number"`
	When   string `json:"when"`
	By     *User  `json:"by"`
}

// ContentRef is a lightweight content reference.
type ContentRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// Extensions contains attachment-specific metadata.
type Extensions struct {
	MediaType string `json:"mediaType"`
	FileSize  int64  `json:"fileSize"`
	Comment   string `json:"comment"`
}

// User represents a Confluence user.
type User struct {
	AccountID       string `json:"accountId"`
	AccountType     string `json:"accountType"`
	Email           string `json:"email"`
	PublicName      string `json:"publicName"`
	DisplayName     string `json:"displayName"`
	ProfilePicture  *ProfilePicture `json:"profilePicture"`
}

// ProfilePicture contains user avatar info.
type ProfilePicture struct {
	Path      string `json:"path"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	IsDefault bool   `json:"isDefault"`
}

// Links contains hypermedia links.
type Links struct {
	Base    string `json:"base"`
	Context string `json:"context"`
	Self    string `json:"self"`
	Next    string `json:"next"`
	WebUI   string `json:"webui"`
}

// SystemInfo represents Confluence system information.
type SystemInfo struct {
	CloudID         string `json:"cloudId"`
	BaseURL         string `json:"baseUrl"`
	DatabaseVersion string `json:"databaseVersion"`
}

// CurrentUser represents the authenticated user response.
type CurrentUser struct {
	AccountID    string `json:"accountId"`
	AccountType  string `json:"accountType"`
	Email        string `json:"email"`
	PublicName   string `json:"publicName"`
	DisplayName  string `json:"displayName"`
}
