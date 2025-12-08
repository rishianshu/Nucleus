package http

import (
	"encoding/base64"
	"net/http"
)

// =============================================================================
// AUTHENTICATION STRATEGIES
// =============================================================================

// AuthConfig represents authentication configuration.
type AuthConfig interface {
	Apply(req *http.Request)
}

// NoAuth represents no authentication.
type NoAuth struct{}

func (a NoAuth) Apply(req *http.Request) {}

// BasicAuth uses HTTP Basic Authentication.
type BasicAuth struct {
	Username string
	Password string
}

// Apply adds Basic auth header to the request.
func (a BasicAuth) Apply(req *http.Request) {
	if a.Username == "" && a.Password == "" {
		return
	}
	credentials := base64.StdEncoding.EncodeToString([]byte(a.Username + ":" + a.Password))
	req.Header.Set("Authorization", "Basic "+credentials)
}

// BearerToken uses Bearer token authentication.
type BearerToken struct {
	Token string
}

// Apply adds Bearer token header to the request.
func (a BearerToken) Apply(req *http.Request) {
	if a.Token == "" {
		return
	}
	req.Header.Set("Authorization", "Bearer "+a.Token)
}

// APIKey uses API key authentication.
type APIKey struct {
	Key    string
	Header string // Header name (default: X-API-Key)
}

// Apply adds API key header to the request.
func (a APIKey) Apply(req *http.Request) {
	if a.Key == "" {
		return
	}
	header := a.Header
	if header == "" {
		header = "X-API-Key"
	}
	req.Header.Set(header, a.Key)
}

// AtlassianAuth uses Atlassian-style Basic Auth (email:token).
// This is used by Jira Cloud, Confluence Cloud, etc.
type AtlassianAuth struct {
	Email    string
	APIToken string
}

// Apply adds Atlassian auth header to the request.
func (a AtlassianAuth) Apply(req *http.Request) {
	if a.Email == "" || a.APIToken == "" {
		return
	}
	credentials := base64.StdEncoding.EncodeToString([]byte(a.Email + ":" + a.APIToken))
	req.Header.Set("Authorization", "Basic "+credentials)
}
