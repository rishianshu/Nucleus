package jdbc

import (
	"context"
	"fmt"
	"time"

	"github.com/nucleus/ucl-core/internal/core"
	"github.com/nucleus/ucl-core/internal/endpoint"
)

// =============================================================================
// METADATA CAPABLE
// Implements endpoint.MetadataCapable for JDBC connectors.
// =============================================================================

// ProbeEnvironment gathers database server metadata.
func (b *Base) ProbeEnvironment(ctx context.Context, config map[string]any) (*endpoint.Environment, error) {
	// Get database version
	var version string
	var err error

	switch b.DriverName {
	case "postgres":
		err = b.DB.QueryRowContext(ctx, "SELECT version()").Scan(&version)
	case "oracle":
		err = b.DB.QueryRowContext(ctx, "SELECT banner FROM v$version WHERE rownum = 1").Scan(&version)
	case "sqlserver", "mssql":
		err = b.DB.QueryRowContext(ctx, "SELECT @@VERSION").Scan(&version)
	default:
		err = b.DB.QueryRowContext(ctx, "SELECT version()").Scan(&version)
	}

	if err != nil {
		return &endpoint.Environment{
			Version:    "unknown",
			Properties: map[string]any{"error": err.Error()},
		}, nil
	}

	return &endpoint.Environment{
		Version: version,
		Properties: map[string]any{
			"driver":   b.DriverName,
			"database": b.Config.Database,
			"host":     b.Config.Host,
		},
	}, nil
}

// CollectMetadata produces a catalog snapshot for the database.
func (b *Base) CollectMetadata(ctx context.Context, env *endpoint.Environment) (*endpoint.CatalogSnapshot, error) {
	// Build data source metadata
	dataSource := &core.DataSourceMetadata{
		ID:          b.ID(),
		Name:        b.Config.Database,
		Type:        b.DriverName,
		System:      b.Config.Host,
		Version:     env.Version,
		Environment: "unknown",
		Description: fmt.Sprintf("%s database on %s", b.DriverName, b.Config.Host),
		Properties: map[string]any{
			"driver": b.DriverName,
			"port":   b.Config.Port,
		},
	}

	// Collect schemas
	schemas, err := b.listSchemas(ctx)
	if err != nil {
		return nil, fmt.Errorf("list schemas: %w", err)
	}

	// Collect tables and views
	datasets, err := b.ListDatasets(ctx)
	if err != nil {
		return nil, fmt.Errorf("list datasets: %w", err)
	}

	// Build dataset metadata
	datasetMeta := make([]*core.DatasetMetadata, 0, len(datasets))
	for _, ds := range datasets {
		datasetMeta = append(datasetMeta, &core.DatasetMetadata{
			ID:           ds.ID,
			Name:         ds.Name,
			PhysicalName: ds.ID,
			Type:         ds.Kind,
			SourceID:     b.ID(),
			Location:     ds.ID,
			Tags: map[string]any{
				"kind": ds.Kind,
			},
			Properties: map[string]any{
				"supportsIncremental": ds.SupportsIncremental,
				"incrementalColumn":   ds.IncrementalColumn,
				"primaryKeys":         ds.PrimaryKeys,
			},
		})
	}

	return &endpoint.CatalogSnapshot{
		Source:      b.ID(),
		CollectedAt: time.Now().UTC().Format(time.RFC3339),
		DataSource:  dataSource,
		Extras: map[string]any{
			"schemas":  schemas,
			"datasets": datasetMeta,
			"environment": env,
		},
	}, nil
}

// listSchemas returns available schemas in the database.
func (b *Base) listSchemas(ctx context.Context) ([]string, error) {
	var query string
	switch b.DriverName {
	case "postgres":
		query = `SELECT schema_name FROM information_schema.schemata 
				 WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
				 ORDER BY schema_name`
	case "oracle":
		query = `SELECT username FROM all_users ORDER BY username`
	case "sqlserver", "mssql":
		query = `SELECT name FROM sys.schemas WHERE name NOT IN ('sys', 'INFORMATION_SCHEMA') ORDER BY name`
	default:
		query = `SELECT schema_name FROM information_schema.schemata ORDER BY schema_name`
	}

	rows, err := b.DB.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var schemas []string
	for rows.Next() {
		var schema string
		if err := rows.Scan(&schema); err != nil {
			return nil, err
		}
		schemas = append(schemas, schema)
	}

	return schemas, rows.Err()
}
