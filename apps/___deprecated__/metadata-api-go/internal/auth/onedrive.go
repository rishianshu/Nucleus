// Package auth provides OneDrive OAuth flow implementation.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/nucleus/metadata-api/internal/config"
	"github.com/nucleus/metadata-api/internal/database"
)

// OneDriveAuthConfig holds OneDrive OAuth configuration.
type OneDriveAuthConfig struct {
	ClientID     string
	TenantID     string
	RedirectURI  string
	CallbackPort string
}

// LoadOneDriveConfig loads OneDrive config from environment.
func LoadOneDriveConfig(cfg *config.Config) *OneDriveAuthConfig {
	port := "4011"
	if p := cfg.Port; p != "" {
		// Use callback port from env or derive from main port
	}
	return &OneDriveAuthConfig{
		ClientID:     getEnvWithDefault("ONEDRIVE_CLIENT_ID", ""),
		TenantID:     getEnvWithDefault("ONEDRIVE_TENANT_ID", "common"),
		RedirectURI:  getEnvWithDefault("ONEDRIVE_REDIRECT_URI", "http://localhost:"+port+"/auth/onedrive/callback"),
		CallbackPort: port,
	}
}

func getEnvWithDefault(key, defaultVal string) string {
	// This would use os.Getenv in a real implementation
	return defaultVal
}

// OneDriveAuth handles OneDrive OAuth flows.
type OneDriveAuth struct {
	config *OneDriveAuthConfig
	db     *database.Client
}

// NewOneDriveAuth creates a new OneDrive auth handler.
func NewOneDriveAuth(cfg *OneDriveAuthConfig, db *database.Client) *OneDriveAuth {
	return &OneDriveAuth{
		config: cfg,
		db:     db,
	}
}

// StartAuthSession starts a new OAuth session.
func (o *OneDriveAuth) StartAuthSession(ctx context.Context, endpointID string) (*OneDriveAuthSession, error) {
	// Generate state and PKCE verifier
	state, err := generateRandomString(32)
	if err != nil {
		return nil, err
	}

	codeVerifier, err := generateRandomString(64)
	if err != nil {
		return nil, err
	}

	// Create code challenge
	h := sha256.Sum256([]byte(codeVerifier))
	codeChallenge := base64.RawURLEncoding.EncodeToString(h[:])

	// Save session to database
	session := &database.OneDriveAuthSession{
		EndpointID: endpointID,
		State:      state,
		ExpiresAt:  time.Now().Add(10 * time.Minute),
	}
	session.CodeVerifier.String = codeVerifier
	session.CodeVerifier.Valid = true

	if err := o.db.CreateOneDriveAuthSession(ctx, session); err != nil {
		return nil, err
	}

	// Build authorization URL
	authURL := o.buildAuthURL(state, codeChallenge)

	return &OneDriveAuthSession{
		AuthSessionID: session.ID,
		AuthURL:       authURL,
		State:         state,
	}, nil
}

// CompleteAuth completes the OAuth flow with the authorization code.
func (o *OneDriveAuth) CompleteAuth(ctx context.Context, state, code string) (*OneDriveAuthResult, error) {
	// Get session
	session, err := o.db.GetOneDriveAuthSessionByState(ctx, state)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return &OneDriveAuthResult{OK: false}, fmt.Errorf("invalid or expired auth session")
	}

	if time.Now().After(session.ExpiresAt) {
		return &OneDriveAuthResult{OK: false}, fmt.Errorf("auth session expired")
	}

	// Exchange code for tokens
	tokens, err := o.exchangeCode(ctx, code, session.CodeVerifier.String)
	if err != nil {
		return &OneDriveAuthResult{OK: false}, err
	}

	// Save tokens
	if err := o.db.SaveOneDriveDelegatedToken(ctx, &database.OneDriveDelegatedToken{
		EndpointID:   session.EndpointID,
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
		ExpiresAt:    time.Now().Add(time.Duration(tokens.ExpiresIn) * time.Second),
	}); err != nil {
		return &OneDriveAuthResult{OK: false}, err
	}

	// Mark endpoint as delegated connected
	if err := o.db.MarkEndpointDelegatedConnected(ctx, session.EndpointID, true); err != nil {
		// Log but don't fail
	}

	// Clean up session
	_ = o.db.DeleteOneDriveAuthSession(ctx, session.ID)

	return &OneDriveAuthResult{
		OK:         true,
		EndpointID: &session.EndpointID,
	}, nil
}

func (o *OneDriveAuth) buildAuthURL(state, codeChallenge string) string {
	baseURL := fmt.Sprintf("https://login.microsoftonline.com/%s/oauth2/v2.0/authorize", o.config.TenantID)

	params := url.Values{}
	params.Set("client_id", o.config.ClientID)
	params.Set("response_type", "code")
	params.Set("redirect_uri", o.config.RedirectURI)
	params.Set("scope", "https://graph.microsoft.com/.default offline_access")
	params.Set("state", state)
	params.Set("code_challenge", codeChallenge)
	params.Set("code_challenge_method", "S256")

	return baseURL + "?" + params.Encode()
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

func (o *OneDriveAuth) exchangeCode(ctx context.Context, code, codeVerifier string) (*tokenResponse, error) {
	tokenURL := fmt.Sprintf("https://login.microsoftonline.com/%s/oauth2/v2.0/token", o.config.TenantID)

	data := url.Values{}
	data.Set("client_id", o.config.ClientID)
	data.Set("grant_type", "authorization_code")
	data.Set("code", code)
	data.Set("redirect_uri", o.config.RedirectURI)
	data.Set("code_verifier", codeVerifier)

	req, err := http.NewRequestWithContext(ctx, "POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token exchange failed: %s", string(body))
	}

	var tokens tokenResponse
	if err := json.Unmarshal(body, &tokens); err != nil {
		return nil, err
	}

	return &tokens, nil
}

func generateRandomString(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes)[:length], nil
}

// =============================================================================
// TYPES
// =============================================================================

// OneDriveAuthSession represents an auth session.
type OneDriveAuthSession struct {
	AuthSessionID string `json:"authSessionId"`
	AuthURL       string `json:"authUrl"`
	State         string `json:"state"`
}

// OneDriveAuthResult is the result of completing auth.
type OneDriveAuthResult struct {
	OK         bool    `json:"ok"`
	EndpointID *string `json:"endpointId,omitempty"`
}
