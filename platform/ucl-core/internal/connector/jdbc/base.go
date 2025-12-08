// Package jdbc implements JDBC database connectors with vendor-specific extensions.
//
// Architecture:
//
//	Base       - Generic JDBC connector (fallback)
//	Postgres   - PostgreSQL with pg_class stats, SSL
//	Oracle     - Oracle with NUMBER guardrails, case-sensitivity
//	MSSQL      - SQL Server with Windows auth
//
// Each vendor connector embeds Base and overrides vendor-specific behavior.
// All connectors implement endpoint.SourceEndpoint and endpoint.SliceCapable.
package jdbc

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// Compile-time interface checks (enabled after full implementation)
// var (
// 	_ endpoint.SourceEndpoint = (*Base)(nil)
// 	_ endpoint.SliceCapable   = (*Base)(nil)
// )

// Base implements the generic JDBC connector.
// Vendor-specific connectors embed this and override methods as needed.
type Base struct {
	Config     *Config
	DB         *sql.DB
	DriverName string
	Descriptor *endpoint.Descriptor
}

// NewBase creates a generic JDBC connector.
func NewBase(config map[string]interface{}) (*Base, error) {
	cfg := ParseConfig(config)
	
	db, err := sql.Open(cfg.Driver, cfg.ConnectionString)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}
	
	// Configure pool
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	
	return &Base{Config: cfg, DB: db, DriverName: cfg.Driver}, nil
}

// Close releases database resources.
func (b *Base) Close() error {
	if b.DB != nil {
		return b.DB.Close()
	}
	return nil
}

// ID returns the connector template ID.
func (b *Base) ID() string {
	return "jdbc." + b.DriverName
}

// ValidateConfig tests the database connection.
func (b *Base) ValidateConfig(ctx context.Context) (*ValidateResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	
	if err := b.DB.PingContext(ctx); err != nil {
		return &ValidateResult{Valid: false, Message: err.Error()}, nil
	}
	
	return &ValidateResult{
		Valid:   true,
		Message: "Connection successful",
	}, nil
}

// GetCapabilitiesLegacy returns connector capabilities using legacy local types.
// Kept for compatibility with vendor-specific connectors.
func (b *Base) GetCapabilitiesLegacy(ctx context.Context) *Capabilities {
	return &Capabilities{
		SupportsFull:        true,
		SupportsIncremental: true,
		SupportsCountProbe:  true,
		SupportsPreview:     true,
		SupportsMetadata:    true,
		DefaultFetchSize:    10000,
	}
}

// ListDatasets returns available tables and views (generic ANSI SQL).
func (b *Base) ListDatasets(ctx context.Context) ([]*DatasetItem, error) {
	query := `
		SELECT table_schema, table_name, table_type
		FROM information_schema.tables
		ORDER BY table_schema, table_name
	`
	
	rows, err := b.DB.QueryContext(ctx, query)
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

// GetSchema returns column definitions (generic ANSI SQL).
func (b *Base) GetSchema(ctx context.Context, datasetID string) (*SchemaResult, error) {
	parts := strings.SplitN(datasetID, ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid dataset_id format, expected 'schema.table'")
	}
	schema, table := parts[0], parts[1]
	
	query := `
		SELECT 
			column_name,
			data_type,
			is_nullable,
			ordinal_position
		FROM information_schema.columns
		WHERE table_schema = ? AND table_name = ?
		ORDER BY ordinal_position
	`
	
	rows, err := b.DB.QueryContext(ctx, query, schema, table)
	if err != nil {
		return nil, fmt.Errorf("failed to get schema: %w", err)
	}
	defer rows.Close()
	
	var fields []*FieldDefinition
	for rows.Next() {
		var f FieldDefinition
		var isNullable string
		var position int
		
		if err := rows.Scan(&f.Name, &f.DataType, &isNullable, &position); err != nil {
			continue
		}
		
		f.Nullable = isNullable == "YES"
		f.Position = position
		fields = append(fields, &f)
	}
	
	return &SchemaResult{Fields: fields}, nil
}

// GetStatistics returns lightweight statistics (generic - uses COUNT).
func (b *Base) GetStatistics(ctx context.Context, datasetID string, filter map[string]interface{}) (map[string]interface{}, error) {
	parts := strings.SplitN(datasetID, ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid dataset_id format")
	}
	schema, table := parts[0], parts[1]
	
	// Fallback to COUNT(*) - slow but universal
	query := fmt.Sprintf("SELECT COUNT(*) FROM %s.%s", schema, table)
	
	var rowCount int64
	b.DB.QueryRowContext(ctx, query).Scan(&rowCount)
	
	return map[string]interface{}{
		"row_count": rowCount,
	}, nil
}

// Read streams records from a dataset.
func (b *Base) Read(ctx context.Context, datasetID string, limit int64, onRecord func(map[string]interface{}) error) error {
	parts := strings.SplitN(datasetID, ".", 2)
	if len(parts) != 2 {
		return fmt.Errorf("invalid dataset_id format")
	}
	schema, table := parts[0], parts[1]
	
	query := fmt.Sprintf("SELECT * FROM %s.%s", schema, table)
	if limit > 0 {
		query += fmt.Sprintf(" LIMIT %d", limit)
	}
	
	rows, err := b.DB.QueryContext(ctx, query)
	if err != nil {
		return fmt.Errorf("read query failed: %w", err)
	}
	defer rows.Close()
	
	cols, err := rows.Columns()
	if err != nil {
		return fmt.Errorf("failed to get columns: %w", err)
	}
	
	for rows.Next() {
		values := make([]interface{}, len(cols))
		valuePtrs := make([]interface{}, len(cols))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		
		if err := rows.Scan(valuePtrs...); err != nil {
			return fmt.Errorf("scan failed: %w", err)
		}
		
		record := make(map[string]interface{})
		for i, col := range cols {
			record[col] = values[i]
		}
		
		if err := onRecord(record); err != nil {
			return err
		}
	}
	
	return rows.Err()
}

// ReadSlice reads records within a bounded slice.
func (b *Base) ReadSlice(ctx context.Context, datasetID string, slice *IngestionSlice, onRecord func(map[string]interface{}) error) error {
	parts := strings.SplitN(datasetID, ".", 2)
	if len(parts) != 2 {
		return fmt.Errorf("invalid dataset_id format")
	}
	schema, table := parts[0], parts[1]
	
	query := fmt.Sprintf("SELECT * FROM %s.%s", schema, table)
	var args []interface{}
	
	if slice != nil {
		// Get incremental column from params if specified
		column := "id" // default
		if col, ok := slice.Params["incremental_column"].(string); ok {
			column = col
		}
		
		if slice.Lower != "" && slice.Upper != "" {
			query += fmt.Sprintf(" WHERE %s >= ? AND %s <= ?", column, column)
			args = append(args, slice.Lower, slice.Upper)
		} else if slice.Lower != "" {
			query += fmt.Sprintf(" WHERE %s >= ?", column)
			args = append(args, slice.Lower)
		} else if slice.Upper != "" {
			query += fmt.Sprintf(" WHERE %s <= ?", column)
			args = append(args, slice.Upper)
		}
	}
	
	rows, err := b.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("read slice query failed: %w", err)
	}
	defer rows.Close()
	
	cols, err := rows.Columns()
	if err != nil {
		return fmt.Errorf("failed to get columns: %w", err)
	}
	
	for rows.Next() {
		values := make([]interface{}, len(cols))
		valuePtrs := make([]interface{}, len(cols))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		
		if err := rows.Scan(valuePtrs...); err != nil {
			return fmt.Errorf("scan failed: %w", err)
		}
		
		record := make(map[string]interface{})
		for i, col := range cols {
			record[col] = values[i]
		}
		
		if err := onRecord(record); err != nil {
			return err
		}
	}
	
	return rows.Err()
}

// CountBetween returns the row count between bounds.
func (b *Base) CountBetween(ctx context.Context, datasetID string, lower, upper string) (int64, error) {
	parts := strings.SplitN(datasetID, ".", 2)
	if len(parts) != 2 {
		return 0, fmt.Errorf("invalid dataset_id format")
	}
	schema, table := parts[0], parts[1]
	
	// Default to counting with incremental_column = id
	// In practice, the column should come from dataset metadata
	query := fmt.Sprintf("SELECT COUNT(*) FROM %s.%s", schema, table)
	var args []interface{}
	
	if lower != "" && upper != "" {
		query += " WHERE id >= ? AND id <= ?"
		args = append(args, lower, upper)
	} else if lower != "" {
		query += " WHERE id >= ?"
		args = append(args, lower)
	} else if upper != "" {
		query += " WHERE id <= ?"
		args = append(args, upper)
	}
	
	var count int64
	if err := b.DB.QueryRowContext(ctx, query, args...).Scan(&count); err != nil {
		return 0, fmt.Errorf("count between query failed: %w", err)
	}
	
	return count, nil
}

// PlanIncrementalSlices creates an ingestion plan for sliced reads.
func (b *Base) PlanIncrementalSlices(ctx context.Context, dataset *DatasetItem, checkpoint *Checkpoint, targetSliceSize int64) (*IngestionPlan, error) {
	if dataset == nil {
		return nil, fmt.Errorf("dataset required")
	}
	
	plan := &IngestionPlan{
		DatasetID:  dataset.ID,
		Strategy:   "adaptive",
		Statistics: make(map[string]interface{}),
	}
	
	// If no incremental column, return single full slice
	if dataset.IncrementalColumn == "" {
		plan.Strategy = "full"
		plan.Slices = []*IngestionSlice{{
			SliceID:  "full",
			Sequence: 0,
		}}
		return plan, nil
	}
	
	// Get bounds
	parts := strings.SplitN(dataset.ID, ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid dataset_id format")
	}
	schema, table := parts[0], parts[1]
	column := dataset.IncrementalColumn
	
	// Find min/max for slicing
	var minVal, maxVal sql.NullString
	bounds := fmt.Sprintf("SELECT MIN(%s), MAX(%s) FROM %s.%s", column, column, schema, table)
	if checkpoint != nil && checkpoint.Watermark != "" {
		bounds = fmt.Sprintf("SELECT MIN(%s), MAX(%s) FROM %s.%s WHERE %s > '%s'",
			column, column, schema, table, column, checkpoint.Watermark)
	}
	
	if err := b.DB.QueryRowContext(ctx, bounds).Scan(&minVal, &maxVal); err != nil {
		return nil, fmt.Errorf("failed to get bounds: %w", err)
	}
	
	if !minVal.Valid || !maxVal.Valid {
		// No data to process
		plan.Slices = []*IngestionSlice{}
		return plan, nil
	}
	
	plan.Statistics["min"] = minVal.String
	plan.Statistics["max"] = maxVal.String
	
	// Get total count
	totalCount, err := b.CountBetween(ctx, dataset.ID, minVal.String, maxVal.String)
	if err != nil {
		return nil, err
	}
	plan.Statistics["total_count"] = totalCount
	
	// If small enough, one slice
	if targetSliceSize <= 0 || totalCount <= targetSliceSize {
		plan.Slices = []*IngestionSlice{{
			SliceID:  "incremental-0",
			Sequence: 0,
			Lower:    minVal.String,
			Upper:    maxVal.String,
			Params: map[string]interface{}{
				"incremental_column": column,
			},
		}}
		return plan, nil
	}
	
	// For simplicity, create estimated slices based on count
	// A more sophisticated implementation would use NTILE or similar
	numSlices := int((totalCount + targetSliceSize - 1) / targetSliceSize)
	plan.Statistics["num_slices"] = numSlices
	
	// For now, return a single slice - vendor-specific connectors can override
	// with NTILE-based slicing for true adaptive behavior
	plan.Slices = []*IngestionSlice{{
		SliceID:  "incremental-0",
		Sequence: 0,
		Lower:    minVal.String,
		Upper:    maxVal.String,
		Params: map[string]interface{}{
			"incremental_column": column,
			"estimated_slices":   numSlices,
		},
	}}
	
	return plan, nil
}

// =============================================================================
// ENDPOINT INTERFACE ADAPTERS
// These methods implement endpoint.SourceEndpoint and endpoint.SliceCapable
// =============================================================================

// GetCapabilities implements endpoint.Endpoint.
// Returns capabilities using endpoint package types.
func (b *Base) GetCapabilities() *endpoint.Capabilities {
	return &endpoint.Capabilities{
		SupportsFull:        true,
		SupportsIncremental: true,
		SupportsCountProbe:  true,
		SupportsPreview:     true,
		SupportsMetadata:    true,
		DefaultFetchSize:    10000,
	}
}

// GetDescriptor implements endpoint.Endpoint.
func (b *Base) GetDescriptor() *endpoint.Descriptor {
	if b.Descriptor != nil {
		return b.Descriptor
	}
	// Return default descriptor
	return &endpoint.Descriptor{
		ID:          b.ID(),
		Family:      "JDBC",
		Title:       "Generic JDBC",
		Vendor:      "Generic",
		Description: "Generic JDBC database connector",
		Categories:  []string{"database", "sql"},
	}
}

// ValidateConfigEndpoint implements endpoint.Endpoint.ValidateConfig.
func (b *Base) ValidateConfigEndpoint(ctx context.Context, config map[string]any) (*endpoint.ValidationResult, error) {
	result, err := b.ValidateConfig(ctx)
	if err != nil {
		return nil, err
	}
	return &endpoint.ValidationResult{
		Valid:           result.Valid,
		Message:         result.Message,
		DetectedVersion: result.DetectedVersion,
	}, nil
}

// ListDatasetsEndpoint implements endpoint.SourceEndpoint.ListDatasets.
func (b *Base) ListDatasetsEndpoint(ctx context.Context) ([]*endpoint.Dataset, error) {
	items, err := b.ListDatasets(ctx)
	if err != nil {
		return nil, err
	}
	datasets := make([]*endpoint.Dataset, len(items))
	for i, item := range items {
		datasets[i] = &endpoint.Dataset{
			ID:                  item.ID,
			Name:                item.Name,
			Kind:                item.Kind,
			SupportsIncremental: item.SupportsIncremental,
			CdmModelID:          item.CdmModelID,
			IncrementalColumn:   item.IncrementalColumn,
			PrimaryKeys:         item.PrimaryKeys,
		}
	}
	return datasets, nil
}

// GetSchemaEndpoint implements endpoint.SourceEndpoint.GetSchema.
func (b *Base) GetSchemaEndpoint(ctx context.Context, datasetID string) (*endpoint.Schema, error) {
	result, err := b.GetSchema(ctx, datasetID)
	if err != nil {
		return nil, err
	}
	fields := make([]*endpoint.FieldDefinition, len(result.Fields))
	for i, f := range result.Fields {
		fields[i] = &endpoint.FieldDefinition{
			Name:      f.Name,
			DataType:  f.DataType,
			Nullable:  f.Nullable,
			Precision: f.Precision,
			Scale:     f.Scale,
			Length:    f.Length,
			Comment:   f.Comment,
			Position:  f.Position,
		}
	}
	return &endpoint.Schema{Fields: fields}, nil
}

// ReadEndpoint implements endpoint.SourceEndpoint.Read with iterator pattern.
func (b *Base) ReadEndpoint(ctx context.Context, req *endpoint.ReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	parts := strings.SplitN(req.DatasetID, ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid dataset_id format")
	}
	schema, table := parts[0], parts[1]

	query := fmt.Sprintf("SELECT * FROM %s.%s", schema, table)
	if req.Limit > 0 {
		query += fmt.Sprintf(" LIMIT %d", req.Limit)
	}

	rows, err := b.DB.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("read query failed: %w", err)
	}

	cols, err := rows.Columns()
	if err != nil {
		rows.Close()
		return nil, fmt.Errorf("failed to get columns: %w", err)
	}

	return &rowIterator{
		rows: rows,
		cols: cols,
	}, nil
}

// rowIterator wraps sql.Rows as endpoint.Iterator.
type rowIterator struct {
	rows    *sql.Rows
	cols    []string
	current endpoint.Record
	err     error
}

func (it *rowIterator) Next() bool {
	if !it.rows.Next() {
		it.err = it.rows.Err()
		return false
	}

	values := make([]interface{}, len(it.cols))
	valuePtrs := make([]interface{}, len(it.cols))
	for i := range values {
		valuePtrs[i] = &values[i]
	}

	if err := it.rows.Scan(valuePtrs...); err != nil {
		it.err = err
		return false
	}

	record := make(endpoint.Record)
	for i, col := range it.cols {
		record[col] = values[i]
	}
	it.current = record
	return true
}

func (it *rowIterator) Value() endpoint.Record { return it.current }
func (it *rowIterator) Err() error             { return it.err }
func (it *rowIterator) Close() error           { return it.rows.Close() }

// GetCheckpoint implements endpoint.IncrementalCapable.
func (b *Base) GetCheckpoint(ctx context.Context, datasetID string) (*endpoint.Checkpoint, error) {
	// JDBC base doesn't persist checkpoints - return nil (no checkpoint)
	return nil, nil
}

// PlanSlices implements endpoint.SliceCapable.
func (b *Base) PlanSlices(ctx context.Context, req *endpoint.PlanRequest) (*endpoint.IngestionPlan, error) {
	// Convert endpoint.PlanRequest to local types
	var checkpoint *Checkpoint
	if req.Checkpoint != nil {
		checkpoint = &Checkpoint{
			Watermark:      req.Checkpoint.Watermark,
			LastLoadedDate: req.Checkpoint.LastLoadedDate,
			Metadata:       req.Checkpoint.Metadata,
		}
	}
	
	dataset := &DatasetItem{
		ID:                req.DatasetID,
		SupportsIncremental: true,
	}
	
	plan, err := b.PlanIncrementalSlices(ctx, dataset, checkpoint, req.TargetSliceSize)
	if err != nil {
		return nil, err
	}
	
	slices := make([]*endpoint.IngestionSlice, len(plan.Slices))
	for i, s := range plan.Slices {
		slices[i] = &endpoint.IngestionSlice{
			SliceID:  s.SliceID,
			Sequence: s.Sequence,
			Lower:    s.Lower,
			Upper:    s.Upper,
			Params:   s.Params,
		}
	}
	
	return &endpoint.IngestionPlan{
		DatasetID:  plan.DatasetID,
		Strategy:   plan.Strategy,
		Slices:     slices,
		Statistics: plan.Statistics,
	}, nil
}

// ReadSliceEndpoint implements endpoint.SliceCapable.ReadSlice.
// Note: Returns an Iterator instead of callback-based approach.
func (b *Base) ReadSliceEndpoint(ctx context.Context, req *endpoint.SliceReadRequest) (endpoint.Iterator[endpoint.Record], error) {
	// For now, collect all records and return a slice iterator
	// TODO: Implement true streaming iterator
	var records []endpoint.Record
	
	var slice *IngestionSlice
	if req.Slice != nil {
		slice = &IngestionSlice{
			SliceID:  req.Slice.SliceID,
			Sequence: req.Slice.Sequence,
			Lower:    req.Slice.Lower,
			Upper:    req.Slice.Upper,
			Params:   req.Slice.Params,
		}
	}
	
	err := b.ReadSlice(ctx, req.DatasetID, slice, func(record map[string]interface{}) error {
		r := make(endpoint.Record)
		for k, v := range record {
			r[k] = v
		}
		records = append(records, r)
		return nil
	})
	if err != nil {
		return nil, err
	}
	
	return &sliceIterator{records: records, index: -1}, nil
}

// sliceIterator implements endpoint.Iterator for a slice of records.
type sliceIterator struct {
	records []endpoint.Record
	index   int
	err     error
}

func (it *sliceIterator) Next() bool {
	if it.index < len(it.records)-1 {
		it.index++
		return true
	}
	return false
}

func (it *sliceIterator) Value() endpoint.Record {
	if it.index >= 0 && it.index < len(it.records) {
		return it.records[it.index]
	}
	return nil
}

func (it *sliceIterator) Err() error {
	return it.err
}

func (it *sliceIterator) Close() error {
	it.records = nil
	return nil
}

