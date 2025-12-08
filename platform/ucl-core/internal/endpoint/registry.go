package endpoint

import (
	"fmt"
	"sync"
)

// Factory creates an endpoint instance from configuration.
type Factory func(config map[string]any) (Endpoint, error)

// Registry holds endpoint factories indexed by template ID.
type Registry struct {
	factories map[string]Factory
	mu        sync.RWMutex
}

// NewRegistry creates an empty endpoint registry.
func NewRegistry() *Registry {
	return &Registry{
		factories: make(map[string]Factory),
	}
}

// Register adds a factory for the given template ID.
// Panics if the template ID is already registered.
func (r *Registry) Register(templateID string, factory Factory) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.factories[templateID]; exists {
		panic(fmt.Sprintf("endpoint factory already registered: %s", templateID))
	}
	r.factories[templateID] = factory
}

// Get returns the factory for the given template ID.
func (r *Registry) Get(templateID string) (Factory, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	factory, ok := r.factories[templateID]
	return factory, ok
}

// List returns all registered template IDs.
func (r *Registry) List() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	ids := make([]string, 0, len(r.factories))
	for id := range r.factories {
		ids = append(ids, id)
	}
	return ids
}

// Create instantiates an endpoint from the given template ID and config.
func (r *Registry) Create(templateID string, config map[string]any) (Endpoint, error) {
	factory, ok := r.Get(templateID)
	if !ok {
		return nil, fmt.Errorf("unknown endpoint template: %s", templateID)
	}
	return factory(config)
}

// MustCreate creates an endpoint or panics on error.
func (r *Registry) MustCreate(templateID string, config map[string]any) Endpoint {
	ep, err := r.Create(templateID, config)
	if err != nil {
		panic(err)
	}
	return ep
}

// --- Default Global Registry ---

var defaultRegistry = NewRegistry()

// DefaultRegistry returns the global endpoint registry.
func DefaultRegistry() *Registry {
	return defaultRegistry
}

// Register adds a factory to the default registry.
func Register(templateID string, factory Factory) {
	defaultRegistry.Register(templateID, factory)
}
