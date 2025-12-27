package ner

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// ===================================================
// NER LLM Activity - Named Entity Recognition
// Extracts entities from content using LLM
// ===================================================

// EntityType represents the type of extracted entity.
type EntityType string

const (
	EntityTypePerson       EntityType = "person"
	EntityTypeOrganization EntityType = "organization"
	EntityTypeProject      EntityType = "project"
	EntityTypeProduct      EntityType = "product"
	EntityTypeDocument     EntityType = "document"
	EntityTypePolicy       EntityType = "policy"
	EntityTypeProcess      EntityType = "process"
	EntityTypeTechnology   EntityType = "technology"
	EntityTypeLocation     EntityType = "location"
	EntityTypeDate         EntityType = "date"
	EntityTypeCode         EntityType = "code"
	EntityTypeOther        EntityType = "other"
)

// ExtractedEntity represents an entity extracted by NER.
type ExtractedEntity struct {
	Text        string            `json:"text"`        // Original text mention
	Type        EntityType        `json:"type"`        // Entity type
	Normalized  string            `json:"normalized"`  // Normalized/canonical form
	Confidence  float32           `json:"confidence"`  // Extraction confidence (0-1)
	Offset      int               `json:"offset"`      // Start position in source text
	Length      int               `json:"length"`      // Length of mention
	Qualifiers  map[string]string `json:"qualifiers"`  // Disambiguation qualifiers
	Context     string            `json:"context"`     // Surrounding context for disambiguation
	SourceID    string            `json:"sourceId"`    // Source document ID
	SourceType  string            `json:"sourceType"`  // Source system (jira, github, etc.)
}

// NERRequest represents a request to extract entities.
type NERRequest struct {
	TenantID   string `json:"tenantId"`
	Text       string `json:"text"`
	SourceID   string `json:"sourceId"`
	SourceType string `json:"sourceType"`
	// Optional: hints about expected entity types
	ExpectedTypes []EntityType `json:"expectedTypes,omitempty"`
	// Optional: additional context for better extraction
	Context map[string]string `json:"context,omitempty"`
}

// NERResponse represents the extraction result.
type NERResponse struct {
	Entities      []ExtractedEntity `json:"entities"`
	ProcessingMs  int64             `json:"processingMs"`
	ModelUsed     string            `json:"modelUsed"`
	TokensUsed    int               `json:"tokensUsed"`
}

// ===================================================
// LLM Provider Interface
// ===================================================

// LLMProvider abstracts the LLM backend (OpenAI, Anthropic, etc.)
type LLMProvider interface {
	// Complete sends a prompt and returns the completion.
	Complete(ctx context.Context, prompt string, options CompletionOptions) (string, error)
	
	// Name returns the provider name.
	Name() string
}

// CompletionOptions configures the LLM completion.
type CompletionOptions struct {
	Model       string  `json:"model"`
	MaxTokens   int     `json:"maxTokens"`
	Temperature float32 `json:"temperature"`
	SystemPrompt string `json:"systemPrompt"`
}

// ===================================================
// NER Extractor
// ===================================================

// NERExtractor extracts entities using LLM.
type NERExtractor struct {
	provider    LLMProvider
	model       string
	maxTokens   int
	temperature float32
}

// NewNERExtractor creates a new NER extractor.
func NewNERExtractor(provider LLMProvider, model string) *NERExtractor {
	if model == "" {
		model = "gpt-4o-mini" // Default model
	}
	return &NERExtractor{
		provider:    provider,
		model:       model,
		maxTokens:   2048,
		temperature: 0.1,
	}
}

// NewNERExtractorWithConfig creates a NER extractor with custom config.
func NewNERExtractorWithConfig(provider LLMProvider, model string, maxTokens int, temperature float32) *NERExtractor {
	if model == "" {
		model = "gpt-4o-mini"
	}
	if maxTokens <= 0 {
		maxTokens = 2048
	}
	if temperature <= 0 {
		temperature = 0.1
	}
	return &NERExtractor{
		provider:    provider,
		model:       model,
		maxTokens:   maxTokens,
		temperature: temperature,
	}
}

// Extract extracts entities from the given text.
func (e *NERExtractor) Extract(ctx context.Context, req NERRequest) (*NERResponse, error) {
	start := time.Now()

	prompt := e.buildPrompt(req)
	
	// P2 Fix: Use configurable maxTokens and temperature
	options := CompletionOptions{
		Model:        e.model,
		MaxTokens:    e.maxTokens,
		Temperature:  e.temperature,
		SystemPrompt: nerSystemPrompt,
	}

	completion, err := e.provider.Complete(ctx, prompt, options)
	if err != nil {
		return nil, fmt.Errorf("LLM completion failed: %w", err)
	}

	entities, err := e.parseResponse(completion, req)
	if err != nil {
		return nil, fmt.Errorf("failed to parse NER response: %w", err)
	}

	return &NERResponse{
		Entities:     entities,
		ProcessingMs: time.Since(start).Milliseconds(),
		ModelUsed:    e.model,
	}, nil
}

// buildPrompt constructs the NER prompt.
func (e *NERExtractor) buildPrompt(req NERRequest) string {
	var sb strings.Builder

	sb.WriteString("Extract all named entities from the following text.\n\n")
	
	// Add context if provided
	if len(req.Context) > 0 {
		sb.WriteString("Context:\n")
		for k, v := range req.Context {
			sb.WriteString(fmt.Sprintf("- %s: %s\n", k, v))
		}
		sb.WriteString("\n")
	}

	// Add type hints if provided
	if len(req.ExpectedTypes) > 0 {
		sb.WriteString("Focus on these entity types: ")
		types := make([]string, len(req.ExpectedTypes))
		for i, t := range req.ExpectedTypes {
			types[i] = string(t)
		}
		sb.WriteString(strings.Join(types, ", "))
		sb.WriteString("\n\n")
	}

	sb.WriteString("Text:\n```\n")
	sb.WriteString(req.Text)
	sb.WriteString("\n```\n\n")

	sb.WriteString("Respond with a JSON array of entities. Each entity should have:\n")
	sb.WriteString("- text: the exact text mention\n")
	sb.WriteString("- type: one of [person, organization, project, product, document, policy, process, technology, location, date, code, other]\n")
	sb.WriteString("- normalized: a normalized/canonical form of the entity\n")
	sb.WriteString("- confidence: extraction confidence from 0 to 1\n")
	sb.WriteString("- qualifiers: object with disambiguation hints (e.g., {\"department\": \"engineering\"})\n")
	sb.WriteString("- context: short phrase showing the entity's role in the text\n\n")
	sb.WriteString("Return ONLY the JSON array, no other text.")

	return sb.String()
}

// parseResponse parses the LLM response into entities.
func (e *NERExtractor) parseResponse(response string, req NERRequest) ([]ExtractedEntity, error) {
	// Clean response - remove markdown code blocks if present
	response = strings.TrimSpace(response)
	if strings.HasPrefix(response, "```json") {
		response = strings.TrimPrefix(response, "```json")
		response = strings.TrimSuffix(response, "```")
		response = strings.TrimSpace(response)
	} else if strings.HasPrefix(response, "```") {
		response = strings.TrimPrefix(response, "```")
		response = strings.TrimSuffix(response, "```")
		response = strings.TrimSpace(response)
	}

	var rawEntities []struct {
		Text       string            `json:"text"`
		Type       string            `json:"type"`
		Normalized string            `json:"normalized"`
		Confidence float32           `json:"confidence"`
		Qualifiers map[string]string `json:"qualifiers"`
		Context    string            `json:"context"`
	}

	if err := json.Unmarshal([]byte(response), &rawEntities); err != nil {
		return nil, fmt.Errorf("invalid JSON response: %w", err)
	}

	entities := make([]ExtractedEntity, 0, len(rawEntities))
	for _, raw := range rawEntities {
		// Find offset in original text
		offset := strings.Index(req.Text, raw.Text)
		
		entity := ExtractedEntity{
			Text:       raw.Text,
			Type:       EntityType(raw.Type),
			Normalized: raw.Normalized,
			Confidence: raw.Confidence,
			Offset:     offset,
			Length:     len(raw.Text),
			Qualifiers: raw.Qualifiers,
			Context:    raw.Context,
			SourceID:   req.SourceID,
			SourceType: req.SourceType,
		}

		// Validate entity type
		if !isValidEntityType(entity.Type) {
			entity.Type = EntityTypeOther
		}

		// Default confidence if not provided
		if entity.Confidence <= 0 {
			entity.Confidence = 0.8
		}

		entities = append(entities, entity)
	}

	return entities, nil
}

// isValidEntityType checks if entity type is valid.
func isValidEntityType(t EntityType) bool {
	switch t {
	case EntityTypePerson, EntityTypeOrganization, EntityTypeProject,
		EntityTypeProduct, EntityTypeDocument, EntityTypePolicy,
		EntityTypeProcess, EntityTypeTechnology, EntityTypeLocation,
		EntityTypeDate, EntityTypeCode, EntityTypeOther:
		return true
	default:
		return false
	}
}

// System prompt for NER extraction
const nerSystemPrompt = `You are an expert Named Entity Recognition (NER) system for enterprise software.
Your task is to extract entities from text content that originates from enterprise tools like Jira, GitHub, Confluence, and Slack.

Entity Types:
- person: People, users, team members, assignees
- organization: Companies, teams, departments, groups
- project: Projects, repositories, sprints, initiatives
- product: Products, features, applications, services
- document: Documents, pages, files, specifications
- policy: Policies, guidelines, rules, requirements, compliance documents
- process: Workflows, procedures, processes, pipelines
- technology: Technologies, languages, frameworks, tools
- location: Locations, regions, data centers
- date: Dates, deadlines, milestones
- code: Code references, functions, classes, APIs
- other: Other notable entities

Guidelines:
1. Extract all meaningful entities, not just obvious ones
2. Normalize names consistently (e.g., "John S." -> "John Smith" if context allows)
3. Provide confidence based on clarity of the mention
4. Add qualifiers to disambiguate entities (e.g., "John Smith" with qualifier "department": "engineering")
5. Include context to show entity's role
6. Be precise with entity types - policies have rules, processes have steps
`

// Ensure interface compliance
var _ interface {
	Extract(ctx context.Context, req NERRequest) (*NERResponse, error)
} = (*NERExtractor)(nil)
