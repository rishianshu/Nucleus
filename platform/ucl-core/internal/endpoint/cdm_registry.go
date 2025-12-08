package endpoint

import (
	"sync"
)

// =============================================================================
// CDM REGISTRY
// Manages CDM model mappings for semantic sources.
// Generic sources (JDBC, etc.) do not have CDM mappings.
// =============================================================================

// CDMMapping describes a CDM model available for a dataset.
type CDMMapping struct {
	DatasetID  string // e.g., "jira.issues"
	CdmModelID string // e.g., "cdm.work.item"
	Domains    []string // e.g., ["entity.work.item"]
}

// CDMMapperFunc converts a raw record to CDM format.
type CDMMapperFunc func(record Record) (any, error)

// CDMRegistry holds CDM mappings for semantic sources.
type CDMRegistry struct {
	mappings map[string][]CDMMapping // endpointID → mappings
	mappers  map[string]CDMMapperFunc // datasetID → mapper
	mu       sync.RWMutex
}

// NewCDMRegistry creates an empty CDM registry.
func NewCDMRegistry() *CDMRegistry {
	return &CDMRegistry{
		mappings: make(map[string][]CDMMapping),
		mappers:  make(map[string]CDMMapperFunc),
	}
}

// RegisterMappings adds CDM mappings for an endpoint.
func (r *CDMRegistry) RegisterMappings(endpointID string, mappings []CDMMapping) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.mappings[endpointID] = mappings
}

// RegisterMapper adds a mapper function for a dataset.
func (r *CDMRegistry) RegisterMapper(datasetID string, mapper CDMMapperFunc) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.mappers[datasetID] = mapper
}

// GetModels returns all CDM model IDs for an endpoint.
func (r *CDMRegistry) GetModels(endpointID string) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	mappings := r.mappings[endpointID]
	models := make([]string, 0, len(mappings))
	for _, m := range mappings {
		models = append(models, m.CdmModelID)
	}
	return models
}

// GetMappings returns all CDM mappings for an endpoint.
func (r *CDMRegistry) GetMappings(endpointID string) []CDMMapping {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.mappings[endpointID]
}

// GetMapper returns the mapper function for a dataset.
func (r *CDMRegistry) GetMapper(datasetID string) (CDMMapperFunc, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	mapper, ok := r.mappers[datasetID]
	return mapper, ok
}

// SupportsDataset returns true if the dataset has CDM mapping.
func (r *CDMRegistry) SupportsDataset(datasetID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.mappers[datasetID]
	return ok
}

// HasCDM returns true if the endpoint has any CDM mappings.
func (r *CDMRegistry) HasCDM(endpointID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	mappings, ok := r.mappings[endpointID]
	return ok && len(mappings) > 0
}

// List returns all registered endpoint IDs with CDM.
func (r *CDMRegistry) List() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	ids := make([]string, 0, len(r.mappings))
	for id := range r.mappings {
		ids = append(ids, id)
	}
	return ids
}

// --- Default Global CDM Registry ---

var defaultCDMRegistry = NewCDMRegistry()

// DefaultCDMRegistry returns the global CDM registry.
func DefaultCDMRegistry() *CDMRegistry {
	return defaultCDMRegistry
}

// RegisterCDM adds mappings to the default registry.
func RegisterCDM(endpointID string, mappings []CDMMapping) {
	defaultCDMRegistry.RegisterMappings(endpointID, mappings)
}

// RegisterCDMMapper adds a mapper to the default registry.
func RegisterCDMMapper(datasetID string, mapper CDMMapperFunc) {
	defaultCDMRegistry.RegisterMapper(datasetID, mapper)
}
