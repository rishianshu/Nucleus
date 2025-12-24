package activities

import (
	"context"
	"encoding/json"
	"strings"
)

// insightClient is a placeholder for LLM-backed insight generation.
// If INSIGHT_PROVIDER is not set, calls are skipped.
type insightClient struct {
	provider string
}

func newInsightClient() *insightClient {
	provider := strings.TrimSpace(getenv("INSIGHT_PROVIDER", ""))
	if provider == "" {
		return nil
	}
	return &insightClient{provider: provider}
}

// Insight represents a structured insight result.
type Insight struct {
	Provider        string           `json:"provider,omitempty"`
	PromptID        string           `json:"promptId,omitempty"`
	EntityRef       string           `json:"entityRef,omitempty"`
	WorkspaceID     string           `json:"workspaceId,omitempty"`
	EntityType      string           `json:"entityType,omitempty"`
	GeneratedAt     string           `json:"generatedAt,omitempty"`
	Summary         InsightSummary   `json:"summary"`
	Sentiment       InsightSentiment `json:"sentiment"`
	Signals         []InsightSignal  `json:"signals,omitempty"`
	EscalationScore float64          `json:"escalationScore,omitempty"`
	ExpiresAt       string           `json:"expiresAt,omitempty"`
	Requirement     string           `json:"requirement,omitempty"`
	WaitingOn       []string         `json:"waitingOn,omitempty"`
	Metadata        map[string]any   `json:"metadata,omitempty"`
	Tags            []string         `json:"tags,omitempty"` // convenience
}

type InsightSummary struct {
	Text       string  `json:"text,omitempty"`
	Confidence float64 `json:"confidence,omitempty"`
	Provider   string  `json:"provider,omitempty"`
}

type InsightSentiment struct {
	Label    string   `json:"label,omitempty"`
	Score    float64  `json:"score,omitempty"`
	Tones    []string `json:"tones,omitempty"`
	Provider string   `json:"provider,omitempty"`
}

type InsightSignal struct {
	Type     string         `json:"type,omitempty"`
	Severity string         `json:"severity,omitempty"` // low | medium | high
	Detail   string         `json:"detail,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

// Summarize returns zero or more insights for a record. If no provider is configured, returns nil.
func (c *insightClient) Summarize(ctx context.Context, skill InsightSkill, params map[string]string) ([]Insight, error) {
	_ = ctx
	if c == nil {
		return nil, nil
	}
	prompt := buildInsightPrompt(skill, params)
	resp, err := callLLM(ctx, skill, prompt)
	if err != nil || strings.TrimSpace(resp) == "" {
		return nil, err
	}
	return parseInsightJSON(resp, skill.MaxInsights)
}

// buildInsightPrompt crafts a structured prompt for an LLM.
func buildInsightPrompt(skill InsightSkill, params map[string]string) string {
	if strings.TrimSpace(skill.ID) == "" {
		skill.ID = "generic-insight.v1"
	}
	out := skill.Template
	for k, v := range params {
		out = strings.ReplaceAll(out, "{{"+k+"}}", v)
	}
	// Provide a generic payload dump if requested.
	if strings.Contains(out, "{{payload}}") {
		if b, err := json.MarshalIndent(params, "", "  "); err == nil {
			payload := string(b)
			if len(payload) > 2000 {
				payload = payload[:2000] + "... (truncated)"
			}
			out = strings.ReplaceAll(out, "{{payload}}", payload)
		}
	}
	return out
}
