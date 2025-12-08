// Package connector registers all UCL connectors.
package connector

import (
	// Import all connectors to register them
	_ "github.com/nucleus/ucl-core/internal/connector/confluence"
	_ "github.com/nucleus/ucl-core/internal/connector/hdfs"
	_ "github.com/nucleus/ucl-core/internal/connector/jdbc"
	_ "github.com/nucleus/ucl-core/internal/connector/jira"
	_ "github.com/nucleus/ucl-core/internal/connector/onedrive"
)

// All imports trigger init() functions that register connectors.
