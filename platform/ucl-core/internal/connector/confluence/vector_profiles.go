package confluence

import (
	"fmt"
	"strings"

	"github.com/nucleus/ucl-core/pkg/vectorprofile"
	"github.com/nucleus/ucl-core/pkg/vectorstore"
)

func init() {
	vectorprofile.Register("source.confluence.pages.v1", &pageNormalizer{})
}

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
