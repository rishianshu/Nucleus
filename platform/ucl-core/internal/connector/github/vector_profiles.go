package github

import (
	"fmt"
	"strings"

	"github.com/nucleus/ucl-core/pkg/vectorprofile"
	"github.com/nucleus/ucl-core/pkg/vectorstore"
)

func init() {
	vectorprofile.Register("source.github.code.v1", &codeNormalizer{})
	vectorprofile.Register("source.github.issues.v1", &issueNormalizer{})
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
