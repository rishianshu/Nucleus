package activities

import (
	"encoding/json"
	"strings"
)

// parseInsightJSON parses an LLM JSON response into Insight objects.
func parseInsightJSON(resp string, max int) ([]Insight, error) {
	var out Insight
	if err := json.Unmarshal([]byte(resp), &out); err == nil && out.Summary.Text != "" {
		normalizeInsight(&out)
		return []Insight{out}, nil
	}
	var list []Insight
	if err := json.Unmarshal([]byte(resp), &list); err != nil {
		return nil, err
	}
	if max > 0 && len(list) > max {
		list = list[:max]
	}
	for i := range list {
		normalizeInsight(&list[i])
	}
	return list, nil
}

func normalizeInsight(ins *Insight) {
	if ins == nil {
		return
	}
	if strings.TrimSpace(ins.Sentiment.Label) == "" {
		ins.Sentiment.Label = "neutral"
	}
	if ins.Sentiment.Score == 0 && strings.ToLower(ins.Sentiment.Label) == "negative" {
		ins.Sentiment.Score = -0.1
	}
	if ins.Sentiment.Tones == nil {
		ins.Sentiment.Tones = []string{}
	}
	if ins.Signals == nil {
		ins.Signals = []InsightSignal{}
	}
	if ins.WaitingOn == nil {
		ins.WaitingOn = []string{}
	}
	if ins.Metadata == nil {
		ins.Metadata = map[string]any{}
	}
	if ins.Tags == nil {
		ins.Tags = []string{}
	}
	for i := range ins.Signals {
		s := strings.ToLower(ins.Signals[i].Severity)
		if s == "" {
			s = "low"
		}
		ins.Signals[i].Severity = s
		if ins.Signals[i].Metadata == nil {
			ins.Signals[i].Metadata = map[string]any{}
		}
	}
}

func validateInsight(ins Insight) bool {
	if strings.TrimSpace(ins.Summary.Text) == "" {
		return false
	}
	if ins.Sentiment.Label == "" {
		ins.Sentiment.Label = "neutral"
	}
	return true
}
