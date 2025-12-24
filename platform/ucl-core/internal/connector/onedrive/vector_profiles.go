package onedrive

import (
	"fmt"
	"strings"

	"github.com/nucleus/ucl-core/pkg/vectorprofile"
	"github.com/nucleus/ucl-core/pkg/vectorstore"
)

func init() {
	vectorprofile.Register("source.onedrive.docs.v1", &docNormalizer{})
}

type docNormalizer struct{}

func (n *docNormalizer) Normalize(rec map[string]any) (vectorstore.Entry, string, bool) {
	payload, _ := rec["payload"].(map[string]any)
	if payload == nil {
		return vectorstore.Entry{}, "", false
	}
	docID := asString(payload["id"])
	name := asString(payload["name"])
	content := asString(payload["content"])
	path := asString(payload["path"])
	if docID == "" || name == "" || content == "" {
		return vectorstore.Entry{}, "", false
	}
	nodeID := fmt.Sprintf("doc:onedrive:%s", docID)
	entry := vectorstore.Entry{
		ProfileID:    "source.onedrive.docs.v1",
		NodeID:       nodeID,
		SourceFamily: "onedrive",
		EntityKind:   "doc.file",
		ContentText:  content,
		Metadata: map[string]any{
			"docId": docID,
			"name":  name,
			"path":  path,
		},
		RawPayload: payload,
	}
	return entry, content, true
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
