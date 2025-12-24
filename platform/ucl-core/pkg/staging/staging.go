package staging

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/google/uuid"
)

const (
	ProviderMemory      = "memory"
	ProviderObjectStore = "object"
	ProviderMinIO       = "object.minio"

	// DefaultLargeRunThresholdBytes determines when object-store staging is required.
	DefaultLargeRunThresholdBytes int64 = 2 * 1024 * 1024 // ~2MB
	// DefaultMemoryCapBytes is the max bytes allowed for the in-memory provider.
	DefaultMemoryCapBytes int64 = 2 * 1024 * 1024
	// MaxPayloadBytes keeps compatibility with preview responses that need staging.
	MaxPayloadBytes = 500_000
)

// ErrorCode represents a structured staging error code.
type ErrorCode string

const (
	CodeStagingUnavailable ErrorCode = "E_STAGING_UNAVAILABLE"
	CodeStageTooLarge      ErrorCode = "E_STAGE_TOO_LARGE"
)

// Error carries a staging error code and retryability hint.
type Error struct {
	Code      ErrorCode
	Retryable bool
	Err       error
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Code, e.Err)
	}
	return string(e.Code)
}

func (e *Error) Unwrap() error { return e.Err }

// CodeValue returns the string error code for integration with operation state.
func (e *Error) CodeValue() string { return string(e.Code) }

// RetryableStatus indicates if the operation can be retried.
func (e *Error) RetryableStatus() bool { return e.Retryable }

// CodedError exposes staging error metadata.
type CodedError interface {
	error
	CodeValue() string
	RetryableStatus() bool
}

// RecordEnvelope wraps a payload with ingestion metadata to avoid raw maps in staging.
type RecordEnvelope struct {
	RecordKind    string         `json:"recordKind"`                   // "raw" | "cdm"
	EntityKind    string         `json:"entityKind"`                   // e.g., "work.item"
	Source        SourceRef      `json:"source"`                       // source endpoint metadata
	TenantID      string         `json:"tenantId,omitempty"`           // optional tenant
	ProjectKey    string         `json:"projectKey,omitempty"`         // optional project/workspace hint
	Payload       map[string]any `json:"payload"`                      // actual record payload
	VectorPayload map[string]any `json:"vectorPayload,omitempty"`      // pre-normalized vector-ready record (if endpoint supports VectorProfileProvider)
	ObservedAt    string         `json:"observedAt,omitempty"`         // ISO timestamp
}


// SourceRef describes the originating endpoint/source for staged data.
type SourceRef struct {
	EndpointID   string `json:"endpointId,omitempty"`
	SourceFamily string `json:"sourceFamily,omitempty"`
	SourceID     string `json:"sourceId,omitempty"`
	URL          string `json:"url,omitempty"`
	ExternalID   string `json:"externalId,omitempty"`
}

// BatchStats summarizes a staged batch.
type BatchStats struct {
	Records int   `json:"records"`
	Bytes   int64 `json:"bytes"`
}

// PutBatchRequest is the staging provider input.
type PutBatchRequest struct {
	StageRef string
	StageID  string
	SliceID  string
	BatchSeq int
	Records  []RecordEnvelope
}

// PutBatchResult is returned by providers after staging a batch.
type PutBatchResult struct {
	StageRef string
	BatchRef string
	Stats    BatchStats
}

// Provider is a pluggable staging backend (memory, object store, etc.).
type Provider interface {
	ID() string
	PutBatch(ctx context.Context, req *PutBatchRequest) (*PutBatchResult, error)
	ListBatches(ctx context.Context, stageRef string, sliceID string) ([]string, error)
	GetBatch(ctx context.Context, stageRef string, batchRef string) ([]RecordEnvelope, error)
	FinalizeStage(ctx context.Context, stageRef string) error
}

// Registry holds available staging providers for selection.
type Registry struct {
	mu        sync.RWMutex
	providers map[string]Provider
}

// NewRegistry builds a registry with optional initial providers.
func NewRegistry(providers ...Provider) *Registry {
	reg := &Registry{providers: make(map[string]Provider)}
	for _, p := range providers {
		reg.Register(p)
	}
	return reg
}

// Register adds or replaces a provider by ID.
func (r *Registry) Register(p Provider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.providers[p.ID()] = p
}

// Get returns a provider by ID.
func (r *Registry) Get(id string) (Provider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.providers[id]
	return p, ok
}

// ProviderIDs returns registered provider IDs.
func (r *Registry) ProviderIDs() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := make([]string, 0, len(r.providers))
	for id := range r.providers {
		ids = append(ids, id)
	}
	return ids
}

// SelectProvider chooses a provider based on size hints and preference.
func (r *Registry) SelectProvider(preferred string, estimatedBytes int64, threshold int64) (Provider, error) {
	if threshold <= 0 {
		threshold = DefaultLargeRunThresholdBytes
	}

	if estimatedBytes > threshold {
		if p, ok := r.Get(ProviderMinIO); ok {
			return p, nil
		}
		if p, ok := r.Get(ProviderObjectStore); ok {
			return p, nil
		}
		return nil, &Error{Code: CodeStagingUnavailable, Retryable: true, Err: fmt.Errorf("object-store staging required for %d bytes", estimatedBytes)}
	}

	if preferred != "" {
		if p, ok := r.Get(preferred); ok {
			return p, nil
		}
	}

	if p, ok := r.Get(ProviderMemory); ok {
		return p, nil
	}
	if p, ok := r.Get(ProviderObjectStore); ok {
		return p, nil
	}
	if p, ok := r.Get(ProviderMinIO); ok {
		return p, nil
	}

	return nil, &Error{Code: CodeStagingUnavailable, Retryable: true, Err: fmt.Errorf("no staging providers available")}
}

// NewStageID creates a new opaque stage identifier safe for Temporal payloads.
func NewStageID() string {
	return "stage-" + strings.ReplaceAll(uuid.New().String(), "-", "")
}

// MakeStageRef encodes provider + stage ID into a compact ref.
func MakeStageRef(providerID, stageID string) string {
	if providerID == "" {
		providerID = ProviderMemory
	}
	return providerID + ":" + stageID
}

// ParseStageRef splits a stageRef into provider and stage ID.
func ParseStageRef(stageRef string) (providerID, stageID string) {
	parts := strings.SplitN(stageRef, ":", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return "", stageRef
}

// resolveStageID picks the stage ID from a ref or explicit field.
func resolveStageID(stageRef, stageID string) string {
	if stageRef != "" {
		if _, id := ParseStageRef(stageRef); id != "" {
			return id
		}
	}
	return stageID
}

// batchKey creates a deterministic batch ref within a stage.
func batchKey(sliceID string, seq int) string {
	if sliceID == "" {
		sliceID = "slice"
	}
	return fmt.Sprintf("%s-%06d", sliceID, seq)
}
