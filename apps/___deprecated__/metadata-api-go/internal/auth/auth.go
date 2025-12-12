// Package auth provides JWT authentication middleware for the metadata-api.
package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/nucleus/metadata-api/internal/config"
)

// Context keys for auth data
type contextKey string

const (
	contextKeyAuth contextKey = "auth"
)

// Context represents the authenticated user context.
type Context struct {
	Subject   string   `json:"subject"`
	Issuer    string   `json:"issuer"`
	Audience  []string `json:"audience"`
	ProjectID string   `json:"projectId,omitempty"`
	Roles     []string `json:"roles,omitempty"`
	Expires   int64    `json:"exp,omitempty"`
}

// FromContext extracts the auth context from a request context.
func FromContext(ctx context.Context) *Context {
	if auth, ok := ctx.Value(contextKeyAuth).(*Context); ok {
		return auth
	}
	return &Context{Subject: "anonymous"}
}

// Middleware returns an HTTP middleware that validates JWT tokens.
func Middleware(cfg *config.Config) func(http.Handler) http.Handler {
	keyCache := &jwksCache{
		url:     cfg.JWKSUrl,
		refresh: 15 * time.Minute,
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			
			// Allow anonymous requests if auth is not configured
			if cfg.JWKSUrl == "" || authHeader == "" {
				ctx := context.WithValue(r.Context(), contextKeyAuth, &Context{Subject: "anonymous"})
				// Check for x-user-id header fallback
				if userID := r.Header.Get("X-User-Id"); userID != "" {
					ctx = context.WithValue(r.Context(), contextKeyAuth, &Context{Subject: userID})
				}
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// Extract Bearer token
			if !strings.HasPrefix(authHeader, "Bearer ") {
				http.Error(w, `{"error": "invalid authorization header"}`, http.StatusUnauthorized)
				return
			}
			tokenString := strings.TrimPrefix(authHeader, "Bearer ")

			// Parse and validate JWT
			authCtx, err := validateToken(tokenString, keyCache, cfg)
			if err != nil {
				if cfg.AuthDebug {
					http.Error(w, fmt.Sprintf(`{"error": %q}`, err.Error()), http.StatusUnauthorized)
				} else {
					http.Error(w, `{"error": "unauthorized"}`, http.StatusUnauthorized)
				}
				return
			}

			ctx := context.WithValue(r.Context(), contextKeyAuth, authCtx)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func validateToken(tokenString string, keyCache *jwksCache, cfg *config.Config) (*Context, error) {
	// Parse token without validation first to get headers
	token, _, err := new(jwt.Parser).ParseUnverified(tokenString, jwt.MapClaims{})
	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	// Get signing key from JWKS
	kid, ok := token.Header["kid"].(string)
	if !ok {
		return nil, fmt.Errorf("missing kid in token header")
	}

	key, err := keyCache.GetKey(kid)
	if err != nil {
		return nil, fmt.Errorf("failed to get signing key: %w", err)
	}

	// Validate token
	validatedToken, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return key, nil
	}, jwt.WithIssuer(cfg.AuthIssuer), jwt.WithAudience(cfg.AuthAudience))
	if err != nil {
		return nil, fmt.Errorf("token validation failed: %w", err)
	}

	claims, ok := validatedToken.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fmt.Errorf("invalid claims type")
	}

	authCtx := &Context{
		Subject: getStringClaim(claims, "sub"),
		Issuer:  getStringClaim(claims, "iss"),
	}

	if aud, ok := claims["aud"].([]interface{}); ok {
		for _, a := range aud {
			if s, ok := a.(string); ok {
				authCtx.Audience = append(authCtx.Audience, s)
			}
		}
	} else if aud, ok := claims["aud"].(string); ok {
		authCtx.Audience = []string{aud}
	}

	if exp, ok := claims["exp"].(float64); ok {
		authCtx.Expires = int64(exp)
	}

	// Extract custom claims
	if projectID, ok := claims["project_id"].(string); ok {
		authCtx.ProjectID = projectID
	}
	if roles, ok := claims["roles"].([]interface{}); ok {
		for _, r := range roles {
			if s, ok := r.(string); ok {
				authCtx.Roles = append(authCtx.Roles, s)
			}
		}
	}

	return authCtx, nil
}

func getStringClaim(claims jwt.MapClaims, key string) string {
	if val, ok := claims[key].(string); ok {
		return val
	}
	return ""
}

// =============================================================================
// JWKS CACHE
// =============================================================================

type jwksCache struct {
	url     string
	refresh time.Duration

	mu        sync.RWMutex
	keys      map[string]interface{}
	fetchedAt time.Time
}

type jwksResponse struct {
	Keys []json.RawMessage `json:"keys"`
}

type jwkKey struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Alg string `json:"alg"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
}

func (c *jwksCache) GetKey(kid string) (interface{}, error) {
	c.mu.RLock()
	if time.Since(c.fetchedAt) < c.refresh && c.keys != nil {
		if key, ok := c.keys[kid]; ok {
			c.mu.RUnlock()
			return key, nil
		}
	}
	c.mu.RUnlock()

	// Fetch fresh JWKS
	if err := c.fetch(); err != nil {
		return nil, err
	}

	c.mu.RLock()
	defer c.mu.RUnlock()
	if key, ok := c.keys[kid]; ok {
		return key, nil
	}
	return nil, fmt.Errorf("key %s not found in JWKS", kid)
}

func (c *jwksCache) fetch() error {
	if c.url == "" {
		return fmt.Errorf("JWKS URL not configured")
	}

	resp, err := http.Get(c.url)
	if err != nil {
		return fmt.Errorf("failed to fetch JWKS: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("JWKS request failed with status %d", resp.StatusCode)
	}

	var jwks jwksResponse
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return fmt.Errorf("failed to decode JWKS: %w", err)
	}

	keys := make(map[string]interface{})
	for _, rawKey := range jwks.Keys {
		var key jwkKey
		if err := json.Unmarshal(rawKey, &key); err != nil {
			continue
		}
		if key.Kty != "RSA" {
			continue
		}

		// Parse RSA public key
		pubKey, err := parseRSAPublicKey(key.N, key.E)
		if err != nil {
			continue
		}
		keys[key.Kid] = pubKey
	}

	c.mu.Lock()
	c.keys = keys
	c.fetchedAt = time.Now()
	c.mu.Unlock()

	return nil
}

func parseRSAPublicKey(nBase64, eBase64 string) (interface{}, error) {
	// This is a simplified implementation - in production, use a proper JWKS library
	// For now, return nil to indicate we need the full implementation
	return nil, fmt.Errorf("RSA key parsing not yet implemented - use github.com/lestrrat-go/jwx for production")
}
