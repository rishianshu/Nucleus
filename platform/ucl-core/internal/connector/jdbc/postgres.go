package jdbc

import (
	"context"
	"fmt"
	"strings"
	"time"

	_ "github.com/lib/pq" // PostgreSQL driver
	"github.com/nucleus/ucl-core/internal/endpoint"
)

// Postgres extends Base with PostgreSQL-specific optimizations.
type Postgres struct {
	*Base
}

// NewPostgres creates a PostgreSQL connector.
func NewPostgres(config map[string]interface{}) (*Postgres, error) {
	// Force driver to postgres
	config["driver"] = "postgres"

	base, err := NewBase(config)
	if err != nil {
		return nil, err
	}

	return &Postgres{Base: base}, nil
}

// ID returns the connector template ID.
func (p *Postgres) ID() string {
	return "jdbc.postgres"
}

// ValidateConfig tests connection and returns PostgreSQL version.
func (p *Postgres) ValidateConfig(ctx context.Context) (*ValidateResult, error) {
	result, err := p.Base.ValidateConfig(ctx)
	if err != nil || !result.Valid {
		return result, err
	}

	// Get PostgreSQL version
	var version string
	p.DB.QueryRowContext(ctx, "SELECT version()").Scan(&version)
	result.DetectedVersion = version

	return result, nil
}

// ListDatasets filters out system schemas.
func (p *Postgres) ListDatasets(ctx context.Context) ([]*DatasetItem, error) {
	query := `
		SELECT table_schema, table_name, table_type
		FROM information_schema.tables
		WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
		ORDER BY table_schema, table_name
	`

	rows, err := p.DB.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to list datasets: %w", err)
	}
	defer rows.Close()

	var datasets []*DatasetItem
	for rows.Next() {
		var schema, name, tableType string
		if err := rows.Scan(&schema, &name, &tableType); err != nil {
			continue
		}

		kind := "table"
		if strings.Contains(strings.ToLower(tableType), "view") {
			kind = "view"
		}

		datasets = append(datasets, &DatasetItem{
			ID:   fmt.Sprintf("%s.%s", schema, name),
			Name: name,
			Kind: kind,
		})
	}

	return datasets, nil
}

// GetSchema returns columns with precision/scale and constraints.
func (p *Postgres) GetSchema(ctx context.Context, datasetID string) (*SchemaResult, error) {
	parts := strings.SplitN(datasetID, ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid dataset_id format")
	}
	schema, table := parts[0], parts[1]

	// Get columns with full metadata
	columnsQuery := `
		SELECT 
			column_name,
			data_type,
			is_nullable,
			COALESCE(numeric_precision, 0),
			COALESCE(numeric_scale, 0),
			COALESCE(character_maximum_length, 0),
			COALESCE(column_default, ''),
			ordinal_position
		FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = $2
		ORDER BY ordinal_position
	`

	rows, err := p.DB.QueryContext(ctx, columnsQuery, schema, table)
	if err != nil {
		return nil, fmt.Errorf("failed to get schema: %w", err)
	}
	defer rows.Close()

	var fields []*FieldDefinition
	for rows.Next() {
		var f FieldDefinition
		var isNullable, defaultVal string
		var precision, scale, length, position int

		if err := rows.Scan(&f.Name, &f.DataType, &isNullable, &precision, &scale, &length, &defaultVal, &position); err != nil {
			continue
		}

		f.Nullable = isNullable == "YES"
		f.Precision = precision
		f.Scale = scale
		f.Length = length
		f.Position = position

		fields = append(fields, &f)
	}

	// Get statistics from pg_class (fast)
	statsQuery := `
		SELECT 
			COALESCE(reltuples::bigint, 0) AS row_count,
			COALESCE(pg_total_relation_size(c.oid), 0) AS size_bytes
		FROM pg_class c
		JOIN pg_namespace n ON c.relnamespace = n.oid
		WHERE n.nspname = $1 AND c.relname = $2
	`

	var stats DatasetStatistics
	p.DB.QueryRowContext(ctx, statsQuery, schema, table).Scan(&stats.RowCount, &stats.SizeBytes)

	// Get constraints
	constraintsQuery := `
		SELECT 
			tc.constraint_name,
			tc.constraint_type,
			kcu.column_name
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
			ON tc.constraint_name = kcu.constraint_name
		WHERE tc.table_schema = $1 AND tc.table_name = $2
		ORDER BY tc.constraint_name, kcu.ordinal_position
	`

	constraintRows, err := p.DB.QueryContext(ctx, constraintsQuery, schema, table)
	if err == nil {
		defer constraintRows.Close()

		constraintMap := make(map[string]*Constraint)
		for constraintRows.Next() {
			var name, ctype, column string
			if err := constraintRows.Scan(&name, &ctype, &column); err != nil {
				continue
			}

			if c, ok := constraintMap[name]; ok {
				c.Fields = append(c.Fields, column)
			} else {
				constraintMap[name] = &Constraint{
					Name:   name,
					Type:   strings.ToLower(strings.ReplaceAll(ctype, " ", "_")),
					Fields: []string{column},
				}
			}
		}

		var constraints []*Constraint
		for _, c := range constraintMap {
			constraints = append(constraints, c)
		}

		return &SchemaResult{
			Fields:      fields,
			Statistics:  &stats,
			Constraints: constraints,
		}, nil
	}

	return &SchemaResult{
		Fields:     fields,
		Statistics: &stats,
	}, nil
}

// Provision ensures the sink destination exists.
func (p *Postgres) Provision(ctx context.Context, datasetID string, schema *endpoint.Schema) error {
	dest := normalizeDestTable(datasetID, p.Config.Schema, p.Config.TablePrefix)
	columns := schemaColumns(schema)
	if len(columns) == 0 {
		columns = modelColumnsFromCDM(datasetID)
	}
	return p.ensureSinkTable(ctx, dest, columns)
}

// WriteRaw inserts normalized records into the destination table.
func (p *Postgres) WriteRaw(ctx context.Context, req *endpoint.WriteRequest) (*endpoint.WriteResult, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	dest := normalizeDestTable(req.DatasetID, p.Config.Schema, p.Config.TablePrefix)
	columns := modelColumnsFromCDM(req.DatasetID)
	if schemaCols := schemaColumns(req.Schema); len(schemaCols) > 0 {
		columns = schemaCols
	}
	if err := p.ensureSinkTable(ctx, dest, columns); err != nil {
		return nil, fmt.Errorf("provision table: %w", err)
	}
	schema, table := splitSchemaTable(dest)
	if schema == "" {
		schema = p.Config.Schema
	}
	full := fmt.Sprintf("%s.%s", quoteIdent(schema), quoteIdent(table))

	tx, err := p.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	stmt := fmt.Sprintf("INSERT INTO %s (id, entity_type, display_name, payload, observed_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING", full)
	var rows int64
	now := time.Now().UTC()
	for _, rec := range req.Records {
		payload := rec
		id := fmt.Sprintf("%v", rec["logicalId"])
		entity := fmt.Sprintf("%v", rec["entityType"])
		display := fmt.Sprintf("%v", rec["displayName"])
		if _, err := tx.ExecContext(ctx, stmt, id, entity, display, payload, now); err != nil {
			return nil, err
		}
		rows++
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &endpoint.WriteResult{RowsWritten: rows, Path: full}, nil
}

// Finalize is a no-op for Postgres sink.
func (p *Postgres) Finalize(ctx context.Context, datasetID string, loadDate string) (*endpoint.FinalizeResult, error) {
	_ = ctx
	_ = loadDate
	return &endpoint.FinalizeResult{FinalPath: datasetID}, nil
}

// GetLatestWatermark returns empty as placeholder.
func (p *Postgres) GetLatestWatermark(ctx context.Context, datasetID string) (string, error) {
	_ = ctx
	_ = datasetID
	return "", nil
}

// normalizeDestTable maps dataset/model IDs to table names by convention.
func normalizeDestTable(datasetID string, schema string, prefix string) string {
	if schema == "" {
		schema = "public"
	}
	if prefix == "" {
		prefix = ""
	}
	trimmed := strings.TrimSpace(datasetID)
	trimmed = strings.TrimPrefix(trimmed, "cdm.")
	trimmed = strings.ReplaceAll(trimmed, ".", "_")
	trimmed = strings.ReplaceAll(trimmed, ":", "_")
	return fmt.Sprintf("%s.%s%s", schema, prefix, trimmed)
}

// GetStatistics uses pg_class for fast statistics.
func (p *Postgres) GetStatistics(ctx context.Context, datasetID string, filter map[string]interface{}) (map[string]interface{}, error) {
	parts := strings.SplitN(datasetID, ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid dataset_id format")
	}
	schema, table := parts[0], parts[1]

	// Fast row count from pg_class
	query := `
		SELECT COALESCE(reltuples::bigint, 0)
		FROM pg_class c
		JOIN pg_namespace n ON c.relnamespace = n.oid
		WHERE n.nspname = $1 AND c.relname = $2
	`

	var rowCount int64
	p.DB.QueryRowContext(ctx, query, schema, table).Scan(&rowCount)

	result := map[string]interface{}{
		"row_count": rowCount,
	}

	// Watermark if requested
	if col, ok := filter["watermark_column"].(string); ok && col != "" {
		watermarkQuery := fmt.Sprintf(
			"SELECT MAX(%s)::text FROM %s.%s",
			col, schema, table,
		)
		var watermark *string
		p.DB.QueryRowContext(ctx, watermarkQuery).Scan(&watermark)
		if watermark != nil {
			result["watermark"] = *watermark
		}
	}

	return result, nil
}
