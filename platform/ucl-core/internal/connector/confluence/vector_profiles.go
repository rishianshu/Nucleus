package confluence

import (
	"fmt"
	"strings"

	"github.com/nucleus/store-core/pkg/vectorstore"
	"github.com/nucleus/ucl-core/internal/endpoint"
	"github.com/nucleus/ucl-core/pkg/vectorprofile"
)

func init() {
	vectorprofile.Register("source.confluence.pages.v1", &pageNormalizer{})
	// Register multi-record provider
	endpoint.RegisterMultiRecordProvider("http.confluence", &ConfluenceMultiRecordProvider{})
}

// ===================================================
// Single-Record Normalizer (Legacy v1)
// ===================================================

type pageNormalizer struct{}

func (n *pageNormalizer) Normalize(rec map[string]any) (vectorstore.Entry, string, bool) {
	payload, _ := rec["payload"].(map[string]any)
	if payload == nil {
		return vectorstore.Entry{}, "", false
	}
	pageID := asString(payload["id"])
	title := asString(payload["title"])
	body := asString(payload["body"])
	space := asString(payload["spaceKey"])
	if pageID == "" || title == "" {
		return vectorstore.Entry{}, "", false
	}
	text := strings.TrimSpace(strings.Join([]string{title, body}, "\n\n"))
	nodeID := fmt.Sprintf("doc:confluence:%s:page:%s", space, pageID)
	entry := vectorstore.Entry{
		ProfileID:    "source.confluence.pages.v1",
		NodeID:       nodeID,
		SourceFamily: "confluence",
		EntityKind:   "doc.page",
		ContentText:  text,
		Metadata: map[string]any{
			"pageId":   pageID,
			"space":    space,
			"title":    title,
			"source":   "confluence",
			"spaceKey": space,
		},
		RawPayload: payload,
	}
	return entry, text, true
}

// ===================================================
// Multi-Record Vector Profile Provider
// Produces multiple embedding records per Confluence entity
// ===================================================

// ConfluenceMultiRecordProvider implements MultiRecordVectorProfileProvider.
type ConfluenceMultiRecordProvider struct{}

// GetVectorProfiles returns supported profile IDs for Confluence.
// P2 Fix: Include all blogpost-related profile IDs
func (p *ConfluenceMultiRecordProvider) GetVectorProfiles() []string {
	return []string{
		// Page profiles
		"source.confluence.page.title.v2",
		"source.confluence.page.body.v2",
		"source.confluence.page.comments.v2",
		"source.confluence.page.attachments.v2",
		"source.confluence.page.metadata.v2",
		// Blogpost profiles
		"source.confluence.blogpost.title.v2",
		"source.confluence.blogpost.body.v2",
		"source.confluence.blogpost.comments.v2",
		"source.confluence.blogpost.attachments.v2",
		"source.confluence.blogpost.metadata.v2",
	}
}

// GetAspectConfigs returns aspect configurations for Confluence.
func (p *ConfluenceMultiRecordProvider) GetAspectConfigs() []endpoint.AspectConfig {
	return []endpoint.AspectConfig{
		{Name: "title", EmbeddingType: "dense", ChunkStrategy: "none", MaxChunkSize: 0},
		{Name: "body", EmbeddingType: "dense", ChunkStrategy: "paragraph", MaxChunkSize: 1500, ChunkOverlap: 150},
		{Name: "comments", EmbeddingType: "dense", ChunkStrategy: "sliding_window", MaxChunkSize: 500, ChunkOverlap: 50},
		{Name: "attachments", EmbeddingType: "dense", ChunkStrategy: "none", MaxChunkSize: 0},
		{Name: "metadata", EmbeddingType: "sparse", ChunkStrategy: "none", MaxChunkSize: 0},
	}
}

// NormalizeForMultiIndex produces multiple vector records for a Confluence entity.
func (p *ConfluenceMultiRecordProvider) NormalizeForMultiIndex(rec endpoint.Record) []endpoint.VectorIndexRecord {
	payload, _ := rec["payload"].(map[string]any)
	if payload == nil {
		payload = rec
	}

	// Determine entity type (page or blogpost)
	var entityID, entityType string
	if pageID := asString(payload["pageId"]); pageID != "" {
		entityID = pageID
		entityType = "page"
	} else if pageID := asString(payload["id"]); pageID != "" {
		entityID = pageID
		if contentType := asString(payload["type"]); contentType == "blogpost" {
			entityType = "blogpost"
		} else {
			entityType = "page"
		}
	}

	if entityID == "" {
		return nil
	}

	spaceKey := asString(payload["spaceKey"])
	if spaceKey == "" {
		spaceKey = asString(rec["projectKey"])
	}
	if spaceKey == "" {
		spaceKey = asString(payload["space"])
	}
	if spaceKey == "" {
		return nil
	}

	parentNodeID := fmt.Sprintf("doc:confluence:%s:%s:%s", spaceKey, entityType, entityID)
	tenantID := asString(rec["tenantId"])
	sourceURL := extractSourceURL(payload)

	var records []endpoint.VectorIndexRecord
	configs := p.GetAspectConfigs()

	// Title aspect
	title := asString(payload["title"])
	if title != "" {
		profileID := fmt.Sprintf("source.confluence.%s.title.v2", entityType)
		records = append(records, endpoint.VectorIndexRecord{
			NodeID:        fmt.Sprintf("%s:aspect:title", parentNodeID),
			ProfileID:     profileID,
			EntityKind:    fmt.Sprintf("document.%s.title", entityType),
			Text:          title,
			SourceFamily:  "confluence",
			TenantID:      tenantID,
			ProjectKey:    spaceKey,
			SourceURL:     sourceURL,
			ExternalID:    entityID,
			Aspect:        "title",
			ChunkIndex:    0,
			ParentNodeID:  parentNodeID,
			EmbeddingType: "dense",
			Metadata: map[string]any{
				"pageId":     entityID,
				"entityType": entityType,
				"spaceKey":   spaceKey,
			},
		})
	}

	// Body aspect (with chunking)
	body := extractConfluenceBody(payload)
	if body != "" {
		bodyConfig := configs[1]
		chunks := endpoint.ChunkText(body, bodyConfig)
		profileID := fmt.Sprintf("source.confluence.%s.body.v2", entityType)
		for i, chunk := range chunks {
			records = append(records, endpoint.VectorIndexRecord{
				NodeID:        fmt.Sprintf("%s:aspect:body:%d", parentNodeID, i),
				ProfileID:     profileID,
				EntityKind:    fmt.Sprintf("document.%s.body", entityType),
				Text:          chunk,
				SourceFamily:  "confluence",
				TenantID:      tenantID,
				ProjectKey:    spaceKey,
				SourceURL:     sourceURL,
				ExternalID:    entityID,
				Aspect:        "body",
				ChunkIndex:    i,
				ParentNodeID:  parentNodeID,
				EmbeddingType: "dense",
				Metadata: map[string]any{
					"pageId":      entityID,
					"entityType":  entityType,
					"spaceKey":    spaceKey,
					"chunkIndex":  i,
					"totalChunks": len(chunks),
				},
			})
		}
	}

	// Comments aspect (with chunking)
	comments := extractConfluenceComments(payload)
	if comments != "" {
		commConfig := configs[2]
		chunks := endpoint.ChunkText(comments, commConfig)
		// P2 Fix: Use entity-type-specific profile ID
		commentsProfileID := fmt.Sprintf("source.confluence.%s.comments.v2", entityType)
		for i, chunk := range chunks {
			records = append(records, endpoint.VectorIndexRecord{
				NodeID:        fmt.Sprintf("%s:aspect:comments:%d", parentNodeID, i),
				ProfileID:     commentsProfileID,
				EntityKind:    fmt.Sprintf("document.%s.comments", entityType),
				Text:          chunk,
				SourceFamily:  "confluence",
				TenantID:      tenantID,
				ProjectKey:    spaceKey,
				SourceURL:     sourceURL,
				ExternalID:    entityID,
				Aspect:        "comments",
				ChunkIndex:    i,
				ParentNodeID:  parentNodeID,
				EmbeddingType: "dense",
				Metadata: map[string]any{
					"pageId":      entityID,
					"entityType":  entityType,
					"spaceKey":    spaceKey,
					"chunkIndex":  i,
					"totalChunks": len(chunks),
				},
			})
		}
	}

	// Attachments aspect
	attachmentsText := extractConfluenceAttachments(payload)
	if attachmentsText != "" {
		// P2 Fix: Use entity-type-specific profile ID
		attachmentsProfileID := fmt.Sprintf("source.confluence.%s.attachments.v2", entityType)
		records = append(records, endpoint.VectorIndexRecord{
			NodeID:        fmt.Sprintf("%s:aspect:attachments", parentNodeID),
			ProfileID:     attachmentsProfileID,
			EntityKind:    fmt.Sprintf("document.%s.attachments", entityType),
			Text:          attachmentsText,
			SourceFamily:  "confluence",
			TenantID:      tenantID,
			ProjectKey:    spaceKey,
			SourceURL:     sourceURL,
			ExternalID:    entityID,
			Aspect:        "attachments",
			ChunkIndex:    0,
			ParentNodeID:  parentNodeID,
			EmbeddingType: "dense",
			Metadata: map[string]any{
				"pageId":     entityID,
				"entityType": entityType,
				"spaceKey":   spaceKey,
			},
		})
	}

	// Metadata aspect (sparse/BM25)
	// P2 Fix: Pass resolved spaceKey instead of relying on payload lookup
	metadataText := buildConfluenceMetadataText(payload, spaceKey)
	if metadataText != "" {
		// P2 Fix: Use entity-type-specific profile ID
		metadataProfileID := fmt.Sprintf("source.confluence.%s.metadata.v2", entityType)
		records = append(records, endpoint.VectorIndexRecord{
			NodeID:        fmt.Sprintf("%s:aspect:metadata", parentNodeID),
			ProfileID:     metadataProfileID,
			EntityKind:    fmt.Sprintf("document.%s.metadata", entityType),
			Text:          metadataText,
			SourceFamily:  "confluence",
			TenantID:      tenantID,
			ProjectKey:    spaceKey,
			SourceURL:     sourceURL,
			ExternalID:    entityID,
			Aspect:        "metadata",
			ChunkIndex:    0,
			ParentNodeID:  parentNodeID,
			EmbeddingType: "sparse",
			Metadata: map[string]any{
				"pageId":     entityID,
				"entityType": entityType,
				"spaceKey":   spaceKey,
			},
		})
	}

	return records
}

// ===================================================
// Helper Functions
// ===================================================

func extractSourceURL(payload map[string]any) string {
	if url := asString(payload["url"]); url != "" {
		return url
	}
	if url := asString(payload["webUrl"]); url != "" {
		return url
	}
	// P2 Fix: Handle nested _links map (Confluence Cloud API format)
	if links, ok := payload["_links"].(map[string]any); ok {
		if webui := asString(links["webui"]); webui != "" {
			return webui
		}
	}
	return ""
}

func extractConfluenceBody(payload map[string]any) string {
	if body := asString(payload["body"]); body != "" {
		return body
	}
	if bodyObj, ok := payload["body"].(map[string]any); ok {
		if storage, ok := bodyObj["storage"].(map[string]any); ok {
			if value := asString(storage["value"]); value != "" {
				return stripHTMLTags(value)
			}
		}
		if view, ok := bodyObj["view"].(map[string]any); ok {
			if value := asString(view["value"]); value != "" {
				return stripHTMLTags(value)
			}
		}
	}
	if content := asString(payload["content"]); content != "" {
		return content
	}
	return ""
}

func extractConfluenceComments(payload map[string]any) string {
	comments, ok := payload["comments"].([]any)
	if !ok {
		if children, ok := payload["children"].(map[string]any); ok {
			if comment, ok := children["comment"].(map[string]any); ok {
				if results, ok := comment["results"].([]any); ok {
					comments = results
				}
			}
		}
	}
	if len(comments) == 0 {
		return ""
	}
	var texts []string
	for _, c := range comments {
		if cm, ok := c.(map[string]any); ok {
			if body := asString(cm["body"]); body != "" {
				texts = append(texts, body)
				continue
			}
			if bodyObj, ok := cm["body"].(map[string]any); ok {
				if storage, ok := bodyObj["storage"].(map[string]any); ok {
					if value := asString(storage["value"]); value != "" {
						texts = append(texts, stripHTMLTags(value))
					}
				}
			}
		}
	}
	return strings.Join(texts, "\n\n---\n\n")
}

func extractConfluenceAttachments(payload map[string]any) string {
	attachments, ok := payload["attachments"].([]any)
	if !ok {
		if children, ok := payload["children"].(map[string]any); ok {
			if attachment, ok := children["attachment"].(map[string]any); ok {
				if results, ok := attachment["results"].([]any); ok {
					attachments = results
				}
			}
		}
	}
	if len(attachments) == 0 {
		return ""
	}
	var parts []string
	for _, a := range attachments {
		if att, ok := a.(map[string]any); ok {
			if title := asString(att["title"]); title != "" {
				parts = append(parts, "attachment:"+title)
			}
		}
	}
	return strings.Join(parts, " ")
}

// P2 Fix: Accept resolved spaceKey as parameter for consistent metadata
func buildConfluenceMetadataText(payload map[string]any, resolvedSpaceKey string) string {
	var parts []string
	// Use resolved space key which includes fallback logic
	if resolvedSpaceKey != "" {
		parts = append(parts, "space:"+resolvedSpaceKey)
	}
	for _, l := range extractConfluenceLabels(payload) {
		parts = append(parts, "label:"+l)
	}
	if status := asString(payload["status"]); status != "" {
		parts = append(parts, "status:"+status)
	}
	if author := extractConfluenceAuthor(payload); author != "" {
		parts = append(parts, "author:"+author)
	}
	for _, a := range extractConfluenceAncestors(payload) {
		parts = append(parts, "ancestor:"+a)
	}
	if contentType := asString(payload["type"]); contentType != "" {
		parts = append(parts, "type:"+contentType)
	}
	return strings.Join(parts, " ")
}

func extractConfluenceLabels(payload map[string]any) []string {
	var labels []string
	if labelsRaw, ok := payload["labels"].([]any); ok {
		for _, l := range labelsRaw {
			if s, ok := l.(string); ok && strings.TrimSpace(s) != "" {
				labels = append(labels, strings.TrimSpace(s))
			} else if m, ok := l.(map[string]any); ok {
				if name := asString(m["name"]); name != "" {
					labels = append(labels, name)
				}
			}
		}
	}
	if metadata, ok := payload["metadata"].(map[string]any); ok {
		if labelsObj, ok := metadata["labels"].(map[string]any); ok {
			if results, ok := labelsObj["results"].([]any); ok {
				for _, l := range results {
					if m, ok := l.(map[string]any); ok {
						if name := asString(m["name"]); name != "" {
							labels = append(labels, name)
						}
					}
				}
			}
		}
	}
	return labels
}

func extractConfluenceAuthor(payload map[string]any) string {
	if creator, ok := payload["creator"].(map[string]any); ok {
		if displayName := asString(creator["displayName"]); displayName != "" {
			return displayName
		}
	}
	if author, ok := payload["author"].(map[string]any); ok {
		if displayName := asString(author["displayName"]); displayName != "" {
			return displayName
		}
	}
	if history, ok := payload["history"].(map[string]any); ok {
		if createdBy, ok := history["createdBy"].(map[string]any); ok {
			if displayName := asString(createdBy["displayName"]); displayName != "" {
				return displayName
			}
		}
	}
	return ""
}

func extractConfluenceAncestors(payload map[string]any) []string {
	var ancestors []string
	if ancestorsRaw, ok := payload["ancestors"].([]any); ok {
		for _, a := range ancestorsRaw {
			if m, ok := a.(map[string]any); ok {
				if title := asString(m["title"]); title != "" {
					ancestors = append(ancestors, title)
				}
			}
		}
	}
	return ancestors
}

func stripHTMLTags(s string) string {
	var result strings.Builder
	inTag := false
	for _, r := range s {
		if r == '<' {
			inTag = true
			continue
		}
		if r == '>' {
			inTag = false
			result.WriteRune(' ')
			continue
		}
		if !inTag {
			result.WriteRune(r)
		}
	}
	text := result.String()
	text = strings.Join(strings.Fields(text), " ")
	return strings.TrimSpace(text)
}

func asString(v any) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	default:
		return ""
	}
}

// Ensure interface compliance
var _ endpoint.MultiRecordVectorProfileProvider = (*ConfluenceMultiRecordProvider)(nil)
