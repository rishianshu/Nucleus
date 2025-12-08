package jdbc

import (
	"context"
	"fmt"
	"strings"
)

// MSSQL extends Base with SQL Server-specific handling.
type MSSQL struct {
	*Base
}

// NewMSSQL creates a SQL Server connector.
func NewMSSQL(config map[string]interface{}) (*MSSQL, error) {
	// Force driver to sqlserver
	config["driver"] = "sqlserver"
	
	base, err := NewBase(config)
	if err != nil {
		return nil, err
	}
	
	return &MSSQL{Base: base}, nil
}

// ID returns the connector template ID.
func (m *MSSQL) ID() string {
	return "jdbc.mssql"
}

// ValidateConfig tests connection with SQL Server version query.
func (m *MSSQL) ValidateConfig(ctx context.Context) (*ValidateResult, error) {
	result, err := m.Base.ValidateConfig(ctx)
	if err != nil || !result.Valid {
		return result, err
	}
	
	// Get SQL Server version
	var version string
	m.DB.QueryRowContext(ctx, "SELECT @@VERSION").Scan(&version)
	result.DetectedVersion = version
	
	return result, nil
}

// ListDatasets returns SQL Server tables/views.
func (m *MSSQL) ListDatasets(ctx context.Context) ([]*DatasetItem, error) {
	query := `
		SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
		FROM INFORMATION_SCHEMA.TABLES
		WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')
		ORDER BY TABLE_SCHEMA, TABLE_NAME
	`
	
	rows, err := m.DB.QueryContext(ctx, query)
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
		if tableType == "VIEW" {
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

// GetSchema returns SQL Server columns with metadata.
func (m *MSSQL) GetSchema(ctx context.Context, datasetID string) (*SchemaResult, error) {
	parts := strings.SplitN(datasetID, ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid dataset_id format")
	}
	schema, table := parts[0], parts[1]
	
	query := `
		SELECT 
			COLUMN_NAME,
			DATA_TYPE,
			IS_NULLABLE,
			ISNULL(NUMERIC_PRECISION, 0),
			ISNULL(NUMERIC_SCALE, 0),
			ISNULL(CHARACTER_MAXIMUM_LENGTH, 0),
			ISNULL(COLUMN_DEFAULT, ''),
			ORDINAL_POSITION
		FROM INFORMATION_SCHEMA.COLUMNS
		WHERE TABLE_SCHEMA = @p1 AND TABLE_NAME = @p2
		ORDER BY ORDINAL_POSITION
	`
	
	rows, err := m.DB.QueryContext(ctx, query, schema, table)
	if err != nil {
		return nil, fmt.Errorf("failed to get schema: %w", err)
	}
	defer rows.Close()
	
	var fields []*FieldDefinition
	for rows.Next() {
		var f FieldDefinition
		var nullable, defaultVal string
		var precision, scale, length, position int
		
		if err := rows.Scan(&f.Name, &f.DataType, &nullable, &precision, &scale, &length, &defaultVal, &position); err != nil {
			continue
		}
		
		f.Nullable = nullable == "YES"
		f.Precision = precision
		f.Scale = scale
		f.Length = length
		f.Position = position
		
		fields = append(fields, &f)
	}
	
	// Get row count from sys.partitions
	statsQuery := `
		SELECT SUM(rows)
		FROM sys.partitions
		WHERE object_id = OBJECT_ID(@p1 + '.' + @p2)
		AND index_id < 2
	`
	var stats DatasetStatistics
	m.DB.QueryRowContext(ctx, statsQuery, schema, table).Scan(&stats.RowCount)
	
	return &SchemaResult{
		Fields:     fields,
		Statistics: &stats,
	}, nil
}

// GetStatistics uses sys.partitions for fast row count.
func (m *MSSQL) GetStatistics(ctx context.Context, datasetID string, filter map[string]interface{}) (map[string]interface{}, error) {
	parts := strings.SplitN(datasetID, ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid dataset_id format")
	}
	schema, table := parts[0], parts[1]
	
	query := `
		SELECT ISNULL(SUM(rows), 0)
		FROM sys.partitions
		WHERE object_id = OBJECT_ID(@p1 + '.' + @p2)
		AND index_id < 2
	`
	
	var rowCount int64
	m.DB.QueryRowContext(ctx, query, schema, table).Scan(&rowCount)
	
	return map[string]interface{}{
		"row_count": rowCount,
	}, nil
}

// Read uses SQL Server TOP for limiting.
func (m *MSSQL) Read(ctx context.Context, datasetID string, limit int64, onRecord func(map[string]interface{}) error) error {
	parts := strings.SplitN(datasetID, ".", 2)
	if len(parts) != 2 {
		return fmt.Errorf("invalid dataset_id format")
	}
	schema, table := parts[0], parts[1]
	
	query := fmt.Sprintf("SELECT * FROM %s.%s", schema, table)
	if limit > 0 {
		query = fmt.Sprintf("SELECT TOP %d * FROM %s.%s", limit, schema, table)
	}
	
	rows, err := m.DB.QueryContext(ctx, query)
	if err != nil {
		return fmt.Errorf("read query failed: %w", err)
	}
	defer rows.Close()
	
	cols, _ := rows.Columns()
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
