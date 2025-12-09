// Package database provides OneDrive auth session and token queries.
package database

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// =============================================================================
// ONEDRIVE AUTH SESSION QUERIES
// =============================================================================

// CreateOneDriveAuthSession creates a new auth session.
func (c *Client) CreateOneDriveAuthSession(ctx context.Context, session *OneDriveAuthSession) error {
	if session.ID == "" {
		session.ID = uuid.New().String()
	}

	_, err := c.db.ExecContext(ctx, `
		INSERT INTO onedrive_auth_sessions (id, endpoint_id, state, code_verifier, redirect_uri, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, session.ID, session.EndpointID, session.State, session.CodeVerifier, session.RedirectURI, session.ExpiresAt)
	return err
}

// GetOneDriveAuthSessionByState retrieves a session by state.
func (c *Client) GetOneDriveAuthSessionByState(ctx context.Context, state string) (*OneDriveAuthSession, error) {
	var s OneDriveAuthSession
	err := c.db.QueryRowContext(ctx, `
		SELECT id, endpoint_id, state, code_verifier, redirect_uri, expires_at, created_at
		FROM onedrive_auth_sessions
		WHERE state = $1
	`, state).Scan(&s.ID, &s.EndpointID, &s.State, &s.CodeVerifier, &s.RedirectURI, &s.ExpiresAt, &s.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get auth session: %w", err)
	}
	return &s, nil
}

// DeleteOneDriveAuthSession deletes an auth session.
func (c *Client) DeleteOneDriveAuthSession(ctx context.Context, id string) error {
	_, err := c.db.ExecContext(ctx, `DELETE FROM onedrive_auth_sessions WHERE id = $1`, id)
	return err
}

// CleanupExpiredAuthSessions removes expired sessions.
func (c *Client) CleanupExpiredAuthSessions(ctx context.Context) error {
	_, err := c.db.ExecContext(ctx, `DELETE FROM onedrive_auth_sessions WHERE expires_at < NOW()`)
	return err
}

// =============================================================================
// ONEDRIVE DELEGATED TOKEN QUERIES
// =============================================================================

// SaveOneDriveDelegatedToken saves or updates a delegated token.
func (c *Client) SaveOneDriveDelegatedToken(ctx context.Context, token *OneDriveDelegatedToken) error {
	if token.ID == "" {
		token.ID = uuid.New().String()
	}

	_, err := c.db.ExecContext(ctx, `
		INSERT INTO onedrive_delegated_tokens (id, endpoint_id, access_token, refresh_token, expires_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (endpoint_id) DO UPDATE SET
			access_token = EXCLUDED.access_token,
			refresh_token = COALESCE(EXCLUDED.refresh_token, onedrive_delegated_tokens.refresh_token),
			expires_at = EXCLUDED.expires_at,
			updated_at = NOW()
	`, token.ID, token.EndpointID, token.AccessToken, token.RefreshToken, token.ExpiresAt)
	return err
}

// GetOneDriveDelegatedToken retrieves a token by endpoint ID.
func (c *Client) GetOneDriveDelegatedToken(ctx context.Context, endpointID string) (*OneDriveDelegatedToken, error) {
	var t OneDriveDelegatedToken
	err := c.db.QueryRowContext(ctx, `
		SELECT id, endpoint_id, access_token, refresh_token, expires_at, created_at, updated_at
		FROM onedrive_delegated_tokens
		WHERE endpoint_id = $1
	`, endpointID).Scan(&t.ID, &t.EndpointID, &t.AccessToken, &t.RefreshToken, &t.ExpiresAt, &t.CreatedAt, &t.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get delegated token: %w", err)
	}
	return &t, nil
}

// DeleteOneDriveDelegatedToken deletes a token.
func (c *Client) DeleteOneDriveDelegatedToken(ctx context.Context, endpointID string) error {
	_, err := c.db.ExecContext(ctx, `DELETE FROM onedrive_delegated_tokens WHERE endpoint_id = $1`, endpointID)
	return err
}

// =============================================================================
// ENDPOINT DELEGATED CONNECTION STATUS
// =============================================================================

// MarkEndpointDelegatedConnected updates endpoint delegated_connected status.
func (c *Client) MarkEndpointDelegatedConnected(ctx context.Context, endpointID string, connected bool) error {
	_, err := c.db.ExecContext(ctx, `
		UPDATE metadata_endpoints
		SET delegated_connected = $2, updated_at = NOW()
		WHERE id = $1
	`, endpointID, connected)
	return err
}

// =============================================================================
// TOKEN REFRESH HELPERS
// =============================================================================

// GetExpiredTokens returns tokens that need refresh.
func (c *Client) GetExpiredTokens(ctx context.Context, expiresWithin time.Duration) ([]*OneDriveDelegatedToken, error) {
	threshold := time.Now().Add(expiresWithin)
	rows, err := c.db.QueryContext(ctx, `
		SELECT id, endpoint_id, access_token, refresh_token, expires_at, created_at, updated_at
		FROM onedrive_delegated_tokens
		WHERE expires_at < $1 AND refresh_token IS NOT NULL AND refresh_token != ''
		ORDER BY expires_at ASC
		LIMIT 100
	`, threshold)
	if err != nil {
		return nil, fmt.Errorf("failed to get expired tokens: %w", err)
	}
	defer rows.Close()

	var tokens []*OneDriveDelegatedToken
	for rows.Next() {
		var t OneDriveDelegatedToken
		err := rows.Scan(&t.ID, &t.EndpointID, &t.AccessToken, &t.RefreshToken, &t.ExpiresAt, &t.CreatedAt, &t.UpdatedAt)
		if err != nil {
			return nil, err
		}
		tokens = append(tokens, &t)
	}
	return tokens, rows.Err()
}
