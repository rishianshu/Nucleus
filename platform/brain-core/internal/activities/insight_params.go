package activities

import (
	"fmt"
	"strings"
)

// buildInsightParams constructs the params map required by a skill from the record payload.
// It returns false when required fields are missing.
func buildInsightParams(skill InsightSkill, payload map[string]any, entityKind string) (map[string]string, bool) {
	params := make(map[string]string)
	for k, v := range payload {
		if m, ok := v.(map[string]any); ok {
			for innerK, innerV := range m {
				params[k+"."+innerK] = toString(innerV)
			}
		} else {
			params[k] = toString(v)
		}
	}
	// Per-entityKind overrides: if payload has nested map under entityKind, flatten it with prefix.
	if ekMap, ok := payload[entityKind].(map[string]any); ok {
		for k, v := range ekMap {
			params[entityKind+"."+k] = toString(v)
		}
	}
	// Ensure required fields exist.
	for _, req := range skill.RequiredFields {
		if strings.TrimSpace(params[req]) == "" {
			// Try entityKind-prefixed alias
			if entityKind != "" {
				if v, ok := params[entityKind+"."+req]; ok && strings.TrimSpace(v) != "" {
					params[req] = v
					continue
				}
			}
			return nil, false
		}
	}
	return params, true
}

func toString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case int:
		return fmt.Sprintf("%d", t)
	case int64:
		return fmt.Sprintf("%d", t)
	case float64:
		return fmt.Sprintf("%v", t)
	case bool:
		if t {
			return "true"
		}
		return "false"
	default:
		return ""
	}
}
