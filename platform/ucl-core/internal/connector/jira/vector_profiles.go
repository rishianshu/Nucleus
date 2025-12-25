package jira

import (
	"fmt"
	"strings"

	"github.com/nucleus/store-core/pkg/vectorstore"
	"github.com/nucleus/ucl-core/internal/endpoint"
	"github.com/nucleus/ucl-core/pkg/vectorprofile"
)

func init() {
	vectorprofile.Register("source.jira.issues.v1", &issueNormalizer{})
	// Register multi-record provider
	endpoint.RegisterMultiRecordProvider("http.jira", &JiraMultiRecordProvider{})
}

type issueNormalizer struct{}

func (n *issueNormalizer) Normalize(rec map[string]any) (vectorstore.Entry, string, bool) {
	payload, _ := rec["payload"].(map[string]any)
	if payload == nil {
		return vectorstore.Entry{}, "", false
	}
	issueID := asString(payload["id"])
	if issueID == "" {
		issueID = asString(payload["key"])
	}
	title := asString(payload["summary"])
	if title == "" {
		title = asString(payload["title"])
	}
	body := asString(payload["description"])
	project := asString(payload["projectKey"])
	if project == "" {
		project = asString(rec["projectKey"])
	}
	if issueID == "" || title == "" || project == "" {
		return vectorstore.Entry{}, "", false
	}
	text := strings.TrimSpace(strings.Join([]string{title, body}, "\n\n"))
	nodeID := fmt.Sprintf("work:jira:%s:issue:%s", project, issueID)
	entry := vectorstore.Entry{
		ProfileID:    "source.jira.issues.v1",
		NodeID:       nodeID,
		SourceFamily: "jira",
		EntityKind:   "work.item",
		ContentText:  text,
		Metadata: map[string]any{
			"issueId": issueID,
			"project": project,
		},
		RawPayload: payload,
	}
	return entry, text, true
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

// ===================================================
// Multi-Record Vector Profile Provider
// Produces multiple embedding records per Jira issue
// ===================================================

// JiraMultiRecordProvider implements MultiRecordVectorProfileProvider.
type JiraMultiRecordProvider struct{}

// GetVectorProfiles returns supported profile IDs.
func (p *JiraMultiRecordProvider) GetVectorProfiles() []string {
	return []string{
		"source.jira.issues.title.v2",
		"source.jira.issues.description.v2",
		"source.jira.issues.comments.v2",
		"source.jira.issues.metadata.v2",
	}
}

// GetAspectConfigs returns aspect configurations for Jira issues.
func (p *JiraMultiRecordProvider) GetAspectConfigs() []endpoint.AspectConfig {
	return []endpoint.AspectConfig{
		{Name: "title", EmbeddingType: "dense", ChunkStrategy: "none", MaxChunkSize: 0},
		{Name: "description", EmbeddingType: "dense", ChunkStrategy: "paragraph", MaxChunkSize: 1000, ChunkOverlap: 100},
		{Name: "comments", EmbeddingType: "dense", ChunkStrategy: "sliding_window", MaxChunkSize: 500, ChunkOverlap: 50},
		{Name: "metadata", EmbeddingType: "sparse", ChunkStrategy: "none", MaxChunkSize: 0},
	}
}

// NormalizeForMultiIndex produces multiple vector records for a Jira issue.
func (p *JiraMultiRecordProvider) NormalizeForMultiIndex(rec endpoint.Record) []endpoint.VectorIndexRecord {
	payload, _ := rec["payload"].(map[string]any)
	if payload == nil {
		payload = rec // Fallback to root
	}

	// Extract core fields
	issueID := asString(payload["id"])
	if issueID == "" {
		issueID = asString(payload["key"])
	}
	project := asString(payload["projectKey"])
	if project == "" {
		project = asString(rec["projectKey"])
	}
	if issueID == "" || project == "" {
		return nil
	}

	parentNodeID := fmt.Sprintf("work:jira:%s:issue:%s", project, issueID)
	tenantID := asString(rec["tenantId"])
	sourceURL := asString(payload["url"])
	if sourceURL == "" {
		sourceURL = asString(payload["self"])
	}

	var records []endpoint.VectorIndexRecord
	configs := p.GetAspectConfigs()

	// Title aspect
	title := asString(payload["summary"])
	if title == "" {
		title = asString(payload["title"])
	}
	if title != "" {
		records = append(records, endpoint.VectorIndexRecord{
			NodeID:        fmt.Sprintf("%s:aspect:title", parentNodeID),
			ProfileID:     "source.jira.issues.title.v2",
			EntityKind:    "work.item.title",
			Text:          title,
			SourceFamily:  "jira",
			TenantID:      tenantID,
			ProjectKey:    project,
			SourceURL:     sourceURL,
			ExternalID:    issueID,
			Aspect:        "title",
			ChunkIndex:    0,
			ParentNodeID:  parentNodeID,
			EmbeddingType: "dense",
			Metadata: map[string]any{
				"issueId": issueID,
				"project": project,
			},
		})
	}

	// Description aspect (with chunking)
	description := asString(payload["description"])
	if description != "" {
		descConfig := configs[1] // description config
		chunks := endpoint.ChunkText(description, descConfig)
		for i, chunk := range chunks {
			records = append(records, endpoint.VectorIndexRecord{
				NodeID:        fmt.Sprintf("%s:aspect:description:%d", parentNodeID, i),
				ProfileID:     "source.jira.issues.description.v2",
				EntityKind:    "work.item.description",
				Text:          chunk,
				SourceFamily:  "jira",
				TenantID:      tenantID,
				ProjectKey:    project,
				SourceURL:     sourceURL,
				ExternalID:    issueID,
				Aspect:        "description",
				ChunkIndex:    i,
				ParentNodeID:  parentNodeID,
				EmbeddingType: "dense",
				Metadata: map[string]any{
					"issueId":    issueID,
					"project":    project,
					"chunkIndex": i,
					"totalChunks": len(chunks),
				},
			})
		}
	}

	// Comments aspect (with chunking)
	comments := extractComments(payload)
	if comments != "" {
		commConfig := configs[2] // comments config
		chunks := endpoint.ChunkText(comments, commConfig)
		for i, chunk := range chunks {
			records = append(records, endpoint.VectorIndexRecord{
				NodeID:        fmt.Sprintf("%s:aspect:comments:%d", parentNodeID, i),
				ProfileID:     "source.jira.issues.comments.v2",
				EntityKind:    "work.item.comments",
				Text:          chunk,
				SourceFamily:  "jira",
				TenantID:      tenantID,
				ProjectKey:    project,
				SourceURL:     sourceURL,
				ExternalID:    issueID,
				Aspect:        "comments",
				ChunkIndex:    i,
				ParentNodeID:  parentNodeID,
				EmbeddingType: "dense",
				Metadata: map[string]any{
					"issueId":     issueID,
					"project":     project,
					"chunkIndex":  i,
					"totalChunks": len(chunks),
				},
			})
		}
	}

	// Metadata aspect (sparse/BM25)
	metadataText := buildMetadataText(payload)
	if metadataText != "" {
		records = append(records, endpoint.VectorIndexRecord{
			NodeID:        fmt.Sprintf("%s:aspect:metadata", parentNodeID),
			ProfileID:     "source.jira.issues.metadata.v2",
			EntityKind:    "work.item.metadata",
			Text:          metadataText,
			SourceFamily:  "jira",
			TenantID:      tenantID,
			ProjectKey:    project,
			SourceURL:     sourceURL,
			ExternalID:    issueID,
			Aspect:        "metadata",
			ChunkIndex:    0,
			ParentNodeID:  parentNodeID,
			EmbeddingType: "sparse",
			Metadata: map[string]any{
				"issueId": issueID,
				"project": project,
			},
		})
	}

	return records
}

// extractComments combines all comments into a single text.
func extractComments(payload map[string]any) string {
	comments, ok := payload["comments"].([]any)
	if !ok {
		return ""
	}
	var texts []string
	for _, c := range comments {
		if cm, ok := c.(map[string]any); ok {
			body := asString(cm["body"])
			if body != "" {
				texts = append(texts, body)
			}
		}
	}
	return strings.Join(texts, "\n\n---\n\n")
}

// buildMetadataText creates searchable text from metadata fields.
func buildMetadataText(payload map[string]any) string {
	var parts []string

	// Labels
	if labels, ok := payload["labels"].([]any); ok {
		for _, l := range labels {
			if s, ok := l.(string); ok && s != "" {
				parts = append(parts, "label:"+s)
			}
		}
	}

	// Components
	if components, ok := payload["components"].([]any); ok {
		for _, c := range components {
			if cm, ok := c.(map[string]any); ok {
				if name := asString(cm["name"]); name != "" {
					parts = append(parts, "component:"+name)
				}
			} else if s, ok := c.(string); ok && s != "" {
				parts = append(parts, "component:"+s)
			}
		}
	}

	// Priority
	if priority := asString(payload["priority"]); priority != "" {
		parts = append(parts, "priority:"+priority)
	}

	// Status
	if status := asString(payload["status"]); status != "" {
		parts = append(parts, "status:"+status)
	}

	// Issue type
	if issueType := asString(payload["issueType"]); issueType != "" {
		parts = append(parts, "type:"+issueType)
	}

	// Assignee
	if assignee := asString(payload["assignee"]); assignee != "" {
		parts = append(parts, "assignee:"+assignee)
	}

	// Reporter
	if reporter := asString(payload["reporter"]); reporter != "" {
		parts = append(parts, "reporter:"+reporter)
	}

	return strings.Join(parts, " ")
}

// Ensure interface compliance
var _ endpoint.MultiRecordVectorProfileProvider = (*JiraMultiRecordProvider)(nil)
