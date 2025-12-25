package community

import (
	"context"
	"fmt"
	"strings"
)

// ===================================================
// LLM Community Labeler
// Generates human-readable labels and descriptions
// for communities using LLM inference
// ===================================================

// LLMLabeler implements CommunityLabeler using LLM inference.
type LLMLabeler struct {
	client LLMClient
	config LLMLabelerConfig
}

// LLMLabelerConfig configures the LLM labeler.
type LLMLabelerConfig struct {
	// Model to use for inference
	Model string `json:"model"`

	// MaxTokens for response
	MaxTokens int `json:"maxTokens"`

	// Temperature for creativity (0-1)
	Temperature float64 `json:"temperature"`

	// SystemPrompt to guide labeling behavior
	SystemPrompt string `json:"systemPrompt"`
}

// DefaultLLMLabelerConfig returns sensible defaults.
func DefaultLLMLabelerConfig() LLMLabelerConfig {
	return LLMLabelerConfig{
		Model:       "gpt-4o-mini",
		MaxTokens:   200,
		Temperature: 0.3,
		SystemPrompt: `You are an expert at analyzing groups of related items and generating concise, descriptive labels.
Given a list of entity summaries that belong to the same community/cluster, generate:
1. A short label (3-6 words) that captures the common theme
2. A one-sentence description explaining what connects these items
3. 3-5 keywords that represent the key concepts

Respond in JSON format:
{"label": "...", "description": "...", "keywords": ["...", "..."]}`,
	}
}

// LLMClient is the interface for LLM inference.
type LLMClient interface {
	// ChatComplete sends a prompt and returns the response.
	ChatComplete(ctx context.Context, model string, messages []Message, opts ChatOptions) (string, error)
}

// Message represents a chat message.
type Message struct {
	Role    string `json:"role"`    // "system", "user", "assistant"
	Content string `json:"content"`
}

// ChatOptions configures the chat completion request.
type ChatOptions struct {
	MaxTokens   int     `json:"maxTokens"`
	Temperature float64 `json:"temperature"`
}

// NewLLMLabeler creates a new LLM-based community labeler.
// Callers wanting all defaults should pass DefaultLLMLabelerConfig().
// Zero values are treated as intentional (e.g., Temperature=0 for deterministic output).
// Only empty Model and SystemPrompt are filled from defaults.
func NewLLMLabeler(client LLMClient, config LLMLabelerConfig) *LLMLabeler {
	defaults := DefaultLLMLabelerConfig()
	// Only fill truly unset fields (empty strings)
	if config.Model == "" {
		config.Model = defaults.Model
	}
	if config.SystemPrompt == "" {
		config.SystemPrompt = defaults.SystemPrompt
	}
	// MaxTokens and Temperature: 0 values are valid, only set defaults for negative
	if config.MaxTokens <= 0 {
		config.MaxTokens = defaults.MaxTokens
	}
	if config.Temperature < 0 {
		config.Temperature = defaults.Temperature
	}
	return &LLMLabeler{
		client: client,
		config: config,
	}
}

// LabelCommunity generates a label and description for a community.
func (l *LLMLabeler) LabelCommunity(
	ctx context.Context,
	community Community,
	memberSummaries []string,
) (label, description string, keywords []string, err error) {
	if len(memberSummaries) == 0 {
		return "", "", nil, fmt.Errorf("no member summaries provided")
	}

	// Build the prompt
	prompt := l.buildPrompt(community, memberSummaries)

	// Call LLM
	messages := []Message{
		{Role: "system", Content: l.config.SystemPrompt},
		{Role: "user", Content: prompt},
	}

	opts := ChatOptions{
		MaxTokens:   l.config.MaxTokens,
		Temperature: l.config.Temperature,
	}

	response, err := l.client.ChatComplete(ctx, l.config.Model, messages, opts)
	if err != nil {
		return "", "", nil, fmt.Errorf("LLM request failed: %w", err)
	}

	// Parse response
	label, description, keywords, err = parseLabelerResponse(response)
	if err != nil {
		return "", "", nil, fmt.Errorf("failed to parse LLM response: %w", err)
	}

	return label, description, keywords, nil
}

// buildPrompt creates the user prompt for the LLM.
func (l *LLMLabeler) buildPrompt(community Community, memberSummaries []string) string {
	var sb strings.Builder

	sb.WriteString("Analyze this community and generate a label:\n\n")

	// Add community context
	sb.WriteString(fmt.Sprintf("Community ID: %s\n", community.ID))
	sb.WriteString(fmt.Sprintf("Size: %d members\n", community.Size))
	sb.WriteString(fmt.Sprintf("Level: %s\n", community.Level.String()))

	if community.ParentID != "" {
		sb.WriteString(fmt.Sprintf("Parent Community: %s\n", community.ParentID))
	}

	// Add member summaries
	sb.WriteString("\nMember Entities:\n")

	// Limit to prevent token overflow
	maxMembers := 20
	if len(memberSummaries) > maxMembers {
		memberSummaries = memberSummaries[:maxMembers]
		sb.WriteString(fmt.Sprintf("(Showing first %d of %d members)\n", maxMembers, community.Size))
	}

	for i, summary := range memberSummaries {
		sb.WriteString(fmt.Sprintf("%d. %s\n", i+1, summary))
	}

	return sb.String()
}

// parseLabelerResponse extracts label, description, keywords from JSON response.
func parseLabelerResponse(response string) (label, description string, keywords []string, err error) {
	// Find JSON in response
	start := strings.Index(response, "{")
	end := strings.LastIndex(response, "}")
	if start == -1 || end == -1 || start >= end {
		return "", "", nil, fmt.Errorf("no valid JSON found in response")
	}

	jsonStr := response[start : end+1]

	// Simple extraction without full JSON parsing to avoid import
	label = extractJSONField(jsonStr, "label")
	description = extractJSONField(jsonStr, "description")

	// Extract keywords array
	keywordsStr := extractJSONArray(jsonStr, "keywords")
	if keywordsStr != "" {
		keywords = parseStringArray(keywordsStr)
	}

	if label == "" {
		return "", "", nil, fmt.Errorf("no label found in response")
	}

	return label, description, keywords, nil
}

// extractJSONField extracts a simple string field from JSON.
func extractJSONField(json, field string) string {
	// Look for "field": "value"
	key := fmt.Sprintf(`"%s"`, field)
	idx := strings.Index(json, key)
	if idx == -1 {
		return ""
	}

	// Find the colon and opening quote
	afterKey := json[idx+len(key):]
	colonIdx := strings.Index(afterKey, ":")
	if colonIdx == -1 {
		return ""
	}

	afterColon := strings.TrimSpace(afterKey[colonIdx+1:])
	if len(afterColon) == 0 || afterColon[0] != '"' {
		return ""
	}

	// Find closing quote
	endIdx := strings.Index(afterColon[1:], `"`)
	if endIdx == -1 {
		return ""
	}

	return afterColon[1 : endIdx+1]
}

// extractJSONArray extracts a JSON array as a string.
func extractJSONArray(json, field string) string {
	key := fmt.Sprintf(`"%s"`, field)
	idx := strings.Index(json, key)
	if idx == -1 {
		return ""
	}

	afterKey := json[idx+len(key):]
	bracketStart := strings.Index(afterKey, "[")
	if bracketStart == -1 {
		return ""
	}

	bracketEnd := strings.Index(afterKey[bracketStart:], "]")
	if bracketEnd == -1 {
		return ""
	}

	return afterKey[bracketStart : bracketStart+bracketEnd+1]
}

// parseStringArray parses a JSON string array.
func parseStringArray(s string) []string {
	// Remove brackets
	s = strings.TrimPrefix(s, "[")
	s = strings.TrimSuffix(s, "]")
	s = strings.TrimSpace(s)

	if s == "" {
		return nil
	}

	// Split by comma and clean
	parts := strings.Split(s, ",")
	result := make([]string, 0, len(parts))

	for _, p := range parts {
		p = strings.TrimSpace(p)
		p = strings.Trim(p, `"`)
		if p != "" {
			result = append(result, p)
		}
	}

	return result
}

// ===================================================
// Keyword-based Labeler (fallback)
// ===================================================

// KeywordLabeler generates labels using keyword extraction.
// Used as a fallback when LLM is not available.
type KeywordLabeler struct {
	minKeywordLength int
}

// NewKeywordLabeler creates a keyword-based labeler.
func NewKeywordLabeler() *KeywordLabeler {
	return &KeywordLabeler{
		minKeywordLength: 3,
	}
}

// LabelCommunity generates a label from member entity names.
func (k *KeywordLabeler) LabelCommunity(
	ctx context.Context,
	community Community,
	memberSummaries []string,
) (label, description string, keywords []string, err error) {
	if len(memberSummaries) == 0 {
		return "", "", nil, fmt.Errorf("no member summaries provided")
	}

	// Extract common words
	wordFreq := make(map[string]int)
	stopWords := map[string]bool{
		"the": true, "a": true, "an": true, "and": true, "or": true,
		"is": true, "are": true, "was": true, "were": true, "be": true,
		"to": true, "of": true, "in": true, "for": true, "on": true,
		"with": true, "at": true, "by": true, "from": true, "as": true,
	}

	for _, summary := range memberSummaries {
		words := strings.Fields(strings.ToLower(summary))
		for _, word := range words {
			word = strings.Trim(word, ".,!?:;\"'()[]{}")
			if len(word) >= k.minKeywordLength && !stopWords[word] {
				wordFreq[word]++
			}
		}
	}

	// Get top keywords
	type wordCount struct {
		word  string
		count int
	}
	var counts []wordCount
	for w, c := range wordFreq {
		counts = append(counts, wordCount{w, c})
	}

	// Sort by frequency descending
	for i := 0; i < len(counts)-1; i++ {
		for j := i + 1; j < len(counts); j++ {
			if counts[j].count > counts[i].count {
				counts[i], counts[j] = counts[j], counts[i]
			}
		}
	}

	// Take top 5 keywords
	for i := 0; i < len(counts) && i < 5; i++ {
		keywords = append(keywords, counts[i].word)
	}

	if len(keywords) == 0 {
		return "", "", nil, fmt.Errorf("no keywords extracted")
	}

	// Build label from top keywords
	if len(keywords) >= 3 {
		label = strings.Title(strings.Join(keywords[:3], " "))
	} else {
		label = strings.Title(strings.Join(keywords, " "))
	}

	// Build description
	description = fmt.Sprintf("Community of %d entities related to: %s",
		community.Size, strings.Join(keywords, ", "))

	return label, description, keywords, nil
}

// Ensure interface compliance
var _ CommunityLabeler = (*LLMLabeler)(nil)
var _ CommunityLabeler = (*KeywordLabeler)(nil)
