// Package http provides a generic HTTP base connector for REST API sources.
// This serves as the foundation for connectors like Jira, Confluence, OneDrive, etc.
//
// Structure:
//
//	client.go     - HTTP client with rate limiting and retry
//	auth.go       - Authentication strategies (Basic, Bearer, OAuth)
//	paginator.go  - Pagination helpers (cursor, offset, link-based)
//	response.go   - Response parsing and error handling
package http
