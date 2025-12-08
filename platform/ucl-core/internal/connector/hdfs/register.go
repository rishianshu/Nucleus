package hdfs

import (
	"github.com/nucleus/ucl-core/internal/endpoint"
)

// init registers HDFS factory with the endpoint registry.
func init() {
	registry := endpoint.DefaultRegistry()

	registry.Register("hdfs.webhdfs", func(config map[string]any) (endpoint.Endpoint, error) {
		return New(config)
	})
}
