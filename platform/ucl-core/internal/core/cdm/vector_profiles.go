package cdm

import (
	"fmt"
	"strings"

	"github.com/nucleus/ucl-core/pkg/vectorprofile"
	"github.com/nucleus/ucl-core/pkg/vectorstore"
)

func init() {
	vectorprofile.Register("cdm.work.item.v1", &workItemNormalizer{})
	vectorprofile.Register("cdm.doc.item.v1", &docItemNormalizer{})
}

type workItemNormalizer struct{}

func (n *workItemNormalizer) Normalize(rec map[string]any) (vectorstore.Entry, string, bool) {
	payload, _ := rec["payload"].(map[string]any)
	if payload == nil {
		return vectorstore.Entry{}, "", false
	}
	cdmID := asString(payload["cdmId"])
	if cdmID == "" {
		cdmID = asString(payload["CdmID"])
	}
	sourceSystem := asString(payload["sourceSystem"])
	summary := asString(payload["summary"])
	description := asString(payload["description"])
	project := asString(payload["project"])
	if cdmID == "" && sourceSystem != "" {
		issueKey := asString(payload["sourceIssueKey"])
		if issueKey == "" {
			issueKey = asString(payload["issueKey"])
		}
		if issueKey != "" {
			cdmID = fmt.Sprintf("cdm:work:item:%s:%s", sourceSystem, issueKey)
		}
	}
	if cdmID == "" || summary == "" {
		return vectorstore.Entry{}, "", false
	}
	text := strings.TrimSpace(strings.Join([]string{summary, description}, "\n\n"))
	entry := vectorstore.Entry{
		ProfileID:    "cdm.work.item.v1",
		NodeID:       cdmID,
		SourceFamily: sourceSystem,
		EntityKind:   "work.item",
		ContentText:  text,
		Metadata: map[string]any{
			"project": project,
			"source":  sourceSystem,
		},
		RawPayload: payload,
	}
	return entry, text, true
}

type docItemNormalizer struct{}

func (n *docItemNormalizer) Normalize(rec map[string]any) (vectorstore.Entry, string, bool) {
	payload, _ := rec["payload"].(map[string]any)
	if payload == nil {
		return vectorstore.Entry{}, "", false
	}
	cdmID := asString(payload["cdmId"])
	if cdmID == "" {
		cdmID = asString(payload["CdmID"])
	}
	sourceSystem := asString(payload["sourceSystem"])
	title := asString(payload["title"])
	summary := asString(payload["summary"])
	if cdmID == "" && sourceSystem != "" {
		itemID := asString(payload["sourceItemId"])
		if itemID == "" {
			itemID = asString(payload["itemId"])
		}
		if itemID != "" {
			cdmID = fmt.Sprintf("cdm:doc:item:%s:%s", sourceSystem, itemID)
		}
	}
	if cdmID == "" || title == "" {
		return vectorstore.Entry{}, "", false
	}
	text := strings.TrimSpace(strings.Join([]string{title, summary}, "\n\n"))
	entry := vectorstore.Entry{
		ProfileID:    "cdm.doc.item.v1",
		NodeID:       cdmID,
		SourceFamily: sourceSystem,
		EntityKind:   "doc.item",
		ContentText:  text,
		Metadata: map[string]any{
			"source": sourceSystem,
			"title":  title,
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
