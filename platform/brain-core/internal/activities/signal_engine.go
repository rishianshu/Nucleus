package activities

import (
	"fmt"
	"strings"
	"time"

	signalpb "github.com/nucleus/store-core/gen/go/signalpb"
	"google.golang.org/protobuf/types/known/structpb"
)

// signalEngine runs code/DSL/insight-based signal definitions against records.
type signalEngine struct {
	defs     []*signalpb.Definition
	insights *insightClient
}

// newSignalEngine constructs an engine for applicable definitions.
func newSignalEngine(defs []*signalpb.Definition) *signalEngine {
	return &signalEngine{defs: defs, insights: newInsightClient()}
}

// eval emits instances for a single record.
func (e *signalEngine) eval(rec map[string]any, req IndexArtifactRequest, defID string) []*signalpb.Instance {
	var out []*signalpb.Instance
	for _, def := range e.defs {
		if defID != "" && def.GetId() != defID {
			continue
		}
		if def.GetSourceFamily() != "" && !strings.EqualFold(def.GetSourceFamily(), req.SourceFamily) {
			continue
		}
		if def.GetEntityKind() != "" {
			kind := deriveEntityKind(rec, req.DatasetSlug, req.SourceFamily)
			if !strings.EqualFold(kind, def.GetEntityKind()) {
				continue
			}
		}
		instances := e.evalDefinition(def, rec, req)
		out = append(out, instances...)
	}
	return out
}

// evalDefinition dispatches based on impl mode/spec.
func (e *signalEngine) evalDefinition(def *signalpb.Definition, rec map[string]any, req IndexArtifactRequest) []*signalpb.Instance {
	if def.GetDefinitionSpec() == nil {
		if inst, ok := buildInstance(def, rec, req); ok {
			return []*signalpb.Instance{inst}
		}
		return nil
	}
	specRes := parseSignalSpec(def.GetDefinitionSpec().AsMap())
	if !specRes.Valid {
		if inst, ok := buildInstance(def, rec, req); ok {
			return []*signalpb.Instance{inst}
		}
		return nil
	}
	switch SignalDefinitionType(specRes.Spec.Type) {
	case TypeWorkStale:
		return evalWorkStale(def, specRes.Spec.Config.(WorkStaleConfig), rec, req)
	case TypeDocOrphan:
		return evalDocOrphan(def, specRes.Spec.Config.(DocOrphanConfig), rec, req)
	case TypeGenericFilter:
		return evalGenericFilter(def, specRes.Spec.Config.(GenericFilterConfig), rec, req)
	default:
		if inst, ok := buildInstance(def, rec, req); ok {
			return []*signalpb.Instance{inst}
		}
		return nil
	}
}

func buildInstance(def *signalpb.Definition, rec map[string]any, req IndexArtifactRequest) (*signalpb.Instance, bool) {
	entityRef := deriveEntityRef(rec)
	if entityRef == "" {
		return nil, false
	}
	details, _ := structpb.NewStruct(rec)
	return &signalpb.Instance{
		DefinitionId: def.GetId(),
		Status:       "OPEN",
		EntityRef:    entityRef,
		EntityKind:   deriveEntityKind(rec, req.DatasetSlug, req.SourceFamily),
		Severity:     strings.ToUpper(def.GetSeverity()),
		Summary:      def.GetTitle(),
		Details:      details,
		SourceRunId:  req.RunID,
	}, true
}

func evalWorkStale(def *signalpb.Definition, cfg WorkStaleConfig, rec map[string]any, req IndexArtifactRequest) []*signalpb.Instance {
	norm := normalizeSignalShape(rec)
	ageMs := norm.AgeMs
	if ageMs <= 0 {
		return nil
	}
	maxMs := intervalToMs(cfg.MaxAge)
	if ageMs < float64(maxMs) {
		return nil
	}
	status := strings.ToLower(norm.Status)
	if len(cfg.StatusInclude) > 0 && !containsFold(cfg.StatusInclude, status) {
		return nil
	}
	if containsFold(cfg.StatusExclude, status) {
		return nil
	}
	projectID := strings.ToLower(norm.ProjectID)
	if len(cfg.ProjectInclude) > 0 && !containsFold(cfg.ProjectInclude, projectID) {
		return nil
	}
	if containsFold(cfg.ProjectExclude, projectID) {
		return nil
	}
	severity := strings.ToUpper(def.GetSeverity())
	if cfg.SeverityMapping != nil {
		if cfg.SeverityMapping.ErrorAfter != nil && ageMs >= float64(intervalToMs(*cfg.SeverityMapping.ErrorAfter)) {
			severity = "ERROR"
		} else if cfg.SeverityMapping.WarnAfter != nil && ageMs >= float64(intervalToMs(*cfg.SeverityMapping.WarnAfter)) {
			severity = "WARNING"
		}
	}
	if inst, ok := buildInstance(def, rec, req); ok {
		inst.Severity = severity
		if inst.Summary == "" {
			inst.Summary = fmt.Sprintf("Stale work item %s", inst.EntityRef)
		}
		return []*signalpb.Instance{inst}
	}
	return nil
}

func evalDocOrphan(def *signalpb.Definition, cfg DocOrphanConfig, rec map[string]any, req IndexArtifactRequest) []*signalpb.Instance {
	norm := normalizeSignalShape(rec)
	ageMs := norm.AgeMs
	if ageMs < float64(intervalToMs(cfg.MinAge)) {
		return nil
	}
	views := norm.ViewCount
	if cfg.MinViewCount != nil && views >= float64(*cfg.MinViewCount) {
		return nil
	}
	if cfg.RequireProjectLink != nil && *cfg.RequireProjectLink {
		if norm.ProjectID == "" {
			return nil
		}
	}
	space := strings.ToLower(norm.SpaceID)
	if len(cfg.SpaceInclude) > 0 && !containsFold(cfg.SpaceInclude, space) {
		return nil
	}
	if containsFold(cfg.SpaceExclude, space) {
		return nil
	}
	if inst, ok := buildInstance(def, rec, req); ok {
		if inst.Summary == "" {
			inst.Summary = fmt.Sprintf("Orphan doc %s", inst.EntityRef)
		}
		return []*signalpb.Instance{inst}
	}
	return nil
}

func evalGenericFilter(def *signalpb.Definition, cfg GenericFilterConfig, rec map[string]any, req IndexArtifactRequest) []*signalpb.Instance {
	norm := normalizeSignalShape(rec)
	if cfg.SummaryTemplate != "" {
		norm.Summary = cfg.SummaryTemplate
	}
	if cfg.CdmModelID != "" && !strings.EqualFold(cfg.CdmModelID, norm.CdmModelID) {
		return nil
	}
	if len(cfg.Where) > 0 && !evalGenericConditions(cfg.Where, rec) {
		return nil
	}
	severity := strings.ToUpper(def.GetSeverity())
	if len(cfg.SeverityRules) > 0 {
		for _, rule := range cfg.SeverityRules {
			if evalGenericConditions(rule.When, rec) {
				severity = strings.ToUpper(rule.Severity)
				break
			}
		}
	}
	if inst, ok := buildInstance(def, rec, req); ok {
		if inst.Summary == "" {
			inst.Summary = norm.Summary
		}
		inst.Severity = severity
		return []*signalpb.Instance{inst}
	}
	return nil
}

func evalGenericConditions(conds []GenericCondition, rec map[string]any) bool {
	for _, cond := range conds {
		field := cond.Field
		val := rec[field]
		switch cond.Op {
		case OpLT:
			if !compare(val, cond.Value, "<") {
				return false
			}
		case OpLTE:
			if !compare(val, cond.Value, "<=") {
				return false
			}
		case OpGT:
			if !compare(val, cond.Value, ">") {
				return false
			}
		case OpGTE:
			if !compare(val, cond.Value, ">=") {
				return false
			}
		case OpEQ:
			if !compare(val, cond.Value, "==") {
				return false
			}
		case OpNEQ:
			if !compare(val, cond.Value, "!=") {
				return false
			}
		case OpIN:
			if !contains(cond.Value, val) {
				return false
			}
		case OpNOTIN:
			if contains(cond.Value, val) {
				return false
			}
		case OpISNULL:
			if val != nil {
				return false
			}
		case OpISNOTNULL:
			if val == nil {
				return false
			}
		default:
			return false
		}
	}
	return true
}

type normalizedSignal struct {
	AgeMs      float64
	Status     string
	ProjectID  string
	SpaceID    string
	ViewCount  float64
	Summary    string
	CdmModelID string
}

func normalizeSignalShape(rec map[string]any) normalizedSignal {
	created := toTime(rec["createdAt"])
	if created.IsZero() {
		created = toTime(rec["created_at"])
	}
	updated := toTime(rec["updatedAt"])
	if updated.IsZero() {
		updated = toTime(rec["updated_at"])
	}
	now := time.Now()
	age := now.Sub(created)
	if updated.After(created) {
		age = now.Sub(updated)
	}
	status, _ := rec["status"].(string)
	projectID, _ := rec["projectId"].(string)
	if projectID == "" {
		projectID, _ = rec["project_id"].(string)
	}
	spaceID, _ := rec["spaceId"].(string)
	if spaceID == "" {
		spaceID, _ = rec["space_id"].(string)
	}
	view := toFloat(rec["viewCount"])
	if view == 0 {
		view = toFloat(rec["views"])
	}
	summary, _ := rec["summary"].(string)
	cdmModel, _ := rec["cdmModelId"].(string)
	return normalizedSignal{
		AgeMs:      age.Seconds() * 1000,
		Status:     strings.ToLower(status),
		ProjectID:  strings.ToLower(projectID),
		SpaceID:    strings.ToLower(spaceID),
		ViewCount:  view,
		Summary:    summary,
		CdmModelID: cdmModel,
	}
}

func intervalToMs(iv IntervalConfig) int64 {
	switch iv.Unit {
	case IntervalHours:
		return int64(iv.Value) * int64(time.Hour/time.Millisecond)
	case IntervalDays:
		return int64(iv.Value) * 24 * int64(time.Hour/time.Millisecond)
	default:
		return 0
	}
}

func containsFold(list []string, val string) bool {
	val = strings.ToLower(val)
	for _, item := range list {
		if strings.ToLower(item) == val {
			return true
		}
	}
	return false
}

func toTime(v any) time.Time {
	switch t := v.(type) {
	case time.Time:
		return t
	case string:
		if parsed, err := time.Parse(time.RFC3339, t); err == nil {
			return parsed
		}
	}
	return time.Time{}
}

func compare(a any, b any, op string) bool {
	af, aok := toFloatMaybe(a)
	bf, bok := toFloatMaybe(b)
	if aok && bok {
		switch op {
		case "<":
			return af < bf
		case "<=":
			return af <= bf
		case ">":
			return af > bf
		case ">=":
			return af >= bf
		case "==":
			return af == bf
		case "!=":
			return af != bf
		}
	}
	as, bs := fmt.Sprint(a), fmt.Sprint(b)
	switch op {
	case "==":
		return as == bs
	case "!=":
		return as != bs
	}
	return false
}

func toFloatMaybe(v any) (float64, bool) {
	switch t := v.(type) {
	case float32:
		return float64(t), true
	case float64:
		return t, true
	case int:
		return float64(t), true
	case int32:
		return float64(t), true
	case int64:
		return float64(t), true
	}
	return 0, false
}

func toFloat(v any) float64 {
	if f, ok := toFloatMaybe(v); ok {
		return f
	}
	return 0
}

func contains(hay any, needle any) bool {
	arr, ok := hay.([]any)
	if !ok {
		return false
	}
	for _, item := range arr {
		if fmt.Sprint(item) == fmt.Sprint(needle) {
			return true
		}
	}
	return false
}
