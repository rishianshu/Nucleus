package ner

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// ===================================================
// EPP Classifier - Entity/Policy/Process Discovery
// Classifies content as Policy or Process and extracts structure
// ===================================================

// EPPType represents the classification type.
type EPPType string

const (
	EPPTypeEntity  EPPType = "entity"  // Regular entity
	EPPTypePolicy  EPPType = "policy"  // Policy document with rules
	EPPTypeProcess EPPType = "process" // Workflow or process definition
)

// EPPClassification represents the classification result.
type EPPClassification struct {
	Type        EPPType         `json:"type"`
	Confidence  float32         `json:"confidence"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	
	// Policy-specific fields
	Policy      *PolicyDetails  `json:"policy,omitempty"`
	
	// Process-specific fields
	Process     *ProcessDetails `json:"process,omitempty"`
}

// PolicyDetails contains extracted policy information.
type PolicyDetails struct {
	Rules       []PolicyRule     `json:"rules"`
	AppliesTo   []string         `json:"appliesTo"`   // Entity types this applies to
	Enforcement string           `json:"enforcement"` // mandatory, recommended, optional
	EffectiveDate string         `json:"effectiveDate,omitempty"`
	ExpiryDate  string           `json:"expiryDate,omitempty"`
	Owners      []string         `json:"owners"`
	Keywords    []string         `json:"keywords"`
}

// PolicyRule represents an extracted rule from a policy.
type PolicyRule struct {
	ID          string   `json:"id"`
	Statement   string   `json:"statement"`   // The rule text
	Requirement string   `json:"requirement"` // must, should, may
	Category    string   `json:"category"`    // security, compliance, operational
	Exceptions  []string `json:"exceptions"`
}

// ProcessDetails contains extracted process information.
type ProcessDetails struct {
	Steps      []ProcessStep `json:"steps"`
	Triggers   []string      `json:"triggers"`   // What starts the process
	Outcomes   []string      `json:"outcomes"`   // End states
	Roles      []string      `json:"roles"`      // Actors involved
	SLA        string        `json:"sla,omitempty"`
	Owner      string        `json:"owner"`
}

// ProcessStep represents a step in a process.
type ProcessStep struct {
	ID          string   `json:"id"`
	Order       int      `json:"order"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Actor       string   `json:"actor"`
	Inputs      []string `json:"inputs"`
	Outputs     []string `json:"outputs"`
	Conditions  []string `json:"conditions"`  // When this step applies
	NextSteps   []string `json:"nextSteps"`   // Following step IDs
}

// ===================================================
// EPP Classifier
// ===================================================

// EPPClassifier classifies content as Entity/Policy/Process.
type EPPClassifier struct {
	provider    LLMProvider
	model       string
	maxTokens   int
	temperature float32
}

// NewEPPClassifier creates a new EPP classifier.
func NewEPPClassifier(provider LLMProvider, model string) *EPPClassifier {
	if model == "" {
		model = "gpt-4o-mini"
	}
	return &EPPClassifier{
		provider:    provider,
		model:       model,
		maxTokens:   2048,
		temperature: 0.1,
	}
}

// NewEPPClassifierWithConfig creates an EPP classifier with custom config.
func NewEPPClassifierWithConfig(provider LLMProvider, model string, maxTokens int, temperature float32) *EPPClassifier {
	if model == "" {
		model = "gpt-4o-mini"
	}
	if maxTokens <= 0 {
		maxTokens = 2048
	}
	if temperature <= 0 {
		temperature = 0.1
	}
	return &EPPClassifier{
		provider:    provider,
		model:       model,
		maxTokens:   maxTokens,
		temperature: temperature,
	}
}

// ClassifyRequest represents a classification request.
type ClassifyRequest struct {
	TenantID   string            `json:"tenantId"`
	Title      string            `json:"title"`
	Content    string            `json:"content"`
	SourceID   string            `json:"sourceId"`
	SourceType string            `json:"sourceType"`
	Metadata   map[string]string `json:"metadata,omitempty"`
}

// ClassifyResponse represents the classification result.
type ClassifyResponse struct {
	Classification *EPPClassification `json:"classification"`
	ProcessingMs   int64              `json:"processingMs"`
	ModelUsed      string             `json:"modelUsed"`
}

// Classify classifies content as Entity/Policy/Process.
func (c *EPPClassifier) Classify(ctx context.Context, req ClassifyRequest) (*ClassifyResponse, error) {
	start := time.Now()

	// First, determine the type
	typePrompt := c.buildTypePrompt(req)
	
	// P2 Fix: Use configurable temperature (lower tokens for type classification)
	options := CompletionOptions{
		Model:        c.model,
		MaxTokens:    256, // Type classification uses minimal tokens
		Temperature:  c.temperature,
		SystemPrompt: eppSystemPrompt,
	}

	typeResponse, err := c.provider.Complete(ctx, typePrompt, options)
	if err != nil {
		return nil, fmt.Errorf("type classification failed: %w", err)
	}

	eppType, confidence := c.parseTypeResponse(typeResponse)

	// If it's a policy or process, extract details
	var classification *EPPClassification
	
	switch eppType {
	case EPPTypePolicy:
		classification, err = c.extractPolicy(ctx, req)
		if err != nil {
			return nil, err
		}
	case EPPTypeProcess:
		classification, err = c.extractProcess(ctx, req)
		if err != nil {
			return nil, err
		}
	default:
		classification = &EPPClassification{
			Type:        EPPTypeEntity,
			Confidence:  confidence,
			Title:       req.Title,
			Description: truncate(req.Content, 200),
		}
	}

	classification.Confidence = confidence

	return &ClassifyResponse{
		Classification: classification,
		ProcessingMs:   time.Since(start).Milliseconds(),
		ModelUsed:      c.model,
	}, nil
}

// buildTypePrompt creates the type classification prompt.
func (c *EPPClassifier) buildTypePrompt(req ClassifyRequest) string {
	var sb strings.Builder

	sb.WriteString("Classify the following content as one of: entity, policy, or process.\n\n")
	
	if req.Title != "" {
		sb.WriteString(fmt.Sprintf("Title: %s\n\n", req.Title))
	}

	sb.WriteString("Content:\n```\n")
	// Limit content for type classification
	content := truncate(req.Content, 1500)
	sb.WriteString(content)
	sb.WriteString("\n```\n\n")

	sb.WriteString("Respond with JSON: {\"type\": \"entity|policy|process\", \"confidence\": 0.0-1.0, \"reason\": \"brief explanation\"}")

	return sb.String()
}

// parseTypeResponse parses the type classification response.
func (c *EPPClassifier) parseTypeResponse(response string) (EPPType, float32) {
	response = cleanJSONResponse(response)

	var result struct {
		Type       string  `json:"type"`
		Confidence float32 `json:"confidence"`
	}

	if err := json.Unmarshal([]byte(response), &result); err != nil {
		return EPPTypeEntity, 0.5 // Default to entity
	}

	switch strings.ToLower(result.Type) {
	case "policy":
		return EPPTypePolicy, result.Confidence
	case "process":
		return EPPTypeProcess, result.Confidence
	default:
		return EPPTypeEntity, result.Confidence
	}
}

// extractPolicy extracts policy details.
func (c *EPPClassifier) extractPolicy(ctx context.Context, req ClassifyRequest) (*EPPClassification, error) {
	prompt := c.buildPolicyPrompt(req)

	// P2 Fix: Use configurable maxTokens and temperature
	options := CompletionOptions{
		Model:        c.model,
		MaxTokens:    c.maxTokens,
		Temperature:  c.temperature,
		SystemPrompt: policyExtractionPrompt,
	}

	response, err := c.provider.Complete(ctx, prompt, options)
	if err != nil {
		return nil, err
	}

	return c.parsePolicyResponse(response, req.Title)
}

// buildPolicyPrompt creates the policy extraction prompt.
func (c *EPPClassifier) buildPolicyPrompt(req ClassifyRequest) string {
	var sb strings.Builder

	sb.WriteString("Extract policy details from the following document.\n\n")
	
	if req.Title != "" {
		sb.WriteString(fmt.Sprintf("Title: %s\n\n", req.Title))
	}

	sb.WriteString("Document:\n```\n")
	sb.WriteString(req.Content)
	sb.WriteString("\n```\n\n")

	sb.WriteString(`Extract and return as JSON:
{
  "rules": [{"id": "R1", "statement": "...", "requirement": "must|should|may", "category": "...", "exceptions": []}],
  "appliesTo": ["entity types this applies to"],
  "enforcement": "mandatory|recommended|optional",
  "effectiveDate": "if mentioned",
  "owners": ["policy owners if mentioned"],
  "keywords": ["key terms"]
}`)

	return sb.String()
}

// parsePolicyResponse parses the policy extraction response.
func (c *EPPClassifier) parsePolicyResponse(response, title string) (*EPPClassification, error) {
	response = cleanJSONResponse(response)

	var details PolicyDetails
	if err := json.Unmarshal([]byte(response), &details); err != nil {
		return nil, fmt.Errorf("failed to parse policy: %w", err)
	}

	// Assign rule IDs if not present
	for i := range details.Rules {
		if details.Rules[i].ID == "" {
			details.Rules[i].ID = fmt.Sprintf("R%d", i+1)
		}
	}

	return &EPPClassification{
		Type:   EPPTypePolicy,
		Title:  title,
		Policy: &details,
	}, nil
}

// extractProcess extracts process details.
func (c *EPPClassifier) extractProcess(ctx context.Context, req ClassifyRequest) (*EPPClassification, error) {
	prompt := c.buildProcessPrompt(req)

	// P2 Fix: Use configurable maxTokens and temperature
	options := CompletionOptions{
		Model:        c.model,
		MaxTokens:    c.maxTokens,
		Temperature:  c.temperature,
		SystemPrompt: processExtractionPrompt,
	}

	response, err := c.provider.Complete(ctx, prompt, options)
	if err != nil {
		return nil, err
	}

	return c.parseProcessResponse(response, req.Title)
}

// buildProcessPrompt creates the process extraction prompt.
func (c *EPPClassifier) buildProcessPrompt(req ClassifyRequest) string {
	var sb strings.Builder

	sb.WriteString("Extract process/workflow details from the following document.\n\n")
	
	if req.Title != "" {
		sb.WriteString(fmt.Sprintf("Title: %s\n\n", req.Title))
	}

	sb.WriteString("Document:\n```\n")
	sb.WriteString(req.Content)
	sb.WriteString("\n```\n\n")

	sb.WriteString(`Extract and return as JSON:
{
  "steps": [{"id": "S1", "order": 1, "name": "...", "description": "...", "actor": "...", "inputs": [], "outputs": [], "conditions": [], "nextSteps": ["S2"]}],
  "triggers": ["what starts this process"],
  "outcomes": ["possible end states"],
  "roles": ["actors involved"],
  "sla": "if mentioned",
  "owner": "process owner if mentioned"
}`)

	return sb.String()
}

// parseProcessResponse parses the process extraction response.
func (c *EPPClassifier) parseProcessResponse(response, title string) (*EPPClassification, error) {
	response = cleanJSONResponse(response)

	var details ProcessDetails
	if err := json.Unmarshal([]byte(response), &details); err != nil {
		return nil, fmt.Errorf("failed to parse process: %w", err)
	}

	// Assign step IDs and order if not present
	for i := range details.Steps {
		if details.Steps[i].ID == "" {
			details.Steps[i].ID = fmt.Sprintf("S%d", i+1)
		}
		if details.Steps[i].Order == 0 {
			details.Steps[i].Order = i + 1
		}
	}

	return &EPPClassification{
		Type:    EPPTypeProcess,
		Title:   title,
		Process: &details,
	}, nil
}

// Helper functions

func cleanJSONResponse(response string) string {
	response = strings.TrimSpace(response)
	if strings.HasPrefix(response, "```json") {
		response = strings.TrimPrefix(response, "```json")
		response = strings.TrimSuffix(response, "```")
	} else if strings.HasPrefix(response, "```") {
		response = strings.TrimPrefix(response, "```")
		response = strings.TrimSuffix(response, "```")
	}
	return strings.TrimSpace(response)
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

// System prompts

const eppSystemPrompt = `You are an expert document classifier for enterprise content.
Your task is to classify content as:
- entity: Regular information about a person, project, product, etc.
- policy: A document that defines rules, guidelines, requirements, or compliance mandates
- process: A document that describes a workflow, procedure, or step-by-step operations

Indicators of POLICY:
- Words like "must", "shall", "required", "prohibited", "compliance"
- Rules, guidelines, or requirements
- Exceptions and enforcement clauses
- Effective dates

Indicators of PROCESS:
- Sequential steps or stages
- Actors/roles performing actions
- Inputs and outputs
- Decision points or conditions
- Workflows or pipelines`

const policyExtractionPrompt = `You are an expert at analyzing policy documents.
Extract structured information including:
- Individual rules with their requirement level (must/should/may)
- Who or what the policy applies to
- Enforcement level
- Key stakeholders and owners`

const processExtractionPrompt = `You are an expert at analyzing process documents.
Extract structured information including:
- Sequential steps with their dependencies
- What triggers the process
- Possible outcomes
- Roles and responsibilities
- Time constraints or SLAs`
