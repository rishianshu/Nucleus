// Package onedrive implements the OneDrive connector using Microsoft Graph API.
//
// This connector provides access to OneDrive files and folders using OAuth 2.0
// authentication with Microsoft Graph API.
//
// Features:
//   - List files and folders
//   - Read file metadata
//   - OAuth 2.0 token refresh
//   - Support for personal and business OneDrive
//
// Configuration:
//
//	{
//	    "clientId": "your-app-client-id",
//	    "clientSecret": "your-app-client-secret",
//	    "tenantId": "your-tenant-id",
//	    "refreshToken": "your-refresh-token"
//	}
package onedrive
