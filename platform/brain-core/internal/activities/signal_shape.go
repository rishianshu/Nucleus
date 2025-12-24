package activities

import "strings"

func deriveEntityRef(rec map[string]any) string {
	if v, ok := rec["entityRef"].(string); ok && strings.TrimSpace(v) != "" {
		return v
	}
	if v, ok := rec["id"].(string); ok && strings.TrimSpace(v) != "" {
		return v
	}
	if v, ok := rec["key"].(string); ok && strings.TrimSpace(v) != "" {
		return v
	}
	return ""
}

func deriveEntityKind(rec map[string]any, datasetSlug, sourceFamily string) string {
	if v, ok := rec["entityKind"].(string); ok && strings.TrimSpace(v) != "" {
		return v
	}
	if strings.TrimSpace(datasetSlug) != "" {
		return datasetSlug
	}
	return strings.ToLower(strings.TrimSpace(sourceFamily))
}
