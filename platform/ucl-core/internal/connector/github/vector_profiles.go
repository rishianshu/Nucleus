package github

import (
	"fmt"
	"strings"

	"github.com/nucleus/store-core/pkg/vectorstore"
	"github.com/nucleus/ucl-core/internal/endpoint"
	"github.com/nucleus/ucl-core/pkg/vectorprofile"
)

func init() {
	vectorprofile.Register("source.github.code.v1", &codeNormalizer{})
	vectorprofile.Register("source.github.issues.v1", &issueNormalizer{})
	// Register multi-record provider
	endpoint.RegisterMultiRecordProvider("http.github", &GitHubMultiRecordProvider{})
}

// codeNormalizer expects payload fields: repo, path, sha, chunkIndex, text.
type codeNormalizer struct{}

func (n *codeNormalizer) Normalize(rec map[string]any) (vectorstore.Entry, string, bool) {
	payload, _ := rec["payload"].(map[string]any)
	if payload == nil {
		return vectorstore.Entry{}, "", false
	}
	repo := asString(payload["repo"])
	path := asString(payload["path"])
	sha := asString(payload["sha"])
	chunkIdx := asInt(payload["chunkIndex"])
	text := asString(payload["text"])
	if repo == "" {
		repo = asString(rec["projectKey"])
	}
	if repo == "" || path == "" || sha == "" || text == "" {
		return vectorstore.Entry{}, "", false
	}
	nodeID := fmt.Sprintf("code:github:%s:%s:%d", repo, path, chunkIdx)
	entry := vectorstore.Entry{
		ProfileID:    "source.github.code.v1",
		NodeID:       nodeID,
		SourceFamily: "github",
		EntityKind:   "code.file_chunk",
		ContentText:  text,
		Metadata: map[string]any{
			"repo":       repo,
			"path":       path,
			"sha":        sha,
			"chunkIndex": chunkIdx,
		},
		RawPayload: payload,
	}
	return entry, text, true
}

// issueNormalizer expects payload: id/number, title, body, repo, labels.
type issueNormalizer struct{}

func (n *issueNormalizer) Normalize(rec map[string]any) (vectorstore.Entry, string, bool) {
	payload, _ := rec["payload"].(map[string]any)
	if payload == nil {
		return vectorstore.Entry{}, "", false
	}
	issueID := asString(payload["id"])
	if issueID == "" {
		issueID = asString(payload["number"])
	}
	title := asString(payload["title"])
	body := asString(payload["body"])
	repo := asString(payload["repo"])
	if repo == "" {
		repo = asString(rec["projectKey"])
	}
	if issueID == "" || title == "" || repo == "" {
		return vectorstore.Entry{}, "", false
	}
	labels := extractLabels(payload["labels"])
	text := strings.TrimSpace(strings.Join([]string{title, body}, "\n\n"))
	nodeID := fmt.Sprintf("work:github:%s:issue:%s", repo, issueID)
	entry := vectorstore.Entry{
		ProfileID:    "source.github.issues.v1",
		NodeID:       nodeID,
		SourceFamily: "github",
		EntityKind:   "work.item",
		Labels:       labels,
		ContentText:  text,
		Metadata: map[string]any{
			"issueId": issueID,
			"repo":    repo,
		},
		RawPayload: payload,
	}
	return entry, text, true
}

func extractLabels(v any) []string {
	var out []string
	switch t := v.(type) {
	case []any:
		for _, item := range t {
			if m, ok := item.(map[string]any); ok {
				if name, ok := m["name"].(string); ok && strings.TrimSpace(name) != "" {
					out = append(out, strings.TrimSpace(name))
				}
			} else if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
	}
	return out
}

// ===================================================
// Multi-Record Vector Profile Provider
// Produces multiple embedding records per GitHub entity
// ===================================================

// GitHubMultiRecordProvider implements MultiRecordVectorProfileProvider.
type GitHubMultiRecordProvider struct{}

// GetVectorProfiles returns supported profile IDs.
func (p *GitHubMultiRecordProvider) GetVectorProfiles() []string {
	return []string{
		"source.github.issues.title.v2",
		"source.github.issues.body.v2",
		"source.github.issues.comments.v2",
		"source.github.issues.metadata.v2",
		"source.github.pr.title.v2",
		"source.github.pr.body.v2",
		"source.github.pr.diff.v2",
	}
}

// GetAspectConfigs returns aspect configurations for GitHub.
func (p *GitHubMultiRecordProvider) GetAspectConfigs() []endpoint.AspectConfig {
	return []endpoint.AspectConfig{
		{Name: "title", EmbeddingType: "dense", ChunkStrategy: "none", MaxChunkSize: 0},
		{Name: "body", EmbeddingType: "dense", ChunkStrategy: "paragraph", MaxChunkSize: 1000, ChunkOverlap: 100},
		{Name: "comments", EmbeddingType: "dense", ChunkStrategy: "sliding_window", MaxChunkSize: 500, ChunkOverlap: 50},
		{Name: "diff", EmbeddingType: "dense", ChunkStrategy: "sliding_window", MaxChunkSize: 800, ChunkOverlap: 100},
		{Name: "metadata", EmbeddingType: "sparse", ChunkStrategy: "none", MaxChunkSize: 0},
	}
}

// NormalizeForMultiIndex produces multiple vector records for a GitHub entity.
func (p *GitHubMultiRecordProvider) NormalizeForMultiIndex(rec endpoint.Record) []endpoint.VectorIndexRecord {
	payload, _ := rec["payload"].(map[string]any)
	if payload == nil {
		payload = rec
	}

	// Determine entity type
	var entityID, entityType string
	if issueID := asString(payload["issueId"]); issueID != "" {
		entityID = issueID
		entityType = "issue"
	} else if issueID := asString(payload["id"]); issueID != "" {
		entityID = issueID
		entityType = "issue"
	} else if prID := asString(payload["prId"]); prID != "" {
		entityID = prID
		entityType = "pr"
	} else if number := asString(payload["number"]); number != "" {
		entityID = number
		if _, ok := payload["merged"]; ok {
			entityType = "pr"
		} else {
			entityType = "issue"
		}
	}

	if entityID == "" {
		return nil
	}

	repo := asString(payload["repo"])
	if repo == "" {
		repo = asString(rec["projectKey"])
	}
	if repo == "" {
		return nil
	}

	parentNodeID := fmt.Sprintf("work:github:%s:%s:%s", repo, entityType, entityID)
	tenantID := asString(rec["tenantId"])
	sourceURL := asString(payload["url"])
	if sourceURL == "" {
		sourceURL = asString(payload["htmlUrl"])
	}

	var records []endpoint.VectorIndexRecord
	configs := p.GetAspectConfigs()

	// Title aspect
	title := asString(payload["title"])
	if title != "" {
		profileID := fmt.Sprintf("source.github.%s.title.v2", entityType)
		records = append(records, endpoint.VectorIndexRecord{
			NodeID:        fmt.Sprintf("%s:aspect:title", parentNodeID),
			ProfileID:     profileID,
			EntityKind:    fmt.Sprintf("work.%s.title", entityType),
			Text:          title,
			SourceFamily:  "github",
			TenantID:      tenantID,
			ProjectKey:    repo,
			SourceURL:     sourceURL,
			ExternalID:    entityID,
			Aspect:        "title",
			ChunkIndex:    0,
			ParentNodeID:  parentNodeID,
			EmbeddingType: "dense",
			Metadata: map[string]any{
				"entityId":   entityID,
				"entityType": entityType,
				"repo":       repo,
			},
		})
	}

	// Body aspect (with chunking)
	body := asString(payload["body"])
	if body != "" {
		bodyConfig := configs[1] // body config
		chunks := endpoint.ChunkText(body, bodyConfig)
		profileID := fmt.Sprintf("source.github.%s.body.v2", entityType)
		for i, chunk := range chunks {
			records = append(records, endpoint.VectorIndexRecord{
				NodeID:        fmt.Sprintf("%s:aspect:body:%d", parentNodeID, i),
				ProfileID:     profileID,
				EntityKind:    fmt.Sprintf("work.%s.body", entityType),
				Text:          chunk,
				SourceFamily:  "github",
				TenantID:      tenantID,
				ProjectKey:    repo,
				SourceURL:     sourceURL,
				ExternalID:    entityID,
				Aspect:        "body",
				ChunkIndex:    i,
				ParentNodeID:  parentNodeID,
				EmbeddingType: "dense",
				Metadata: map[string]any{
					"entityId":    entityID,
					"entityType":  entityType,
					"repo":        repo,
					"chunkIndex":  i,
					"totalChunks": len(chunks),
				},
			})
		}
	}

	// Comments aspect (with chunking) - P2 Fix: add comment embeddings
	comments := extractGitHubComments(payload)
	if comments != "" {
		commConfig := configs[2] // comments config
		chunks := endpoint.ChunkText(comments, commConfig)
		for i, chunk := range chunks {
			records = append(records, endpoint.VectorIndexRecord{
				NodeID:        fmt.Sprintf("%s:aspect:comments:%d", parentNodeID, i),
				ProfileID:     "source.github.issues.comments.v2",
				EntityKind:    fmt.Sprintf("work.%s.comments", entityType),
				Text:          chunk,
				SourceFamily:  "github",
				TenantID:      tenantID,
				ProjectKey:    repo,
				SourceURL:     sourceURL,
				ExternalID:    entityID,
				Aspect:        "comments",
				ChunkIndex:    i,
				ParentNodeID:  parentNodeID,
				EmbeddingType: "dense",
				Metadata: map[string]any{
					"entityId":    entityID,
					"entityType":  entityType,
					"repo":        repo,
					"chunkIndex":  i,
					"totalChunks": len(chunks),
				},
			})
		}
	}

	// Diff aspect (for PRs)
	if entityType == "pr" {
		diff := asString(payload["diff"])
		if diff != "" {
			diffConfig := configs[3] // diff config
			chunks := endpoint.ChunkText(diff, diffConfig)
			for i, chunk := range chunks {
				records = append(records, endpoint.VectorIndexRecord{
					NodeID:        fmt.Sprintf("%s:aspect:diff:%d", parentNodeID, i),
					ProfileID:     "source.github.pr.diff.v2",
					EntityKind:    "work.pr.diff",
					Text:          chunk,
					SourceFamily:  "github",
					TenantID:      tenantID,
					ProjectKey:    repo,
					SourceURL:     sourceURL,
					ExternalID:    entityID,
					Aspect:        "diff",
					ChunkIndex:    i,
					ParentNodeID:  parentNodeID,
					EmbeddingType: "dense",
					Metadata: map[string]any{
						"entityId":    entityID,
						"repo":        repo,
						"chunkIndex":  i,
						"totalChunks": len(chunks),
					},
				})
			}
		}
	}

	// Metadata aspect (sparse/BM25)
	metadataText := buildGitHubMetadataText(payload)
	if metadataText != "" {
		records = append(records, endpoint.VectorIndexRecord{
			NodeID:        fmt.Sprintf("%s:aspect:metadata", parentNodeID),
			ProfileID:     "source.github.issues.metadata.v2",
			EntityKind:    fmt.Sprintf("work.%s.metadata", entityType),
			Text:          metadataText,
			SourceFamily:  "github",
			TenantID:      tenantID,
			ProjectKey:    repo,
			SourceURL:     sourceURL,
			ExternalID:    entityID,
			Aspect:        "metadata",
			ChunkIndex:    0,
			ParentNodeID:  parentNodeID,
			EmbeddingType: "sparse",
			Metadata: map[string]any{
				"entityId":   entityID,
				"entityType": entityType,
				"repo":       repo,
			},
		})
	}

	return records
}

// buildGitHubMetadataText creates searchable text from metadata.
func buildGitHubMetadataText(payload map[string]any) string {
	var parts []string

	// Labels
	labels := extractLabels(payload["labels"])
	for _, l := range labels {
		parts = append(parts, "label:"+l)
	}

	// State
	if state := asString(payload["state"]); state != "" {
		parts = append(parts, "state:"+state)
	}

	// Author
	if author := asString(payload["author"]); author != "" {
		parts = append(parts, "author:"+author)
	}

	// Assignees
	if assignees, ok := payload["assignees"].([]any); ok {
		for _, a := range assignees {
			if s, ok := a.(string); ok && s != "" {
				parts = append(parts, "assignee:"+s)
			}
		}
	}

	// Milestone
	if milestone := asString(payload["milestone"]); milestone != "" {
		parts = append(parts, "milestone:"+milestone)
	}

	return strings.Join(parts, " ")
}

// extractGitHubComments combines all comments into a single text.
func extractGitHubComments(payload map[string]any) string {
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

// Ensure interface compliance
var _ endpoint.MultiRecordVectorProfileProvider = (*GitHubMultiRecordProvider)(nil)
