package jdbc

import (
	"context"
	"fmt"
	"strings"
)

// Oracle extends Base with Oracle-specific handling.
type Oracle struct {
	*Base
}

// NewOracle creates an Oracle connector.
func NewOracle(config map[string]interface{}) (*Oracle, error) {
	// Force driver to oracle/godror
	config["driver"] = "godror"
	
	base, err := NewBase(config)
	if err != nil {
		return nil, err
	}
	
	return &Oracle{Base: base}, nil
}

// ID returns the connector template ID.
func (o *Oracle) ID() string {
	return "jdbc.oracle"
}

// ValidateConfig tests connection with Oracle-specific version query.
func (o *Oracle) ValidateConfig(ctx context.Context) (*ValidateResult, error) {
	result, err := o.Base.ValidateConfig(ctx)
	if err != nil || !result.Valid {
		return result, err
	}
	
	// Get Oracle version
	var version string
	o.DB.QueryRowContext(ctx, "SELECT banner FROM v$version WHERE ROWNUM = 1").Scan(&version)
	result.DetectedVersion = version
	
	return result, nil
}

// ListDatasets returns Oracle tables/views (handles case sensitivity).
func (o *Oracle) ListDatasets(ctx context.Context) ([]*DatasetItem, error) {
	query := `
		SELECT owner, table_name, 'TABLE' AS table_type
		FROM all_tables
		WHERE owner NOT IN ('SYS', 'SYSTEM', 'OUTLN', 'XDB')
		UNION ALL
		SELECT owner, view_name, 'VIEW'
		FROM all_views
		WHERE owner NOT IN ('SYS', 'SYSTEM', 'OUTLN', 'XDB')
		ORDER BY 1, 2
	`
	
	rows, err := o.DB.QueryContext(ctx, query)
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

// GetSchema returns Oracle columns with NUMBER precision guardrails.
func (o *Oracle) GetSchema(ctx context.Context, datasetID string) (*SchemaResult, error) {
	parts := strings.SplitN(datasetID, ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid dataset_id format")
	}
	schema, table := parts[0], parts[1]
	
	// Oracle uses USER_TAB_COLUMNS / ALL_TAB_COLUMNS
	query := `
		SELECT 
			column_name,
			data_type,
			nullable,
			NVL(data_precision, 0),
			NVL(data_scale, 0),
			NVL(data_length, 0),
			column_id
		FROM all_tab_columns
		WHERE owner = :1 AND table_name = :2
		ORDER BY column_id
	`
	
	rows, err := o.DB.QueryContext(ctx, query, strings.ToUpper(schema), strings.ToUpper(table))
	if err != nil {
		return nil, fmt.Errorf("failed to get schema: %w", err)
	}
	defer rows.Close()
	
	var fields []*FieldDefinition
	for rows.Next() {
		var f FieldDefinition
		var nullable string
		var precision, scale, length, position int
		
		if err := rows.Scan(&f.Name, &f.DataType, &nullable, &precision, &scale, &length, &position); err != nil {
			continue
		}
		
		f.Nullable = nullable == "Y"
		f.Precision = precision
		f.Scale = scale
		f.Length = length
		f.Position = position
		
		// NUMBER guardrail: warn if precision > 38 or unspecified
		if f.DataType == "NUMBER" && (f.Precision == 0 || f.Precision > 38) {
			f.Comment = "GUARDRAIL: Unbounded NUMBER - consider casting"
		}
		
		fields = append(fields, &f)
	}
	
	// Get row count from USER_TABLES
	statsQuery := `
		SELECT NVL(num_rows, 0)
		FROM all_tables
		WHERE owner = :1 AND table_name = :2
	`
	var stats DatasetStatistics
	o.DB.QueryRowContext(ctx, statsQuery, strings.ToUpper(schema), strings.ToUpper(table)).Scan(&stats.RowCount)
	
	return &SchemaResult{
		Fields:     fields,
		Statistics: &stats,
	}, nil
}

// GetStatistics uses Oracle table statistics.
func (o *Oracle) GetStatistics(ctx context.Context, datasetID string, filter map[string]interface{}) (map[string]interface{}, error) {
	parts := strings.SplitN(datasetID, ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid dataset_id format")
	}
	schema, table := parts[0], parts[1]
	
	query := `
		SELECT NVL(num_rows, 0)
		FROM all_tables
		WHERE owner = :1 AND table_name = :2
	`
	
	var rowCount int64
	o.DB.QueryRowContext(ctx, query, strings.ToUpper(schema), strings.ToUpper(table)).Scan(&rowCount)
	
	return map[string]interface{}{
		"row_count": rowCount,
	}, nil
}

// Read handles Oracle-specific ROWNUM limit.
func (o *Oracle) Read(ctx context.Context, datasetID string, limit int64, onRecord func(map[string]interface{}) error) error {
	parts := strings.SplitN(datasetID, ".", 2)
	if len(parts) != 2 {
		return fmt.Errorf("invalid dataset_id format")
	}
	schema, table := parts[0], parts[1]
	
	query := fmt.Sprintf("SELECT * FROM %s.%s", schema, table)
	if limit > 0 {
		// Oracle uses ROWNUM or FETCH FIRST (12c+)
		query = fmt.Sprintf("SELECT * FROM %s.%s WHERE ROWNUM <= %d", schema, table, limit)
	}
	
	rows, err := o.DB.QueryContext(ctx, query)
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
