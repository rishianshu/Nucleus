package http

import (
	"context"
	"encoding/json"
	"net/url"
	"strconv"
)

// =============================================================================
// PAGINATION STRATEGIES
// =============================================================================

// Paginator handles API pagination.
type Paginator interface {
	// NextPage returns the request for the next page, or nil if done.
	NextPage(ctx context.Context, resp *Response) (*Request, error)
}

// =============================================================================
// OFFSET PAGINATION
// =============================================================================

// OffsetPaginator uses offset/limit pagination (common in REST APIs).
type OffsetPaginator struct {
	Path       string
	Limit      int
	Offset     int
	OffsetKey  string // Query param name (default: "startAt")
	LimitKey   string // Query param name (default: "maxResults")
	TotalKey   string // JSON path to total count (default: "total")
	ResultsKey string // JSON path to results array (default: "results")
	total      int
	fetched    int
}

// NewOffsetPaginator creates a new offset-based paginator.
func NewOffsetPaginator(path string, limit int) *OffsetPaginator {
	return &OffsetPaginator{
		Path:       path,
		Limit:      limit,
		Offset:     0,
		OffsetKey:  "startAt",
		LimitKey:   "maxResults",
		TotalKey:   "total",
		ResultsKey: "values",
	}
}

// FirstPage returns the first page request.
func (p *OffsetPaginator) FirstPage() *Request {
	query := url.Values{}
	query.Set(p.OffsetKey, strconv.Itoa(p.Offset))
	query.Set(p.LimitKey, strconv.Itoa(p.Limit))
	return &Request{
		Method: "GET",
		Path:   p.Path,
		Query:  query,
	}
}

// NextPage returns the next page request based on response.
func (p *OffsetPaginator) NextPage(ctx context.Context, resp *Response) (*Request, error) {
	// Parse response to get total
	var data map[string]any
	if err := json.Unmarshal(resp.Body, &data); err != nil {
		return nil, err
	}

	// Get total count
	if total, ok := data[p.TotalKey]; ok {
		switch v := total.(type) {
		case float64:
			p.total = int(v)
		case int:
			p.total = v
		}
	}

	// Get results count
	if results, ok := data[p.ResultsKey]; ok {
		if arr, ok := results.([]any); ok {
			p.fetched += len(arr)
		}
	}

	// Check if more pages
	if p.fetched >= p.total {
		return nil, nil
	}

	// Build next request
	p.Offset = p.fetched
	return p.FirstPage(), nil
}

// =============================================================================
// CURSOR PAGINATION
// =============================================================================

// CursorPaginator uses cursor-based pagination.
type CursorPaginator struct {
	Path         string
	Limit        int
	CursorKey    string // Query param name (default: "cursor")
	LimitKey     string // Query param name (default: "limit")
	NextCursor   string // Extracted from response
	NextCursorPath string // JSON path to next cursor (default: "nextCursor")
}

// NewCursorPaginator creates a new cursor-based paginator.
func NewCursorPaginator(path string, limit int) *CursorPaginator {
	return &CursorPaginator{
		Path:          path,
		Limit:         limit,
		CursorKey:     "cursor",
		LimitKey:      "limit",
		NextCursorPath: "nextCursor",
	}
}

// FirstPage returns the first page request.
func (p *CursorPaginator) FirstPage() *Request {
	query := url.Values{}
	query.Set(p.LimitKey, strconv.Itoa(p.Limit))
	if p.NextCursor != "" {
		query.Set(p.CursorKey, p.NextCursor)
	}
	return &Request{
		Method: "GET",
		Path:   p.Path,
		Query:  query,
	}
}

// NextPage returns the next page request based on response.
func (p *CursorPaginator) NextPage(ctx context.Context, resp *Response) (*Request, error) {
	var data map[string]any
	if err := json.Unmarshal(resp.Body, &data); err != nil {
		return nil, err
	}

	// Get next cursor
	if cursor, ok := data[p.NextCursorPath]; ok {
		if s, ok := cursor.(string); ok && s != "" {
			p.NextCursor = s
			return p.FirstPage(), nil
		}
	}

	return nil, nil
}

// =============================================================================
// PAGINATED ITERATOR
// =============================================================================

// PaginatedIterator fetches all pages from an API.
type PaginatedIterator[T any] struct {
	client       *Client
	paginator    Paginator
	firstRequest *Request
	parseResults func(resp *Response) ([]T, error)
	
	current     []T
	currentIdx  int
	nextRequest *Request
	done        bool
	err         error
}

// NewPaginatedIterator creates a paginated iterator.
func NewPaginatedIterator[T any](
	client *Client,
	firstRequest *Request,
	paginator Paginator,
	parseResults func(resp *Response) ([]T, error),
) *PaginatedIterator[T] {
	return &PaginatedIterator[T]{
		client:       client,
		firstRequest: firstRequest,
		paginator:    paginator,
		parseResults: parseResults,
		nextRequest:  firstRequest,
	}
}

// Next advances to the next item.
func (it *PaginatedIterator[T]) Next() bool {
	// Check if we have more items in current page
	if it.currentIdx < len(it.current) {
		return true
	}

	// Check if we're done
	if it.done || it.nextRequest == nil {
		return false
	}

	// Fetch next page
	resp, err := it.client.Do(context.Background(), it.nextRequest)
	if err != nil {
		it.err = err
		return false
	}

	// Parse results
	results, err := it.parseResults(resp)
	if err != nil {
		it.err = err
		return false
	}

	// Get next page request
	nextReq, err := it.paginator.NextPage(context.Background(), resp)
	if err != nil {
		it.err = err
		return false
	}

	it.current = results
	it.currentIdx = 0
	it.nextRequest = nextReq
	it.done = nextReq == nil

	return len(it.current) > 0
}

// Value returns the current item.
func (it *PaginatedIterator[T]) Value() T {
	if it.currentIdx < len(it.current) {
		val := it.current[it.currentIdx]
		it.currentIdx++
		return val
	}
	var zero T
	return zero
}

// Err returns any error encountered.
func (it *PaginatedIterator[T]) Err() error {
	return it.err
}

// Close releases resources.
func (it *PaginatedIterator[T]) Close() error {
	it.done = true
	return nil
}
