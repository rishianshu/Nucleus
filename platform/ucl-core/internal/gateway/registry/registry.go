// Package registry provides connector discovery and connection pooling.
package registry

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// ConnectorFactory creates a connector instance from configuration.
type ConnectorFactory func(config map[string]interface{}) (Connector, error)

// Connector represents a UCL connector instance.
type Connector interface {
	// Close releases connector resources.
	Close() error
	// ID returns the connector template ID.
	ID() string
}

// Registry manages connector factories and instances.
type Registry struct {
	mu        sync.RWMutex
	factories map[string]ConnectorFactory
	pool      *Pool
}

// NewRegistry creates a new connector registry.
func NewRegistry() *Registry {
	return &Registry{
		factories: make(map[string]ConnectorFactory),
		pool:      NewPool(10, 5*time.Minute),
	}
}

// Register adds a connector factory.
func (r *Registry) Register(templateID string, factory ConnectorFactory) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.factories[templateID] = factory
}

// GetFactory returns the factory for a template.
func (r *Registry) GetFactory(templateID string) (ConnectorFactory, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	factory, ok := r.factories[templateID]
	return factory, ok
}

// ListTemplates returns registered template IDs.
func (r *Registry) ListTemplates() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	templates := make([]string, 0, len(r.factories))
	for id := range r.factories {
		templates = append(templates, id)
	}
	return templates
}

// Get returns a connector instance for an endpoint.
func (r *Registry) Get(ctx context.Context, endpointID string, templateID string, config map[string]interface{}) (Connector, error) {
	// Check pool first
	if conn := r.pool.Get(endpointID); conn != nil {
		return conn, nil
	}

	// Get factory
	factory, ok := r.GetFactory(templateID)
	if !ok {
		return nil, fmt.Errorf("unknown template: %s", templateID)
	}

	// Create new connector
	conn, err := factory(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create connector: %w", err)
	}

	// Add to pool
	r.pool.Put(endpointID, conn)
	return conn, nil
}

// Close shuts down the registry and all pooled connections.
func (r *Registry) Close() error {
	return r.pool.Close()
}

// Pool manages pooled connector instances.
type Pool struct {
	mu          sync.RWMutex
	conns       map[string]*pooledConn
	maxIdle     int
	idleTimeout time.Duration
}

type pooledConn struct {
	conn     Connector
	lastUsed time.Time
}

// NewPool creates a connection pool.
func NewPool(maxIdle int, idleTimeout time.Duration) *Pool {
	p := &Pool{
		conns:       make(map[string]*pooledConn),
		maxIdle:     maxIdle,
		idleTimeout: idleTimeout,
	}
	go p.cleanup()
	return p
}

// Get retrieves a pooled connection.
func (p *Pool) Get(endpointID string) Connector {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if pc, ok := p.conns[endpointID]; ok {
		pc.lastUsed = time.Now()
		return pc.conn
	}
	return nil
}

// Put adds a connection to the pool.
func (p *Pool) Put(endpointID string, conn Connector) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.conns[endpointID] = &pooledConn{
		conn:     conn,
		lastUsed: time.Now(),
	}
}

// Close shuts down all pooled connections.
func (p *Pool) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, pc := range p.conns {
		pc.conn.Close()
	}
	p.conns = make(map[string]*pooledConn)
	return nil
}

// cleanup removes idle connections periodically.
func (p *Pool) cleanup() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		p.mu.Lock()
		now := time.Now()
		for id, pc := range p.conns {
			if now.Sub(pc.lastUsed) > p.idleTimeout {
				pc.conn.Close()
				delete(p.conns, id)
			}
		}
		p.mu.Unlock()
	}
}
