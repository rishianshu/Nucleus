package jdbc

import (
	"context"
	"os"
	"testing"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// =============================================================================
// ACTION INTEGRATION TESTS
// =============================================================================

func TestJDBC_Action_Integration_ExecuteQuery(t *testing.T) {
	dbURL := os.Getenv("METADATA_DATABASE_URL")
	if dbURL == "" {
		t.Skip("METADATA_DATABASE_URL not set")
	}

	registry := endpoint.DefaultRegistry()
	
	ep, err := registry.Create("jdbc.postgres", map[string]any{
		"connectionString": dbURL,
	})
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()

	// Get the JDBC Base from the wrapper
	jdbcEp, ok := ep.(*jdbcEndpoint)
	if !ok {
		t.Fatal("Expected jdbcEndpoint type")
	}

	// List available actions
	actions, err := jdbcEp.Base.ListActions(ctx)
	if err != nil {
		t.Fatalf("ListActions failed: %v", err)
	}
	t.Logf("Available actions: %d", len(actions))
	for _, a := range actions {
		t.Logf("  [%s] %s - %s", a.Category, a.ID, a.Name)
	}

	// Get execute_query schema
	schema, err := jdbcEp.Base.GetActionSchema(ctx, "jdbc.execute_query")
	if err != nil {
		t.Fatalf("GetActionSchema failed: %v", err)
	}
	t.Logf("execute_query input fields: %d", len(schema.InputFields))
	for _, f := range schema.InputFields {
		required := ""
		if f.Required {
			required = " (required)"
		}
		t.Logf("  %s: %s%s", f.Name, f.DataType, required)
	}

	// Execute: Simple query
	result, err := jdbcEp.Base.ExecuteAction(ctx, &endpoint.ActionRequest{
		ActionID: "jdbc.execute_query",
		Parameters: map[string]any{
			"query": "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' LIMIT 10",
			"limit": 10,
		},
	})
	if err != nil {
		t.Fatalf("ExecuteAction failed: %v", err)
	}

	if !result.Success {
		t.Errorf("Query failed: %s, errors: %+v", result.Message, result.Errors)
		return
	}

	rowCount := result.Data["rowCount"].(int)
	columns := result.Data["columns"].([]string)

	t.Logf("✅ Query executed successfully")
	t.Logf("   Columns: %v", columns)
	t.Logf("   Rows returned: %d", rowCount)

	// Show sample rows
	if rows, ok := result.Data["rows"].([]map[string]any); ok && len(rows) > 0 {
		t.Logf("   Sample data:")
		for i, row := range rows {
			if i >= 3 {
				t.Logf("   ... and %d more rows", len(rows)-3)
				break
			}
			t.Logf("     %d: %v", i+1, row)
		}
	}
}

func TestJDBC_Action_Integration_CountQuery(t *testing.T) {
	dbURL := os.Getenv("METADATA_DATABASE_URL")
	if dbURL == "" {
		t.Skip("METADATA_DATABASE_URL not set")
	}

	registry := endpoint.DefaultRegistry()
	
	ep, err := registry.Create("jdbc.postgres", map[string]any{
		"connectionString": dbURL,
	})
	if err != nil {
		t.Fatalf("Failed to create endpoint: %v", err)
	}
	defer ep.Close()

	ctx := context.Background()
	jdbcEp := ep.(*jdbcEndpoint)

	// Execute: Count query
	result, err := jdbcEp.Base.ExecuteAction(ctx, &endpoint.ActionRequest{
		ActionID: "jdbc.execute_query",
		Parameters: map[string]any{
			"query": "SELECT COUNT(*) as total_tables FROM information_schema.tables WHERE table_schema = 'public'",
		},
	})
	if err != nil {
		t.Fatalf("ExecuteAction failed: %v", err)
	}

	if !result.Success {
		t.Errorf("Count query failed: %s", result.Message)
		return
	}

	t.Logf("✅ Count query executed: %s", result.Message)
	if rows, ok := result.Data["rows"].([]map[string]any); ok && len(rows) > 0 {
		t.Logf("   Result: %v", rows[0])
	}
}
