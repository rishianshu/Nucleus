package http

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/time/rate"
)

// =============================================================================
// CLIENT CONFIGURATION
// =============================================================================

// ClientConfig configures the HTTP client behavior.
type ClientConfig struct {
	// BaseURL is the base URL for all requests.
	BaseURL string

	// Auth configures authentication.
	Auth AuthConfig

	// Timeout for individual requests (default: 30s).
	Timeout time.Duration

	// MaxRetries for failed requests (default: 3).
	MaxRetries int

	// RateLimit requests per second (default: 10).
	RateLimit float64

	// RateBurst maximum burst size (default: 5).
	RateBurst int

	// Headers to add to all requests.
	Headers map[string]string

	// UserAgent string (default: "UCL-Core/1.0").
	UserAgent string

	// Transport allows injecting a custom HTTP transport (for tests/stubs).
	Transport http.RoundTripper
}

// DefaultClientConfig returns a client config with sensible defaults.
func DefaultClientConfig() *ClientConfig {
	return &ClientConfig{
		Timeout:    30 * time.Second,
		MaxRetries: 3,
		RateLimit:  10.0,
		RateBurst:  5,
		UserAgent:  "UCL-Core/1.0",
		Headers:    make(map[string]string),
	}
}

// =============================================================================
// HTTP CLIENT
// =============================================================================

// Client is a rate-limited, retry-capable HTTP client.
type Client struct {
	config      *ClientConfig
	httpClient  *http.Client
	rateLimiter *rate.Limiter
}

// NewClient creates a new HTTP client with the given configuration.
func NewClient(config *ClientConfig) *Client {
	if config == nil {
		config = DefaultClientConfig()
	}
	if config.Timeout == 0 {
		config.Timeout = 30 * time.Second
	}
	if config.MaxRetries == 0 {
		config.MaxRetries = 3
	}
	if config.RateLimit == 0 {
		config.RateLimit = 10.0
	}
	if config.RateBurst == 0 {
		config.RateBurst = 5
	}
	if config.UserAgent == "" {
		config.UserAgent = "UCL-Core/1.0"
	}

	return &Client{
		config: config,
		httpClient: &http.Client{
			Timeout:   config.Timeout,
			Transport: config.Transport,
		},
		rateLimiter: rate.NewLimiter(rate.Limit(config.RateLimit), config.RateBurst),
	}
}

// =============================================================================
// REQUEST/RESPONSE TYPES
// =============================================================================

// Request represents an HTTP request to be made.
type Request struct {
	Method  string
	Path    string
	Query   url.Values
	Headers map[string]string
	Body    io.Reader
}

// Response wraps an HTTP response with convenience methods.
type Response struct {
	StatusCode int
	Headers    http.Header
	Body       []byte
}

// JSON unmarshals the response body into the given target.
func (r *Response) JSON(target any) error {
	return json.Unmarshal(r.Body, target)
}

// IsSuccess returns true if the status code is 2xx.
func (r *Response) IsSuccess() bool {
	return r.StatusCode >= 200 && r.StatusCode < 300
}

// =============================================================================
// CLIENT METHODS
// =============================================================================

// Do executes a request with rate limiting and retry.
func (c *Client) Do(ctx context.Context, req *Request) (*Response, error) {
	// Wait for rate limiter
	if err := c.rateLimiter.Wait(ctx); err != nil {
		return nil, fmt.Errorf("rate limiter: %w", err)
	}

	var lastErr error
	for attempt := 0; attempt <= c.config.MaxRetries; attempt++ {
		resp, err := c.doOnce(ctx, req)
		if err == nil {
			return resp, nil
		}

		lastErr = err

		// Check if retryable
		if !isRetryable(err) {
			return nil, err
		}

		// Exponential backoff
		backoff := time.Duration(1<<uint(attempt)) * 100 * time.Millisecond
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(backoff):
		}
	}

	return nil, fmt.Errorf("max retries exceeded: %w", lastErr)
}

// doOnce executes a single request attempt.
func (c *Client) doOnce(ctx context.Context, req *Request) (*Response, error) {
	// Build URL
	fullURL := c.config.BaseURL
	if req.Path != "" {
		fullURL = strings.TrimSuffix(fullURL, "/") + "/" + strings.TrimPrefix(req.Path, "/")
	}
	if len(req.Query) > 0 {
		fullURL += "?" + req.Query.Encode()
	}

	// Create HTTP request
	httpReq, err := http.NewRequestWithContext(ctx, req.Method, fullURL, req.Body)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	// Set headers
	httpReq.Header.Set("User-Agent", c.config.UserAgent)
	for k, v := range c.config.Headers {
		httpReq.Header.Set(k, v)
	}
	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}

	// Apply auth
	c.config.Auth.Apply(httpReq)

	// Execute
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	// Read body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	response := &Response{
		StatusCode: resp.StatusCode,
		Headers:    resp.Header,
		Body:       body,
	}

	// Check for errors
	if resp.StatusCode >= 400 {
		return response, &HTTPError{
			StatusCode: resp.StatusCode,
			Message:    string(body),
		}
	}

	return response, nil
}

// Get performs a GET request.
func (c *Client) Get(ctx context.Context, path string, query url.Values) (*Response, error) {
	return c.Do(ctx, &Request{
		Method: http.MethodGet,
		Path:   path,
		Query:  query,
	})
}

// Post performs a POST request with JSON body.
func (c *Client) Post(ctx context.Context, path string, body any) (*Response, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal body: %w", err)
		}
		bodyReader = strings.NewReader(string(data))
	}

	return c.Do(ctx, &Request{
		Method: http.MethodPost,
		Path:   path,
		Body:   bodyReader,
		Headers: map[string]string{
			"Content-Type": "application/json",
		},
	})
}

// Put performs a PUT request with JSON body.
func (c *Client) Put(ctx context.Context, path string, body any) (*Response, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal body: %w", err)
		}
		bodyReader = strings.NewReader(string(data))
	}

	return c.Do(ctx, &Request{
		Method: http.MethodPut,
		Path:   path,
		Body:   bodyReader,
		Headers: map[string]string{
			"Content-Type": "application/json",
		},
	})
}

// Patch performs a PATCH request with JSON body.
func (c *Client) Patch(ctx context.Context, path string, body any) (*Response, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal body: %w", err)
		}
		bodyReader = strings.NewReader(string(data))
	}

	return c.Do(ctx, &Request{
		Method: http.MethodPatch,
		Path:   path,
		Body:   bodyReader,
		Headers: map[string]string{
			"Content-Type": "application/json",
		},
	})
}

// =============================================================================
// ERRORS
// =============================================================================

// HTTPError represents an HTTP error response.
type HTTPError struct {
	StatusCode int
	Message    string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("HTTP %d: %s", e.StatusCode, e.Message)
}

// IsRateLimited returns true if this is a rate limit error.
func (e *HTTPError) IsRateLimited() bool {
	return e.StatusCode == 429
}

// IsServerError returns true if this is a server error.
func (e *HTTPError) IsServerError() bool {
	return e.StatusCode >= 500
}

// isRetryable determines if an error should be retried.
func isRetryable(err error) bool {
	if httpErr, ok := err.(*HTTPError); ok {
		return httpErr.IsRateLimited() || httpErr.IsServerError()
	}
	return false
}
