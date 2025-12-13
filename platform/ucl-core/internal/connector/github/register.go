package github

import "github.com/nucleus/ucl-core/internal/endpoint"

// init registers GitHub with the endpoint registry.
func init() {
	registry := endpoint.DefaultRegistry()
	registry.Register("http.github", func(config map[string]any) (endpoint.Endpoint, error) {
		return New(config)
	})
}
