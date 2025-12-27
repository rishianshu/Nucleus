package ner

import (
	"context"
	"fmt"
	"time"

	"github.com/nucleus/store-core/pkg/entity"
)

// ===================================================
// NER Activity - Temporal Workflow Integration
// Orchestrates entity extraction and EPP classification
// ===================================================

// ActivityConfig configures the NER activity.
type ActivityConfig struct {
	// LLM settings
	Model           string  `json:"model"`
	MaxTokens       int     `json:"maxTokens"`
	Temperature     float32 `json:"temperature"`
	
	// Extraction settings
	ExtractEntities bool `json:"extractEntities"`
	ClassifyEPP     bool `json:"classifyEpp"`
	
	// Observer settings
	AutoMergeThreshold float32 `json:"autoMergeThreshold"`
	TrackCrossSource   bool    `json:"trackCrossSource"`
}

// DefaultActivityConfig returns default configuration.
func DefaultActivityConfig() ActivityConfig {
	return ActivityConfig{
		Model:              "gpt-4o-mini",
		MaxTokens:          2048,
		Temperature:        0.1,
		ExtractEntities:    true,
		ClassifyEPP:        true,
		AutoMergeThreshold: 0.9,
		TrackCrossSource:   true,
	}
}

// NERActivity orchestrates NER and EPP classification.
type NERActivity struct {
	extractor  *NERExtractor
	classifier *EPPClassifier
	observer   *EntityObserver
	matcher    entity.EntityMatcher
	config     ActivityConfig
}

// NewNERActivity creates a new NER activity.
func NewNERActivity(
	provider LLMProvider,
	matcher entity.EntityMatcher,
	config ActivityConfig,
) *NERActivity {
	observer := NewEntityObserver(matcher)
	// P2 Fix: Apply auto-merge threshold from config
	observer.SetAutoMergeThreshold(config.AutoMergeThreshold)
	
	// P2 Fix: Pass MaxTokens and Temperature from config to extractors
	return &NERActivity{
		extractor:  NewNERExtractorWithConfig(provider, config.Model, config.MaxTokens, config.Temperature),
		classifier: NewEPPClassifierWithConfig(provider, config.Model, config.MaxTokens, config.Temperature),
		observer:   observer,
		matcher:    matcher,
		config:     config,
	}
}

// ProcessRequest represents a request to process content.
type ProcessRequest struct {
	TenantID   string            `json:"tenantId"`
	SourceID   string            `json:"sourceId"`
	SourceType string            `json:"sourceType"`
	SourceURL  string            `json:"sourceUrl"`
	Title      string            `json:"title"`
	Content    string            `json:"content"`
	Metadata   map[string]string `json:"metadata,omitempty"`
}

// ProcessResult represents the processing result.
type ProcessResult struct {
	// Entity extraction results
	Entities        []ExtractedEntity     `json:"entities"`
	EntityCount     int                   `json:"entityCount"`
	
	// EPP classification result
	Classification  *EPPClassification    `json:"classification,omitempty"`
	
	// Cross-source observations
	Observations    []*ObservedEntity     `json:"observations,omitempty"`
	MatchedCount    int                   `json:"matchedCount"`
	CreatedCount    int                   `json:"createdCount"`
	ReviewCount     int                   `json:"reviewCount"`
	
	// Resolved canonical entities
	ResolvedEntities []ResolvedEntity     `json:"resolvedEntities,omitempty"`
	
	// Processing metrics
	ProcessingMs    int64                 `json:"processingMs"`
	TokensUsed      int                   `json:"tokensUsed"`
}

// ResolvedEntity represents a resolved canonical entity.
type ResolvedEntity struct {
	CanonicalID    string   `json:"canonicalId"`
	Name           string   `json:"name"`
	Type           string   `json:"type"`
	MatchScore     float32  `json:"matchScore"`
	IsNew          bool     `json:"isNew"`
	Sources        []string `json:"sources"`
}

// Process processes content for NER and EPP classification.
// This is the main Temporal activity function.
func (a *NERActivity) Process(ctx context.Context, req ProcessRequest) (*ProcessResult, error) {
	start := time.Now()
	result := &ProcessResult{}

	// Step 1: Extract entities
	if a.config.ExtractEntities {
		nerReq := NERRequest{
			TenantID:   req.TenantID,
			Text:       req.Content,
			SourceID:   req.SourceID,
			SourceType: req.SourceType,
		}

		nerResp, err := a.extractor.Extract(ctx, nerReq)
		if err != nil {
			return nil, fmt.Errorf("entity extraction failed: %w", err)
		}

		result.Entities = nerResp.Entities
		result.EntityCount = len(result.Entities)
		result.TokensUsed += nerResp.TokensUsed

		// Track entities in observer for cross-source deduplication
		if a.config.TrackCrossSource {
			for _, extracted := range result.Entities {
				obs, err := a.observer.Observe(ctx, req.TenantID, extracted, req.SourceURL)
				if err != nil {
					continue // Log but don't fail
				}
				result.Observations = append(result.Observations, obs)
			}
		}
	}

	// Step 2: Classify as EPP
	if a.config.ClassifyEPP {
		classifyReq := ClassifyRequest{
			TenantID:   req.TenantID,
			Title:      req.Title,
			Content:    req.Content,
			SourceID:   req.SourceID,
			SourceType: req.SourceType,
			Metadata:   req.Metadata,
		}

		classifyResp, err := a.classifier.Classify(ctx, classifyReq)
		if err != nil {
			// Log but don't fail the whole process
			// Classification is optional enrichment
		} else {
			result.Classification = classifyResp.Classification
		}
	}

	// Step 3: Resolve observations to canonical entities
	if a.config.TrackCrossSource && len(result.Observations) > 0 {
		for _, obs := range result.Observations {
			resolvedObs, err := a.observer.ResolveObservation(ctx, obs.ID)
			if err != nil {
				continue
			}

			switch resolvedObs.Status {
			case StatusMatched:
				result.MatchedCount++
			case StatusCreated:
				result.CreatedCount++
			case StatusReview:
				result.ReviewCount++
			}

			// Create resolved entity view
			if resolvedObs.CanonicalID != "" || resolvedObs.Status == StatusCreated {
				resolved := ResolvedEntity{
					CanonicalID: resolvedObs.CanonicalID,
					Name:        resolvedObs.Entity.Normalized,
					Type:        string(resolvedObs.Entity.Type),
					MatchScore:  resolvedObs.MatchScore,
					IsNew:       resolvedObs.Status == StatusCreated,
					Sources:     []string{resolvedObs.SourceType},
				}
				result.ResolvedEntities = append(result.ResolvedEntities, resolved)
			}
		}
	}

	result.ProcessingMs = time.Since(start).Milliseconds()
	return result, nil
}

// GetCrossSourceView returns a cross-source view of an entity.
// P0 Fix: Added tenantID parameter for tenant isolation.
func (a *NERActivity) GetCrossSourceView(tenantID string, normalized string, entityType EntityType) *CrossSourceEntityView {
	return a.observer.BuildCrossSourceView(tenantID, normalized, entityType)
}

// GetPendingReviews returns observations needing manual review.
func (a *NERActivity) GetPendingReviews(tenantID string) []*ObservedEntity {
	return a.observer.GetReviewObservations(tenantID)
}

// ApproveEntityMatch approves a match for an observation.
// P1 Fix: Added tenantID parameter for tenant isolation.
func (a *NERActivity) ApproveEntityMatch(tenantID, obsID, canonicalID string) error {
	return a.observer.ApproveMatch(tenantID, obsID, canonicalID)
}

// RejectEntity rejects an observation as invalid.
// P1 Fix: Added tenantID parameter for tenant isolation.
func (a *NERActivity) RejectEntity(tenantID, obsID string) error {
	return a.observer.RejectObservation(tenantID, obsID)
}

// GetObserverStats returns observation statistics.
func (a *NERActivity) GetObserverStats(tenantID string) ObserverStats {
	return a.observer.Stats(tenantID)
}

// ===================================================
// Batch Processing
// ===================================================

// BatchProcessRequest represents a batch processing request.
type BatchProcessRequest struct {
	TenantID string           `json:"tenantId"`
	Items    []ProcessRequest `json:"items"`
}

// BatchProcessResult represents batch processing results.
type BatchProcessResult struct {
	Results      []*ProcessResult `json:"results"`
	TotalItems   int              `json:"totalItems"`
	SuccessCount int              `json:"successCount"`
	FailedCount  int              `json:"failedCount"`
	TotalMs      int64            `json:"totalMs"`
}

// ProcessBatch processes multiple items.
func (a *NERActivity) ProcessBatch(ctx context.Context, req BatchProcessRequest) (*BatchProcessResult, error) {
	start := time.Now()
	result := &BatchProcessResult{
		TotalItems: len(req.Items),
	}

	for _, item := range req.Items {
		item.TenantID = req.TenantID
		res, err := a.Process(ctx, item)
		if err != nil {
			result.FailedCount++
			continue
		}
		result.Results = append(result.Results, res)
		result.SuccessCount++
	}

	result.TotalMs = time.Since(start).Milliseconds()
	return result, nil
}

// ===================================================
// Temporal Activity Registration
// ===================================================

// ActivityName returns the activity name for Temporal registration.
func (a *NERActivity) ActivityName() string {
	return "NERActivity.Process"
}

// BatchActivityName returns the batch activity name.
func (a *NERActivity) BatchActivityName() string {
	return "NERActivity.ProcessBatch"
}
