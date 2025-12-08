// Package jira implements a Jira Cloud connector using the UCL endpoint interfaces.
// It provides source capabilities for extracting projects, issues, users, comments, and worklogs.
//
// CDM Mappings:
//   - jira.projects → cdm.work.project
//   - jira.users    → cdm.work.user
//   - jira.issues   → cdm.work.item
//   - jira.comments → cdm.work.comment
//   - jira.worklogs → cdm.work.worklog
package jira
