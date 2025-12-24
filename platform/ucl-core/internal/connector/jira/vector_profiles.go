package jira

import (
	"fmt"
	"strings"

	"github.com/nucleus/ucl-core/pkg/vectorprofile"
	"github.com/nucleus/store-core/pkg/vectorstore"
)

func init() {
	vectorprofile.Register("source.jira.issues.v1", &issueNormalizer{})
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
