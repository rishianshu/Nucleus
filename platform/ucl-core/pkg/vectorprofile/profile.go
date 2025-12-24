package vectorprofile

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/nucleus/ucl-core/pkg/vectorstore"
)

// Normalizer transforms a raw record (map) into a vector entry and content text.
type Normalizer interface {
	Normalize(record map[string]any) (vectorstore.Entry, string, bool)
}

// Simple registry for normalizers keyed by profileId.
var (
	registryMu sync.RWMutex
	registry   = map[string]Normalizer{}
)

// Register a normalizer for a profileId.
func Register(profileID string, n Normalizer) {
	registryMu.Lock()
	defer registryMu.Unlock()
	registry[profileID] = n
}

// Resolve returns a normalizer for profileId or a default fallback.
func Resolve(profileID string) Normalizer {
	registryMu.RLock()
	n, ok := registry[profileID]
	registryMu.RUnlock()
	if ok {
		return n
	}
	return &FallbackNormalizer{ProfileID: profileID}
}

// FallbackNormalizer is a minimal normalizer that tries to use payload.text as content
// and requires a payload.id or record["nodeId"] to form a nodeId.
type FallbackNormalizer struct {
	ProfileID string
}

func (f *FallbackNormalizer) Normalize(record map[string]any) (vectorstore.Entry, string, bool) {
	payload, _ := record["payload"].(map[string]any)
	content := asString(payload["text"])
	if content == "" {
		content = asString(record["content"])
	}
	if content == "" {
		if data, err := json.Marshal(record); err == nil && len(data) > 0 {
			content = string(data)
		}
	}
	if content == "" {
		return vectorstore.Entry{}, "", false
	}
	nodeID := asString(payload["id"])
	if nodeID == "" {
		nodeID = asString(record["nodeId"])
	}
	if nodeID == "" {
		return vectorstore.Entry{}, "", false
	}
	entry := vectorstore.Entry{
		ProfileID:   f.ProfileID,
		NodeID:      nodeID,
		ContentText: content,
		RawPayload:  payload,
	}
	return entry, content, true
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case fmt.Stringer:
		return t.String()
	default:
		return ""
	}
}
