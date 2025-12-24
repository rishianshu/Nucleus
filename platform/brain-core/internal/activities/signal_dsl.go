package activities

import (
	"fmt"
	"strings"
)

type SignalDefinitionType string

const (
	TypeWorkStale     SignalDefinitionType = "cdm.work.stale_item"
	TypeDocOrphan     SignalDefinitionType = "cdm.doc.orphan"
	TypeGenericFilter SignalDefinitionType = "cdm.generic.filter"
)

type IntervalUnit string

const (
	IntervalDays  IntervalUnit = "days"
	IntervalHours IntervalUnit = "hours"
)

type IntervalConfig struct {
	Unit  IntervalUnit `json:"unit"`
	Value int          `json:"value"`
}

type WorkStaleConfig struct {
	CdmModelID      string           `json:"cdmModelId"`
	MaxAge          IntervalConfig   `json:"maxAge"`
	StatusInclude   []string         `json:"statusInclude,omitempty"`
	StatusExclude   []string         `json:"statusExclude,omitempty"`
	ProjectInclude  []string         `json:"projectInclude,omitempty"`
	ProjectExclude  []string         `json:"projectExclude,omitempty"`
	SeverityMapping *SeverityMapping `json:"severityMapping,omitempty"`
}

type SeverityMapping struct {
	WarnAfter  *IntervalConfig `json:"warnAfter,omitempty"`
	ErrorAfter *IntervalConfig `json:"errorAfter,omitempty"`
}

type DocOrphanConfig struct {
	CdmModelID         string         `json:"cdmModelId"`
	MinAge             IntervalConfig `json:"minAge"`
	MinViewCount       *int           `json:"minViewCount,omitempty"`
	RequireProjectLink *bool          `json:"requireProjectLink,omitempty"`
	SpaceInclude       []string       `json:"spaceInclude,omitempty"`
	SpaceExclude       []string       `json:"spaceExclude,omitempty"`
}

type GenericFilterOp string

const (
	OpLT        GenericFilterOp = "LT"
	OpLTE       GenericFilterOp = "LTE"
	OpGT        GenericFilterOp = "GT"
	OpGTE       GenericFilterOp = "GTE"
	OpEQ        GenericFilterOp = "EQ"
	OpNEQ       GenericFilterOp = "NEQ"
	OpIN        GenericFilterOp = "IN"
	OpNOTIN     GenericFilterOp = "NOT_IN"
	OpISNULL    GenericFilterOp = "IS_NULL"
	OpISNOTNULL GenericFilterOp = "IS_NOT_NULL"
)

type GenericCondition struct {
	Field string          `json:"field"`
	Op    GenericFilterOp `json:"op"`
	Value any             `json:"value,omitempty"`
}

type GenericSeverityRule struct {
	When     []GenericCondition `json:"when"`
	Severity string             `json:"severity"`
}

type GenericFilterConfig struct {
	CdmModelID      string                `json:"cdmModelId"`
	Where           []GenericCondition    `json:"where"`
	SeverityRules   []GenericSeverityRule `json:"severityRules,omitempty"`
	SummaryTemplate string                `json:"summaryTemplate"`
}

type ParsedSpec struct {
	Version int                  `json:"version"`
	Type    SignalDefinitionType `json:"type"`
	Config  any                  `json:"config"`
}

type parseResult struct {
	Spec   ParsedSpec
	Valid  bool
	Reason string
}

func parseSignalSpec(input any) parseResult {
	m, ok := input.(map[string]any)
	if !ok {
		return parseResult{Valid: false, Reason: "definitionSpec must be an object"}
	}
	version, _ := m["version"].(int)
	if v, ok := m["version"].(float64); ok {
		version = int(v)
	}
	if version != 1 {
		return parseResult{Valid: false, Reason: fmt.Sprintf("unsupported definitionSpec version: %v", m["version"])}
	}
	t, _ := m["type"].(string)
	if t == "" {
		return parseResult{Valid: false, Reason: "definitionSpec.type is required"}
	}
	cfgRaw, ok := m["config"].(map[string]any)
	if !ok {
		return parseResult{Valid: false, Reason: "definitionSpec.config must be an object"}
	}
	switch SignalDefinitionType(t) {
	case TypeWorkStale:
		cfg, err := parseWorkStaleConfig(cfgRaw)
		if err != nil {
			return parseResult{Valid: false, Reason: err.Error()}
		}
		return parseResult{Valid: true, Spec: ParsedSpec{Version: 1, Type: TypeWorkStale, Config: cfg}}
	case TypeDocOrphan:
		cfg, err := parseDocOrphanConfig(cfgRaw)
		if err != nil {
			return parseResult{Valid: false, Reason: err.Error()}
		}
		return parseResult{Valid: true, Spec: ParsedSpec{Version: 1, Type: TypeDocOrphan, Config: cfg}}
	case TypeGenericFilter:
		cfg, err := parseGenericFilterConfig(cfgRaw)
		if err != nil {
			return parseResult{Valid: false, Reason: err.Error()}
		}
		return parseResult{Valid: true, Spec: ParsedSpec{Version: 1, Type: TypeGenericFilter, Config: cfg}}
	default:
		return parseResult{Valid: false, Reason: fmt.Sprintf("unsupported spec type %s", t)}
	}
}

func parseWorkStaleConfig(cfg map[string]any) (WorkStaleConfig, error) {
	if cfg["cdmModelId"] != "cdm.work.item" {
		return WorkStaleConfig{}, fmt.Errorf("cdmModelId must be cdm.work.item")
	}
	maxAge, ok := parseIntervalCfg(cfg["maxAge"])
	if !ok {
		return WorkStaleConfig{}, fmt.Errorf("maxAge is required (days|hours)")
	}
	var sevMap *SeverityMapping
	if m, ok := cfg["severityMapping"].(map[string]any); ok {
		sevMap = &SeverityMapping{}
		if warn, ok := parseIntervalCfg(m["warnAfter"]); ok {
			sevMap.WarnAfter = &warn
		}
		if errAfter, ok := parseIntervalCfg(m["errorAfter"]); ok {
			sevMap.ErrorAfter = &errAfter
		}
		if sevMap.WarnAfter == nil && sevMap.ErrorAfter == nil {
			sevMap = nil
		}
	}
	return WorkStaleConfig{
		CdmModelID:      "cdm.work.item",
		MaxAge:          maxAge,
		StatusInclude:   strSlice(cfg["statusInclude"]),
		StatusExclude:   strSlice(cfg["statusExclude"]),
		ProjectInclude:  strSlice(cfg["projectInclude"]),
		ProjectExclude:  strSlice(cfg["projectExclude"]),
		SeverityMapping: sevMap,
	}, nil
}

func parseDocOrphanConfig(cfg map[string]any) (DocOrphanConfig, error) {
	if cfg["cdmModelId"] != "cdm.doc.item" {
		return DocOrphanConfig{}, fmt.Errorf("cdmModelId must be cdm.doc.item")
	}
	minAge, ok := parseIntervalCfg(cfg["minAge"])
	if !ok {
		return DocOrphanConfig{}, fmt.Errorf("minAge is required (days|hours)")
	}
	minView := parseInt(cfg["minViewCount"])
	reqProj := parseBoolPtr(cfg["requireProjectLink"])
	return DocOrphanConfig{
		CdmModelID:         "cdm.doc.item",
		MinAge:             minAge,
		MinViewCount:       minView,
		RequireProjectLink: reqProj,
		SpaceInclude:       strSlice(cfg["spaceInclude"]),
		SpaceExclude:       strSlice(cfg["spaceExclude"]),
	}, nil
}

func parseGenericFilterConfig(cfg map[string]any) (GenericFilterConfig, error) {
	model, _ := cfg["cdmModelId"].(string)
	if model != "cdm.work.item" && model != "cdm.doc.item" {
		return GenericFilterConfig{}, fmt.Errorf("cdmModelId must be cdm.work.item or cdm.doc.item")
	}
	where, err := parseGenericConditions(cfg["where"], "where")
	if err != nil {
		return GenericFilterConfig{}, err
	}
	severityRules, err := parseSeverityRules(cfg["severityRules"])
	if err != nil {
		return GenericFilterConfig{}, err
	}
	summaryTemplate, _ := cfg["summaryTemplate"].(string)
	summaryTemplate = strings.TrimSpace(summaryTemplate)
	if summaryTemplate == "" {
		return GenericFilterConfig{}, fmt.Errorf("summaryTemplate is required")
	}
	return GenericFilterConfig{
		CdmModelID:      model,
		Where:           where,
		SeverityRules:   severityRules,
		SummaryTemplate: summaryTemplate,
	}, nil
}

func parseIntervalCfg(v any) (IntervalConfig, bool) {
	m, ok := v.(map[string]any)
	if !ok {
		return IntervalConfig{}, false
	}
	unit, _ := m["unit"].(string)
	val := parseIntVal(m["value"])
	if (unit == string(IntervalDays) || unit == string(IntervalHours)) && val > 0 {
		return IntervalConfig{Unit: IntervalUnit(unit), Value: val}, true
	}
	return IntervalConfig{}, false
}

func parseInt(v any) *int {
	val := parseIntVal(v)
	if val < 0 {
		return nil
	}
	return &val
}

func parseIntVal(v any) int {
	switch t := v.(type) {
	case int:
		return t
	case int32:
		return int(t)
	case int64:
		return int(t)
	case float64:
		return int(t)
	case float32:
		return int(t)
	case string:
		var holder int
		if _, err := fmt.Sscanf(t, "%d", &holder); err == nil {
			return holder
		}
	}
	return -1
}

func parseBoolPtr(v any) *bool {
	if b, ok := v.(bool); ok {
		return &b
	}
	return nil
}

func strSlice(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	var out []string
	for _, item := range arr {
		if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
			out = append(out, strings.TrimSpace(s))
		}
	}
	return out
}

func parseGenericConditions(v any, label string) ([]GenericCondition, error) {
	arr, ok := v.([]any)
	if !ok {
		return nil, fmt.Errorf("%s must be an array", label)
	}
	var out []GenericCondition
	for _, item := range arr {
		cond, err := parseGenericCondition(item)
		if err != nil {
			return nil, err
		}
		out = append(out, cond)
	}
	return out, nil
}

func parseGenericCondition(v any) (GenericCondition, error) {
	m, ok := v.(map[string]any)
	if !ok {
		return GenericCondition{}, fmt.Errorf("condition must be an object")
	}
	field, _ := m["field"].(string)
	if strings.TrimSpace(field) == "" {
		return GenericCondition{}, fmt.Errorf("condition.field is required")
	}
	opRaw, _ := m["op"].(string)
	if strings.TrimSpace(opRaw) == "" {
		return GenericCondition{}, fmt.Errorf("condition.op is required")
	}
	switch GenericFilterOp(opRaw) {
	case OpLT, OpLTE, OpGT, OpGTE, OpEQ, OpNEQ, OpIN, OpNOTIN, OpISNULL, OpISNOTNULL:
	default:
		return GenericCondition{}, fmt.Errorf("unsupported op %s", opRaw)
	}
	if opRaw == string(OpISNULL) || opRaw == string(OpISNOTNULL) {
		return GenericCondition{Field: field, Op: GenericFilterOp(opRaw)}, nil
	}
	val := m["value"]
	if val == nil {
		return GenericCondition{}, fmt.Errorf("value is required for op %s", opRaw)
	}
	if opRaw == string(OpIN) || opRaw == string(OpNOTIN) {
		arr, ok := val.([]any)
		if !ok || len(arr) == 0 {
			return GenericCondition{}, fmt.Errorf("value for %s must be a non-empty array", opRaw)
		}
		var norm []any
		for _, item := range arr {
			switch item.(type) {
			case string, float64, float32, int, int32, int64, bool:
				norm = append(norm, item)
			default:
				return GenericCondition{}, fmt.Errorf("value for %s must contain primitives", opRaw)
			}
		}
		return GenericCondition{Field: field, Op: GenericFilterOp(opRaw), Value: norm}, nil
	}
	switch val.(type) {
	case string, float64, float32, int, int32, int64, bool:
	default:
		return GenericCondition{}, fmt.Errorf("value for %s must be a string, number, or boolean", opRaw)
	}
	return GenericCondition{Field: field, Op: GenericFilterOp(opRaw), Value: val}, nil
}

func parseSeverityRules(v any) ([]GenericSeverityRule, error) {
	if v == nil {
		return nil, nil
	}
	arr, ok := v.([]any)
	if !ok {
		return nil, fmt.Errorf("severityRules must be an array")
	}
	var out []GenericSeverityRule
	for _, item := range arr {
		m, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("severityRules entries must be objects")
		}
		when, err := parseGenericConditions(m["when"], "when")
		if err != nil {
			return nil, err
		}
		sev, _ := m["severity"].(string)
		if strings.TrimSpace(sev) == "" {
			return nil, fmt.Errorf("severityRules.severity is required")
		}
		out = append(out, GenericSeverityRule{When: when, Severity: sev})
	}
	return out, nil
}
