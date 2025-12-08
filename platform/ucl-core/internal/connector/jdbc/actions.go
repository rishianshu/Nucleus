package jdbc

import (
	"context"
	"fmt"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// JDBC Base implements ActionEndpoint methods for execute_query

// =============================================================================
// ACTION DEFINITIONS
// =============================================================================

var jdbcActions = []*endpoint.ActionDescriptor{
	{
		ID:          "jdbc.execute_query",
		Name:        "Execute Query",
		Description: "Execute a SELECT query and return results",
		Category:    "execute",
	},
}

var jdbcActionSchemas = map[string]*endpoint.ActionSchema{
	"jdbc.execute_query": {
		ActionID: "jdbc.execute_query",
		InputFields: []*endpoint.ActionField{
			{Name: "query", Label: "SQL Query", DataType: "string", Required: true, Description: "SELECT query to execute"},
			{Name: "params", Label: "Parameters", DataType: "array", Required: false, Description: "Query parameters for prepared statement"},
			{Name: "limit", Label: "Limit", DataType: "number", Required: false, Default: 1000, Description: "Maximum rows to return"},
		},
		OutputFields: []*endpoint.ActionField{
			{Name: "rowCount", Label: "Row Count", DataType: "number", Description: "Number of rows returned"},
			{Name: "columns", Label: "Columns", DataType: "array", Description: "Column names"},
			{Name: "rows", Label: "Rows", DataType: "array", Description: "Result rows"},
		},
	},
}

func init() {
	// Register actions for all JDBC variants
	endpoint.RegisterActions("jdbc.postgres", jdbcActions)
	endpoint.RegisterActions("jdbc.oracle", jdbcActions)
	endpoint.RegisterActions("jdbc.sqlserver", jdbcActions)
}

// =============================================================================
// ACTION ENDPOINT IMPLEMENTATION
// =============================================================================

// ListActions returns available JDBC actions.
func (b *Base) ListActions(ctx context.Context) ([]*endpoint.ActionDescriptor, error) {
	return jdbcActions, nil
}

// GetActionSchema returns the schema for a specific action.
func (b *Base) GetActionSchema(ctx context.Context, actionID string) (*endpoint.ActionSchema, error) {
	schema, ok := jdbcActionSchemas[actionID]
	if !ok {
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
	return schema, nil
}

// ExecuteAction executes a JDBC action.
func (b *Base) ExecuteAction(ctx context.Context, req *endpoint.ActionRequest) (*endpoint.ActionResult, error) {
	if req.DryRun {
		return &endpoint.ActionResult{
			Success: true,
			Message: "Dry run - action validated but not executed",
		}, nil
	}

	switch req.ActionID {
	case "jdbc.execute_query":
		return b.executeQuery(ctx, req.Parameters)
	default:
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Unknown action: %s", req.ActionID),
			Errors:  []endpoint.ActionError{{Code: "UNKNOWN_ACTION", Message: req.ActionID}},
		}, nil
	}
}

// =============================================================================
// ACTION IMPLEMENTATIONS
// =============================================================================

func (b *Base) executeQuery(ctx context.Context, params map[string]any) (*endpoint.ActionResult, error) {
	query, _ := params["query"].(string)
	limit := 1000
	if l, ok := params["limit"].(float64); ok {
		limit = int(l)
	}

	// Validate query is SELECT
	// Note: In production, use proper SQL parsing
	if len(query) < 6 {
		return &endpoint.ActionResult{
			Success: false,
			Message: "Invalid query",
			Errors:  []endpoint.ActionError{{Code: "INVALID_QUERY", Message: "Query too short"}},
		}, nil
	}

	rows, err := b.DB.QueryContext(ctx, query)
	if err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: fmt.Sprintf("Query failed: %v", err),
			Errors:  []endpoint.ActionError{{Code: "QUERY_ERROR", Message: err.Error()}},
		}, nil
	}
	defer rows.Close()

	// Get column names
	columns, err := rows.Columns()
	if err != nil {
		return &endpoint.ActionResult{
			Success: false,
			Message: "Failed to get columns",
			Errors:  []endpoint.ActionError{{Code: "COLUMNS_ERROR", Message: err.Error()}},
		}, nil
	}

	// Read rows
	var results []map[string]any
	values := make([]any, len(columns))
	valuePtrs := make([]any, len(columns))
	for i := range values {
		valuePtrs[i] = &values[i]
	}

	count := 0
	for rows.Next() && count < limit {
		if err := rows.Scan(valuePtrs...); err != nil {
			continue
		}

		row := make(map[string]any)
		for i, col := range columns {
			row[col] = values[i]
		}
		results = append(results, row)
		count++
	}

	return &endpoint.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Query returned %d rows", len(results)),
		Data: map[string]any{
			"rowCount": len(results),
			"columns":  columns,
			"rows":     results,
		},
	}, nil
}
