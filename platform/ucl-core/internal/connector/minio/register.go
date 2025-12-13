package minio

import "github.com/nucleus/ucl-core/internal/endpoint"

func init() {
	endpoint.Register("object.minio", func(config map[string]any) (endpoint.Endpoint, error) {
		return New(config)
	})
}
