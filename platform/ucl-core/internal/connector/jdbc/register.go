package jdbc

import (
	"context"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// init registers JDBC factories with the endpoint registry.
func init() {
	registry := endpoint.DefaultRegistry()

	// Register Postgres factory
	registry.Register("jdbc.postgres", func(config map[string]any) (endpoint.Endpoint, error) {
		pg, err := NewPostgres(config)
		if err != nil {
			return nil, err
		}
		return &jdbcEndpoint{Base: pg.Base}, nil
	})

	// Register Oracle factory
	registry.Register("jdbc.oracle", func(config map[string]any) (endpoint.Endpoint, error) {
		ora, err := NewOracle(config)
		if err != nil {
			return nil, err
		}
		return &jdbcEndpoint{Base: ora.Base}, nil
	})

	// Register SQL Server factory
	registry.Register("jdbc.sqlserver", func(config map[string]any) (endpoint.Endpoint, error) {
		mssql, err := NewMSSQL(config)
		if err != nil {
			return nil, err
		}
		return &jdbcEndpoint{Base: mssql.Base}, nil
	})
}

// jdbcEndpoint wraps Base to implement all endpoint interfaces.
type jdbcEndpoint struct {
	*Base
}

// Implement endpoint.Endpoint interface
func (j *jdbcEndpoint) ValidateConfig(ctx context.Context, config map[string]any) (*endpoint.ValidationResult, error) {
	return j.ValidateConfigEndpoint(ctx, config)
}

// Implement endpoint.SourceEndpoint interface
func (j *jdbcEndpoint) ListDatasets(ctx context.Context) ([]*endpoint.Dataset, error) {
	return j.ListDatasetsEndpoint(ctx)
}

func (j *jdbcEndpoint) GetSchema(ctx context.Context, datasetID string) (*endpoint.Schema, error) {
	return j.GetSchemaEndpoint(ctx, datasetID)
}

func (j *jdbcEndpoint) Read(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	return j.ReadEndpoint(ctx, req)
}

// Implement endpoint.SliceCapable interface
func (j *jdbcEndpoint) ReadSlice(ctx context.Context, req *endpoint.SliceReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	return j.ReadSliceEndpoint(ctx, req)
}

// Implement endpoint.MetadataCapable interface
// (ProbeEnvironment and CollectMetadata are already on Base)
