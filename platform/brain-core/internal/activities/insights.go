package activities

import (
	"context"
	"crypto/sha1"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/nucleus/ucl-core/pkg/endpoint"
	"github.com/nucleus/ucl-core/pkg/kgpb"
	"go.temporal.io/sdk/activity"
)

// ExtractInsights runs an LLM-based summarization per record (stubbed unless INSIGHT_PROVIDER is set).
func (a *Activities) ExtractInsights(ctx context.Context, req IndexArtifactRequest) error {
	if req.SinkEndpointID == "" || req.DatasetSlug == "" {
		return fmt.Errorf("sinkEndpointId and datasetSlug are required")
	}
	logger := activity.GetLogger(ctx)
	useStaging := strings.TrimSpace(req.StageRef) != "" && len(req.BatchRefs) > 0
	var (
		iter    endpoint.Iterator[endpoint.Record]
		closeFn func()
		err     error
	)
	if useStaging {
		iter, closeFn, err = streamFromStaging(ctx, req.StagingProviderID, req.StageRef, "", req.DatasetSlug, req.Checkpoint, 0)
	} else {
		iter, closeFn, err = streamDataset(ctx, req.SinkEndpointID, req.EndpointConfig, req.DatasetSlug, req.Checkpoint, 0)
	}
	if err != nil {
		return err
	}
	defer closeFn()

	client := newInsightClient()
	kgc := newKgGRPCClient()
	defer kgc.Close()
	var kbEvents []kbEvent
	var kbSeq int64

	tenant := req.TenantID
	if tenant == "" {
		tenant = getenv("TENANT_ID", "dev")
	}
	project := req.ProjectID
	if project == "" {
		project = getenv("METADATA_DEFAULT_PROJECT", "global")
	}

	var idx int
	var skippedMissing, skippedCache, llmErrors int
	counters := &insightCounters{}
	for iter.Next() {
		rec := iter.Value()
		entityRef := deriveEntityRef(rec)
		if entityRef == "" {
			continue
		}
		profileID := selectInsightProfile(req.SourceFamily)
		skill := getInsightSkill(profileID)

		payload, _ := rec["payload"].(map[string]any)
		// Optionally apply CDM mapper when preferred.
		if skill.PreferCDM {
			if mapper, ok := endpoint.DefaultCDMRegistry().GetMapper(req.DatasetSlug); ok {
				if mapped, err := mapper(payload); err == nil {
					if m, ok := mapped.(map[string]any); ok {
						payload = m
					}
				}
			}
			if ek, ok := rec["entityKind"].(string); ok && ek != "" {
				if mapper, ok := endpoint.DefaultCDMRegistry().GetMapper(ek); ok {
					if mapped, err := mapper(payload); err == nil {
						if m, ok := mapped.(map[string]any); ok {
							payload = m
						}
					}
				}
			}
		}
		if payload == nil {
			payload = map[string]any{}
		}
		entityKind, _ := rec["entityKind"].(string)
		params, ok := buildInsightParams(skill, payload, entityKind)
		if !ok {
			skippedMissing++
			counters.incMissing()
			logger.Info("insight-skip-missing-fields", "skill", skill.ID, "entity", entityRef)
			continue // missing required fields
		}

		// Dedup: skip if signature unchanged
		sig := hashInsight(skill.ID, entityRef, params)
		if prev, _ := loadInsightSignature(ctx, tenant, project, skill.ID, entityRef); prev != "" && prev == sig {
			skippedCache++
			counters.incCache()
			continue
		}

		var insights []Insight
		if client != nil {
			if list, llmErr := client.Summarize(ctx, skill, params); len(list) > 0 {
				insights = list
			} else if llmErr != nil {
				llmErrors++
				counters.incErr()
				logger.Warn("insight-llm-error", "skill", skill.ID, "entity", entityRef, "err", llmErr)
			} else {
				logger.Warn("insight-llm-empty", "skill", skill.ID, "entity", entityRef)
			}
		}
		if len(insights) == 0 {
			// Fallback: single insight from payload
			summary := ""
			if payload, ok := rec["payload"]; ok {
				if b, err := json.Marshal(payload); err == nil {
					summary = string(b)
					if len(summary) > 256 {
						summary = summary[:256] + "…"
					}
				}
			}
			if summary == "" {
				summary = fmt.Sprintf("Insight for %s", entityRef)
			}
			insights = []Insight{{
				Provider:        skill.ID,
				PromptID:        skill.ID,
				EntityRef:       entityRef,
				GeneratedAt:     time.Now().UTC().Format(time.RFC3339),
				Summary:         InsightSummary{Text: summary, Confidence: 0.0},
				Sentiment:       InsightSentiment{Label: "neutral", Score: 0},
				Signals:         []InsightSignal{},
				EscalationScore: 0,
				Requirement:     "",
				WaitingOn:       nil,
			}}
		}

		if kgc != nil && kgc.client != nil {
			for _, ins := range insights {
				if !validateInsight(ins) {
					logger.Warn("insight-invalid", "skill", skill.ID, "entity", entityRef)
					continue
				}
				counters.incParsed()
				nodeID := fmt.Sprintf("insight:%s:%s:%d", req.ArtifactID, entityRef, idx)
				props := map[string]string{
					"entityRef":          entityRef,
					"dataset":            req.DatasetSlug,
					"artifactId":         req.ArtifactID,
					"sourceFamily":       req.SourceFamily,
					"provider":           pick(ins.Provider, skill.ID),
					"promptId":           pick(ins.PromptID, skill.ID),
					"generatedAt":        pick(ins.GeneratedAt, time.Now().UTC().Format(time.RFC3339)),
					"summary.text":       ins.Summary.Text,
					"summary.confidence": fmt.Sprintf("%f", ins.Summary.Confidence),
					"sentiment.label":    ins.Sentiment.Label,
					"sentiment.score":    fmt.Sprintf("%f", ins.Sentiment.Score),
					"escalationScore":    fmt.Sprintf("%f", ins.EscalationScore),
					"requirement":        ins.Requirement,
					"expiresAt":          ins.ExpiresAt,
				}
				if len(ins.Sentiment.Tones) > 0 {
					props["sentiment.tones"] = strings.Join(ins.Sentiment.Tones, ",")
				}
				if len(ins.WaitingOn) > 0 {
					props["waitingOn"] = strings.Join(ins.WaitingOn, ",")
				}
				if len(ins.Tags) > 0 {
					props["tags"] = strings.Join(ins.Tags, ",")
				}
				if len(ins.Signals) > 0 {
					if b, err := json.Marshal(ins.Signals); err == nil {
						props["signals"] = string(b)
					}
				}
				if len(ins.Metadata) > 0 {
					if b, err := json.Marshal(ins.Metadata); err == nil {
						props["metadata"] = string(b)
					}
				}
				kbSeq++
				h := sha1.Sum([]byte(nodeID + req.RunID))
				kbEvents = append(kbEvents, kbEvent{
					Seq:         kbSeq,
					RunID:       req.RunID,
					DatasetSlug: req.DatasetSlug,
					Op:          "upsert_node",
					Kind:        "insight",
					ID:          nodeID,
					Hash:        fmt.Sprintf("%x", h[:6]),
					At:          time.Now().UTC().Format(time.RFC3339),
				})
				_, _ = kgc.client.UpsertNode(ctx, &kgpb.UpsertNodeRequest{
					TenantId:  tenant,
					ProjectId: project,
					Node: &kgpb.Node{
						Id:         nodeID,
						Type:       "kg.insight",
						Properties: props,
					},
				})
				_, _ = kgc.client.UpsertEdge(ctx, &kgpb.UpsertEdgeRequest{
					TenantId:  tenant,
					ProjectId: project,
					Edge: &kgpb.Edge{
						Id:     fmt.Sprintf("insight_for:%s:%s", nodeID, entityRef),
						Type:   "INSIGHT_FOR",
						FromId: nodeID,
						ToId:   entityRef,
					},
				})
				idx++
			}
		}
		saveInsightSignature(ctx, tenant, project, skill.ID, entityRef, sig)
	}
	if err := iter.Err(); err != nil {
		return err
	}
	miss, cache, errs, seen := counters.snapshot()
	logger.Info("insight-summary", "skillsUsed", len(skillRegistry), "skippedMissing", miss, "skippedCache", cache, "llmErrors", errs, "parsed", seen)
	if kbSeq > 0 {
		saveKBEvents(ctx, tenant, project, req.DatasetSlug, req.RunID, kbEvents, kbSeq)
	}
	return nil
}

// pick returns the first non-empty string.
func pick(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func selectInsightProfile(sourceFamily string) string {
	fam := strings.ToLower(sourceFamily)
	switch {
	case strings.Contains(fam, "confluence"), strings.Contains(fam, "onedrive"), strings.Contains(fam, "doc"):
		return "doc-insight.v1"
	case strings.Contains(fam, "jira"), strings.Contains(fam, "work"):
		return "work-insight.v1"
	default:
		return "generic-insight.v1"
	}
}
