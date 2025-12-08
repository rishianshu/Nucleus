package onedrive

import (
	"github.com/nucleus/ucl-core/internal/endpoint"
)

// init registers OneDrive factory with the endpoint registry.
func init() {
	registry := endpoint.DefaultRegistry()

	registry.Register("cloud.onedrive", func(config map[string]any) (endpoint.Endpoint, error) {
		return New(config)
	})
}
