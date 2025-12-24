package activities

import (
	"fmt"
	"strings"

	"github.com/nucleus/ucl-core/pkg/vectorprofile"
	"github.com/nucleus/store-core/pkg/vectorstore"
)

// normalizeVectorRecord builds a vector entry and content text from a raw record map based on profile.
// Returns (entry, content, ok).
func normalizeVectorRecord(rec map[string]any, profileID, tenantID, projectID, datasetSlug, sinkEndpointID string) (vectorstore.Entry, string, bool) {
	// Unwrap nested payloads when staging envelopes wrap the original record under payload.payload.
	normRec := rec
	if payload, ok := rec["payload"].(map[string]any); ok {
		if inner, ok := payload["payload"].(map[string]any); ok {
			clone := make(map[string]any, len(rec))
			for k, v := range rec {
				clone[k] = v
			}
			clone["payload"] = inner
			normRec = clone
		}
	}

	n := vectorprofile.Resolve(profileID)
	entry, content, ok := n.Normalize(normRec)
	if !ok {
		// Fallback to rawPayload (pre-mapped) when available.
		if raw, ok := rec["rawPayload"].(map[string]any); ok {
			clone := make(map[string]any, len(rec))
			for k, v := range rec {
				clone[k] = v
			}
			clone["payload"] = raw
			entry, content, ok = n.Normalize(clone)
		}
	}
	if !ok {
		return vectorstore.Entry{}, "", false
	}
	// Imprint normalized fields that normalizers might not set.
	out := vectorstore.Entry{
		TenantID:       entry.TenantID,
		ProjectID:      entry.ProjectID,
		ProfileID:      entry.ProfileID,
		NodeID:         entry.NodeID,
		SourceFamily:   entry.SourceFamily,
		ArtifactID:     entry.ArtifactID,
		RunID:          entry.RunID,
		SinkEndpointID: entry.SinkEndpointID,
		DatasetSlug:    entry.DatasetSlug,
		EntityKind:     entry.EntityKind,
		Labels:         entry.Labels,
		Tags:           entry.Tags,
		ContentText:    entry.ContentText,
		Metadata:       entry.Metadata,
		RawPayload:     entry.RawPayload,
		RawMetadata:    entry.RawMetadata,
		Embedding:      entry.Embedding,
		UpdatedAt:      entry.UpdatedAt,
	}
	if out.TenantID == "" {
		out.TenantID = tenantID
	}
	if out.ProjectID == "" {
		out.ProjectID = projectID
	}
	if out.DatasetSlug == "" {
		out.DatasetSlug = datasetSlug
	}
	if out.SinkEndpointID == "" {
		out.SinkEndpointID = sinkEndpointID
	}
	if out.ProfileID == "" {
		out.ProfileID = profileID
	}
	if out.NodeID == "" {
		out.NodeID = entry.NodeID
	}
	if out.SourceFamily == "" {
		out.SourceFamily = entry.SourceFamily
	}
	return out, content, true
}

func asMap(v any) map[string]any {
	if v == nil {
		return nil
	}
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case fmt.Stringer:
		return strings.TrimSpace(t.String())
	default:
		return ""
	}
}

func asInt(v any) *int {
	switch t := v.(type) {
	case int:
		return &t
	case int32:
		val := int(t)
		return &val
	case int64:
		val := int(t)
		return &val
	case float64:
		val := int(t)
		return &val
	case float32:
		val := int(t)
		return &val
	default:
		return nil
	}
}

func hasField(rec map[string]any, key string) bool {
	if rec == nil {
		return false
	}
	if payload, ok := rec["payload"].(map[string]any); ok {
		if _, ok := payload[key]; ok {
			return true
		}
	}
	_, ok := rec[key]
	return ok
}
