package onedrive

import (
	"fmt"
)

// Config holds OneDrive OAuth 2.0 configuration.
type Config struct {
	ClientID     string // Azure App Client ID
	ClientSecret string // Azure App Client Secret
	TenantID     string // Azure Tenant ID (or "common" for multi-tenant)
	RefreshToken string // OAuth 2.0 refresh token
	DriveID      string // Optional specific drive ID
	RootPath     string // Optional root folder path
}

// ParseConfig extracts configuration from a map.
func ParseConfig(m map[string]any) (*Config, error) {
	cfg := &Config{
		ClientID:     getString(m, "clientId", getString(m, "client_id", "")),
		ClientSecret: getString(m, "clientSecret", getString(m, "client_secret", "")),
		TenantID:     getString(m, "tenantId", getString(m, "tenant_id", "common")),
		RefreshToken: getString(m, "refreshToken", getString(m, "refresh_token", "")),
		DriveID:      getString(m, "driveId", getString(m, "drive_id", "")),
		RootPath:     getString(m, "rootPath", getString(m, "root_path", "/")),
	}

	if cfg.ClientID == "" {
		return nil, fmt.Errorf("clientId is required")
	}
	if cfg.RefreshToken == "" && cfg.ClientSecret == "" {
		return nil, fmt.Errorf("either refreshToken or clientSecret is required")
	}

	return cfg, nil
}

// DriveItem represents a OneDrive file or folder.
type DriveItem struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Size             int64             `json:"size"`
	CreatedDateTime  string            `json:"createdDateTime"`
	ModifiedDateTime string            `json:"lastModifiedDateTime"`
	WebURL           string            `json:"webUrl"`
	File             *FileInfo         `json:"file,omitempty"`
	Folder           *FolderInfo       `json:"folder,omitempty"`
	ParentReference  *ParentReference  `json:"parentReference,omitempty"`
	CreatedBy        *IdentitySet      `json:"createdBy,omitempty"`
	ModifiedBy       *IdentitySet      `json:"modifiedBy,omitempty"`
}

// FileInfo contains file-specific metadata.
type FileInfo struct {
	MimeType string            `json:"mimeType"`
	Hashes   map[string]string `json:"hashes,omitempty"`
}

// FolderInfo contains folder-specific metadata.
type FolderInfo struct {
	ChildCount int `json:"childCount"`
}

// ParentReference contains parent folder information.
type ParentReference struct {
	DriveID string `json:"driveId"`
	ID      string `json:"id"`
	Path    string `json:"path"`
}

// IdentitySet contains user identity information.
type IdentitySet struct {
	User *Identity `json:"user,omitempty"`
}

// Identity contains user details.
type Identity struct {
	DisplayName string `json:"displayName"`
	Email       string `json:"email,omitempty"`
	ID          string `json:"id"`
}

// ListResponse is the response from listing drive items.
type ListResponse struct {
	Value    []DriveItem `json:"value"`
	NextLink string      `json:"@odata.nextLink"`
}

// DeltaResponse is the response from delta query endpoint.
type DeltaResponse struct {
	Value     []DeltaDriveItem `json:"value"`
	NextLink  string           `json:"@odata.nextLink"`
	DeltaLink string           `json:"@odata.deltaLink"`
}

// DeltaDriveItem extends DriveItem with delete marker for delta queries.
type DeltaDriveItem struct {
	DriveItem
	Deleted *DeletedFacet `json:"deleted,omitempty"`
}

// DeletedFacet indicates an item was deleted.
type DeletedFacet struct {
	State string `json:"state"`
}

// TokenResponse is the OAuth token response.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

// --- Helper functions ---

func getString(m map[string]any, key, defaultVal string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return defaultVal
}
