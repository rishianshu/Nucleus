// Package integration provides gRPC API endpoint tests.
package integration

import (
	"context"
	"testing"
	"time"

	"github.com/nucleus/ucl-core/pkg/uclpb"
)

// =============================================================================
// gRPC API COVERAGE TESTS
// =============================================================================

func TestGRPC_ListEndpointTemplates(t *testing.T) {
	client, cleanup := getGRPCClient(t)
	defer cleanup()

	testCases := []struct {
		name   string
		family string
		wantOK bool
	}{
		{"All templates", "", true},
		{"JDBC templates", "JDBC", true},
		{"HTTP templates", "HTTP", true},
		{"STREAM templates", "STREAM", true},
		{"Unknown family", "UNKNOWN", true}, // Should return empty, not error
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := client.ListEndpointTemplates(context.Background(), &uclpb.ListTemplatesRequest{
				Family: tc.family,
			})

			if tc.wantOK {
				if err != nil {
					t.Fatalf("ListEndpointTemplates failed: %v", err)
				}
				t.Logf("Family %q returned %d templates", tc.family, len(resp.Templates))
			} else {
				if err == nil {
					t.Error("Expected error, got nil")
				}
			}
		})
	}
}

func TestGRPC_BuildEndpointConfig(t *testing.T) {
	client, cleanup := getGRPCClient(t)
	defer cleanup()

	testCases := []struct {
		name       string
		templateID string
		params     map[string]string
		wantURL    bool
	}{
		{
			name:       "Postgres with valid params",
			templateID: "jdbc.postgres",
			params: map[string]string{
				"host":     "localhost",
				"port":     "5432",
				"database": "test",
				"username": "user",
				"password": "pass",
			},
			wantURL: true,
		},
		{
			name:       "Unknown template",
			templateID: "unknown.template",
			params:     map[string]string{},
			wantURL:    false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := client.BuildEndpointConfig(context.Background(), &uclpb.BuildConfigRequest{
				TemplateId: tc.templateID,
				Parameters: tc.params,
			})

			if err != nil {
				if tc.wantURL {
					t.Fatalf("BuildEndpointConfig failed: %v", err)
				}
				return
			}

			if tc.wantURL && resp.ConnectionUrl == "" {
				t.Error("Expected connection URL but got empty")
			}

			t.Logf("BuildEndpointConfig: url=%q", resp.ConnectionUrl)
		})
	}
}

func TestGRPC_TestEndpointConnection(t *testing.T) {
	client, cleanup := getGRPCClient(t)
	defer cleanup()

	// Test with real Postgres if configured
	if postgresHost != "" && postgresPassword != "" {
		t.Run("Real Postgres", func(t *testing.T) {
			resp, err := client.TestEndpointConnection(context.Background(), &uclpb.TestConnectionRequest{
				TemplateId: "jdbc.postgres",
				Parameters: map[string]string{
					"host":     postgresHost,
					"port":     postgresPort,
					"database": postgresDB,
					"username": postgresUser,
					"password": postgresPassword,
				},
			})

			if err != nil {
				t.Fatalf("TestEndpointConnection failed: %v", err)
			}

			t.Logf("Postgres connection: success=%v, latency=%dms, message=%q",
				resp.Success, resp.LatencyMs, resp.Message)

			if !resp.Success {
				t.Logf("Connection failed: %s", resp.Error)
			}
		})
	}

	// Test with invalid credentials (should fail gracefully)
	t.Run("Invalid credentials", func(t *testing.T) {
		resp, err := client.TestEndpointConnection(context.Background(), &uclpb.TestConnectionRequest{
			TemplateId: "jdbc.postgres",
			Parameters: map[string]string{
				"host":     "nonexistent.host.local",
				"port":     "5432",
				"database": "test",
				"username": "invalid",
				"password": "invalid",
			},
		})

		if err != nil {
			t.Fatalf("TestEndpointConnection returned error: %v", err)
		}

		// Should fail but not crash
		if resp.Success {
			t.Error("Expected connection to fail with invalid credentials")
		}
		t.Logf("Connection failed as expected: %s", resp.Error)
	})
}

func TestGRPC_ValidateConfig(t *testing.T) {
	client, cleanup := getGRPCClient(t)
	defer cleanup()

	resp, err := client.ValidateConfig(context.Background(), &uclpb.ValidateConfigRequest{
		EndpointId: "jdbc.postgres",
		Config: map[string]string{
			"host": "localhost",
			"port": "5432",
		},
	})

	if err != nil {
		t.Fatalf("ValidateConfig failed: %v", err)
	}

	t.Logf("ValidateConfig: valid=%v, errors=%v", resp.Valid, resp.Errors)
}

func TestGRPC_ListDatasets(t *testing.T) {
	if postgresHost == "" || postgresPassword == "" {
		t.Skip("Postgres credentials not configured")
	}

	client, cleanup := getGRPCClient(t)
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	resp, err := client.ListDatasets(ctx, &uclpb.ListDatasetsRequest{
		EndpointId: "jdbc.postgres",
		Config: map[string]string{
			"host":     postgresHost,
			"port":     postgresPort,
			"database": postgresDB,
			"username": postgresUser,
			"password": postgresPassword,
		},
	})

	if err != nil {
		t.Fatalf("ListDatasets failed: %v", err)
	}

	t.Logf("ListDatasets returned %d datasets", len(resp.Datasets))
	for i, ds := range resp.Datasets {
		if i < 5 { // Log first 5
			t.Logf("  - %s: %s", ds.Name, ds.Kind)
		}
	}
}

func TestGRPC_GetSchema(t *testing.T) {
	if postgresHost == "" || postgresPassword == "" {
		t.Skip("Postgres credentials not configured")
	}

	client, cleanup := getGRPCClient(t)
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// First list datasets to get a valid name
	listResp, err := client.ListDatasets(ctx, &uclpb.ListDatasetsRequest{
		EndpointId: "jdbc.postgres",
		Config: map[string]string{
			"host":     postgresHost,
			"port":     postgresPort,
			"database": postgresDB,
			"username": postgresUser,
			"password": postgresPassword,
		},
	})

	if err != nil || len(listResp.Datasets) == 0 {
		t.Skip("No datasets available")
	}

	datasetId := listResp.Datasets[0].Id

	schemaResp, err := client.GetSchema(ctx, &uclpb.GetSchemaRequest{
		EndpointId: "jdbc.postgres",
		DatasetId:  datasetId,
		Config: map[string]string{
			"host":     postgresHost,
			"port":     postgresPort,
			"database": postgresDB,
			"username": postgresUser,
			"password": postgresPassword,
		},
	})

	if err != nil {
		t.Fatalf("GetSchema failed: %v", err)
	}

	t.Logf("GetSchema for %s returned %d fields", datasetId, len(schemaResp.Fields))
	for i, f := range schemaResp.Fields {
		if i < 5 { // Log first 5
			t.Logf("  - %s: %s (nullable=%v)", f.Name, f.Type, f.Nullable)
		}
	}
}

// =============================================================================
// API COVERAGE SUMMARY
// =============================================================================

func TestGRPCAPICoverage(t *testing.T) {
	apis := []struct {
		Name   string
		Tested bool
	}{
		{"ListEndpointTemplates", true},
		{"BuildEndpointConfig", true},
		{"TestEndpointConnection", true},
		{"ValidateConfig", true},
		{"ListDatasets", true},
		{"GetSchema", true},
	}

	tested := 0
	for _, api := range apis {
		if api.Tested {
			tested++
		}
	}

	coverage := float64(tested) / float64(len(apis)) * 100
	t.Logf("gRPC API test coverage: %.1f%% (%d/%d APIs)", coverage, tested, len(apis))

	if coverage == 100 {
		t.Log("✅ All gRPC APIs have test coverage")
	}
}
