package confluence

import (
	"context"
	"fmt"
	"net/url"
	"strconv"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// =============================================================================
// SPACE ITERATOR
// =============================================================================

type spaceIterator struct {
	confluence *Confluence
	ctx        context.Context
	limit      int64
	start      int
	current    []Space
	index      int
	done       bool
	err        error
	count      int64
}

func newSpaceIterator(c *Confluence, ctx context.Context, limit int64) *spaceIterator {
	return &spaceIterator{
		confluence: c,
		ctx:        ctx,
		limit:      limit,
	}
}

func (it *spaceIterator) Next() bool {
	if it.done || it.err != nil {
		return false
	}

	// Check limit
	if it.limit > 0 && it.count >= it.limit {
		it.done = true
		return false
	}

	// Need to fetch more?
	if it.index >= len(it.current) {
		if err := it.fetchPage(); err != nil {
			it.err = err
			return false
		}
	}

	return it.index < len(it.current)
}

func (it *spaceIterator) fetchPage() error {
	params := url.Values{}
	params.Set("start", strconv.Itoa(it.start))
	params.Set("limit", strconv.Itoa(it.confluence.config.FetchSize))

	resp, err := it.confluence.Client.Get(it.ctx, "/wiki/rest/api/space", params)
	if err != nil {
		return err
	}

	var result SpacesResponse
	if err := resp.JSON(&result); err != nil {
		return err
	}

	it.current = result.Results
	it.index = 0
	it.start += len(result.Results)

	if len(result.Results) == 0 || result.Links == nil || result.Links.Next == "" {
		it.done = true
	}

	return nil
}

func (it *spaceIterator) Value() endpoint.Record {
	if it.index >= len(it.current) {
		return nil
	}
	space := it.current[it.index]
	it.index++
	it.count++

	desc := ""
	if space.Description != nil && space.Description.Plain != nil {
		desc = space.Description.Plain.Value
	}

	webURL := ""
	if space.Links != nil {
		webURL = space.Links.WebUI
		if space.Links.Base != "" && webURL != "" {
			webURL = space.Links.Base + webURL
		}
	}

	return endpoint.Record{
		"spaceKey":    space.Key,
		"name":        space.Name,
		"type":        space.Type,
		"status":      space.Status,
		"url":         webURL,
		"description": desc,
		"_raw":        space,
	}
}

func (it *spaceIterator) Err() error   { return it.err }
func (it *spaceIterator) Close() error { return nil }

// =============================================================================
// PAGE ITERATOR
// =============================================================================

type pageIterator struct {
	confluence *Confluence
	ctx        context.Context
	limit      int64
	start      int
	current    []Content
	index      int
	done       bool
	err        error
	count      int64
}

func newPageIterator(c *Confluence, ctx context.Context, limit int64) *pageIterator {
	return &pageIterator{
		confluence: c,
		ctx:        ctx,
		limit:      limit,
	}
}

func (it *pageIterator) Next() bool {
	if it.done || it.err != nil {
		return false
	}

	if it.limit > 0 && it.count >= it.limit {
		it.done = true
		return false
	}

	if it.index >= len(it.current) {
		if err := it.fetchPage(); err != nil {
			it.err = err
			return false
		}
	}

	return it.index < len(it.current)
}

func (it *pageIterator) fetchPage() error {
	params := url.Values{}
	params.Set("start", strconv.Itoa(it.start))
	params.Set("limit", strconv.Itoa(it.confluence.config.FetchSize))
	params.Set("type", "page")
	params.Set("expand", "history,history.lastUpdated,space,version")

	// Filter by spaces if configured
	if len(it.confluence.config.Spaces) > 0 {
		for _, s := range it.confluence.config.Spaces {
			params.Add("spaceKey", s)
		}
	}

	resp, err := it.confluence.Client.Get(it.ctx, "/wiki/rest/api/content", params)
	if err != nil {
		return err
	}

	var result ContentResponse
	if err := resp.JSON(&result); err != nil {
		return err
	}

	it.current = result.Results
	it.index = 0
	it.start += len(result.Results)

	if len(result.Results) == 0 || result.Links == nil || result.Links.Next == "" {
		it.done = true
	}

	return nil
}

func (it *pageIterator) Value() endpoint.Record {
	if it.index >= len(it.current) {
		return nil
	}
	page := it.current[it.index]
	it.index++
	it.count++

	spaceKey := ""
	if page.Space != nil {
		spaceKey = page.Space.Key
	}

	var createdAt, updatedAt, author, updatedBy string
	if page.History != nil {
		createdAt = page.History.CreatedDate
		if page.History.CreatedBy != nil {
			author = page.History.CreatedBy.DisplayName
		}
		if page.History.LastUpdated != nil {
			updatedAt = page.History.LastUpdated.When
			if page.History.LastUpdated.By != nil {
				updatedBy = page.History.LastUpdated.By.DisplayName
			}
		}
	}

	webURL := ""
	if page.Links != nil {
		webURL = page.Links.WebUI
		if page.Links.Base != "" && webURL != "" {
			webURL = page.Links.Base + webURL
		}
	}

	return endpoint.Record{
		"pageId":      page.ID,
		"spaceKey":    spaceKey,
		"title":       page.Title,
		"status":      page.Status,
		"contentType": page.Type,
		"createdAt":   createdAt,
		"updatedAt":   updatedAt,
		"author":      author,
		"updatedBy":   updatedBy,
		"url":         webURL,
		"_raw":        page,
	}
}

func (it *pageIterator) Err() error   { return it.err }
func (it *pageIterator) Close() error { return nil }

// =============================================================================
// ATTACHMENT ITERATOR
// =============================================================================

type attachmentIterator struct {
	confluence  *Confluence
	ctx         context.Context
	limit       int64
	pages       []string // List of page IDs to iterate
	pageIndex   int
	attachments []Content
	attIndex    int
	done        bool
	err         error
	count       int64
}

func newAttachmentIterator(c *Confluence, ctx context.Context, limit int64) *attachmentIterator {
	return &attachmentIterator{
		confluence: c,
		ctx:        ctx,
		limit:      limit,
	}
}

func (it *attachmentIterator) Next() bool {
	if it.done || it.err != nil {
		return false
	}

	if it.limit > 0 && it.count >= it.limit {
		it.done = true
		return false
	}

	// Initialize: fetch pages first
	if it.pages == nil {
		if err := it.fetchPages(); err != nil {
			it.err = err
			return false
		}
	}

	// Get next attachment
	for it.attIndex >= len(it.attachments) {
		if it.pageIndex >= len(it.pages) {
			it.done = true
			return false
		}
		if err := it.fetchAttachments(); err != nil {
			it.err = err
			return false
		}
	}

	return it.attIndex < len(it.attachments)
}

func (it *attachmentIterator) fetchPages() error {
	params := url.Values{}
	params.Set("limit", "100")
	params.Set("type", "page")

	resp, err := it.confluence.Client.Get(it.ctx, "/wiki/rest/api/content", params)
	if err != nil {
		return err
	}

	var result ContentResponse
	if err := resp.JSON(&result); err != nil {
		return err
	}

	it.pages = make([]string, 0, len(result.Results))
	for _, p := range result.Results {
		it.pages = append(it.pages, p.ID)
	}

	return nil
}

func (it *attachmentIterator) fetchAttachments() error {
	if it.pageIndex >= len(it.pages) {
		it.done = true
		return nil
	}

	pageID := it.pages[it.pageIndex]
	it.pageIndex++

	path := fmt.Sprintf("/wiki/rest/api/content/%s/child/attachment", pageID)
	resp, err := it.confluence.Client.Get(it.ctx, path, nil)
	if err != nil {
		// Skip pages with no attachments access
		it.attachments = nil
		it.attIndex = 0
		return nil
	}

	var result ContentResponse
	if err := resp.JSON(&result); err != nil {
		return err
	}

	it.attachments = result.Results
	it.attIndex = 0
	return nil
}

func (it *attachmentIterator) Value() endpoint.Record {
	if it.attIndex >= len(it.attachments) {
		return nil
	}
	att := it.attachments[it.attIndex]
	it.attIndex++
	it.count++

	var mediaType string
	var fileSize int64
	if att.Extensions != nil {
		mediaType = att.Extensions.MediaType
		fileSize = att.Extensions.FileSize
	}

	var createdAt, createdBy string
	if att.History != nil {
		createdAt = att.History.CreatedDate
		if att.History.CreatedBy != nil {
			createdBy = att.History.CreatedBy.DisplayName
		}
	}

	downloadLink := ""
	if att.Links != nil && att.Links.Self != "" {
		downloadLink = att.Links.Self + "/download"
	}

	// Get parent page ID from ancestors
	pageID := ""
	if len(att.Ancestors) > 0 {
		pageID = att.Ancestors[len(att.Ancestors)-1].ID
	}

	return endpoint.Record{
		"attachmentId": att.ID,
		"pageId":       pageID,
		"title":        att.Title,
		"mediaType":    mediaType,
		"fileSize":     fileSize,
		"downloadLink": downloadLink,
		"createdAt":    createdAt,
		"createdBy":    createdBy,
		"_raw":         att,
	}
}

func (it *attachmentIterator) Err() error   { return it.err }
func (it *attachmentIterator) Close() error { return nil }

// =============================================================================
// ACL ITERATOR (placeholder)
// =============================================================================

type aclIterator struct {
	confluence *Confluence
	ctx        context.Context
	limit      int64
	done       bool
	err        error
}

func newACLIterator(c *Confluence, ctx context.Context, limit int64) *aclIterator {
	return &aclIterator{
		confluence: c,
		ctx:        ctx,
		limit:      limit,
		done:       true, // ACL is placeholder for now
	}
}

func (it *aclIterator) Next() bool  { return false }
func (it *aclIterator) Value() endpoint.Record { return nil }
func (it *aclIterator) Err() error   { return it.err }
func (it *aclIterator) Close() error { return nil }
