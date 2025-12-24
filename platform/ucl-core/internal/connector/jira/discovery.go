package jira

import (
	"context"
	"strings"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// =============================================================================
// DISCOVERY INTERFACES - RelationExtractor & MentionExtractor
// Implements hybrid discovery model for Brain NER/EPP
// =============================================================================

// Ensure interface compliance
var (
	_ endpoint.RelationExtractor = (*JiraRelationExtractor)(nil)
	_ endpoint.MentionExtractor  = (*JiraMentionExtractor)(nil)
)

// JiraRelationExtractor extracts explicit relations from Jira issues.
type JiraRelationExtractor struct{}

// ExtractRelations extracts relationships from a Jira issue record.
// Extracts: ASSIGNED_TO, REPORTED_BY, BELONGS_TO (project)
func (e *JiraRelationExtractor) ExtractRelations(ctx context.Context, payload endpoint.Record) []endpoint.Relation {
	var relations []endpoint.Relation

	// Get issueKey as the source reference
	issueKey, _ := payload["issueKey"].(string)
	if issueKey == "" {
		return relations
	}
	fromRef := "jira.issue:" + issueKey

	// Get raw Issue for full data access
	raw, ok := payload["_raw"].(*Issue)
	if !ok || raw == nil {
		// Fallback to flattened fields
		if assignee, _ := payload["assignee"].(string); assignee != "" {
			relations = append(relations, endpoint.Relation{
				FromRef:    fromRef,
				ToRef:      "jira.user:" + assignee,
				Type:       "ASSIGNED_TO",
				Direction:  endpoint.RelationForward,
				Explicit:   true,
				Confidence: 1.0,
			})
		}
		if reporter, _ := payload["reporter"].(string); reporter != "" {
			relations = append(relations, endpoint.Relation{
				FromRef:    fromRef,
				ToRef:      "jira.user:" + reporter,
				Type:       "REPORTED_BY",
				Direction:  endpoint.RelationForward,
				Explicit:   true,
				Confidence: 1.0,
			})
		}
		if projectKey, _ := payload["projectKey"].(string); projectKey != "" {
			relations = append(relations, endpoint.Relation{
				FromRef:    fromRef,
				ToRef:      "jira.project:" + projectKey,
				Type:       "BELONGS_TO",
				Direction:  endpoint.RelationForward,
				Explicit:   true,
				Confidence: 1.0,
			})
		}
		return relations
	}

	fields := raw.Fields

	// ASSIGNED_TO relation
	if fields.Assignee != nil && fields.Assignee.AccountID != "" {
		relations = append(relations, endpoint.Relation{
			FromRef:   fromRef,
			ToRef:     "jira.user:" + fields.Assignee.AccountID,
			Type:      "ASSIGNED_TO",
			Direction: endpoint.RelationForward,
			Properties: map[string]any{
				"displayName": fields.Assignee.DisplayName,
				"email":       fields.Assignee.EmailAddress,
			},
			Explicit:   true,
			Confidence: 1.0,
		})
	}

	// REPORTED_BY relation
	if fields.Reporter != nil && fields.Reporter.AccountID != "" {
		relations = append(relations, endpoint.Relation{
			FromRef:   fromRef,
			ToRef:     "jira.user:" + fields.Reporter.AccountID,
			Type:      "REPORTED_BY",
			Direction: endpoint.RelationForward,
			Properties: map[string]any{
				"displayName": fields.Reporter.DisplayName,
				"email":       fields.Reporter.EmailAddress,
			},
			Explicit:   true,
			Confidence: 1.0,
		})
	}

	// BELONGS_TO project relation
	if fields.Project != nil && fields.Project.Key != "" {
		relations = append(relations, endpoint.Relation{
			FromRef:   fromRef,
			ToRef:     "jira.project:" + fields.Project.Key,
			Type:      "BELONGS_TO",
			Direction: endpoint.RelationForward,
			Properties: map[string]any{
				"projectName": fields.Project.Name,
				"projectId":   fields.Project.ID,
			},
			Explicit:   true,
			Confidence: 1.0,
		})
	}

	return relations
}

// JiraMentionExtractor extracts entity mentions from Jira issue content.
type JiraMentionExtractor struct{}

// ExtractMentions extracts @mentions and issue references from Jira content.
func (e *JiraMentionExtractor) ExtractMentions(ctx context.Context, payload endpoint.Record) []endpoint.Mention {
	var mentions []endpoint.Mention

	// Extract mentions from summary
	if summary, _ := payload["summary"].(string); summary != "" {
		mentions = append(mentions, extractJiraMentions(summary)...)
	}

	// Extract mentions from description
	// P2 Fix: Handle both _raw Issue and flattened description field
	raw, ok := payload["_raw"].(*Issue)
	if ok && raw != nil && raw.Fields.Description != nil {
		if descStr, ok := raw.Fields.Description.(string); ok {
			mentions = append(mentions, extractJiraMentions(descStr)...)
		}
	} else {
		// Fallback to flattened description field
		if desc, _ := payload["description"].(string); desc != "" {
			mentions = append(mentions, extractJiraMentions(desc)...)
		}
	}

	return mentions
}
// extractJiraMentions extracts Jira-specific mentions from text.
// P2 Fix: Use character scanning to find issue keys even in comma-separated lists.
func extractJiraMentions(text string) []endpoint.Mention {
	var mentions []endpoint.Mention

	// Scan for issue keys by character position (handles "ABC-1,DEF-2" cases)
	// P2 Fix: Scan character-by-character to find all issue keys regardless of punctuation
	pos := 0
	for pos < len(text) {
		// Look for potential issue key start: uppercase letter
		if text[pos] >= 'A' && text[pos] <= 'Z' {
			// Try to extract an issue key starting here
			keyStart := pos
			key, keyLen := extractIssueKeyAt(text, pos)
			if key != "" {
				mentions = append(mentions, endpoint.Mention{
					Text:       key,
					Type:       "issue",
					EntityRef:  "jira.issue:" + key,
					Confidence: 1.0,
					Source:     "pattern",
					Offset:     keyStart,
					Length:     keyLen,
				})
				pos += keyLen
				continue
			}
		}

		// Look for @mention pattern [~accountid:xxx]
		if pos < len(text) && text[pos] == '[' && pos+12 < len(text) && text[pos:pos+12] == "[~accountid:" {
			// Find closing bracket
			endBracket := strings.Index(text[pos:], "]")
			if endBracket > 12 {
				mentionText := text[pos : pos+endBracket+1]
				accountID := text[pos+12 : pos+endBracket]
				mentions = append(mentions, endpoint.Mention{
					Text:       mentionText,
					Type:       "person",
					EntityRef:  "jira.user:" + accountID,
					Confidence: 1.0,
					Source:     "pattern",
					Offset:     pos,
					Length:     len(mentionText),
				})
				pos += endBracket + 1
				continue
			}
		}

		pos++
	}

	return mentions
}

// extractIssueKeyAt tries to extract a Jira issue key at the given position.
// Returns the key and its length, or empty string if no key found.
func extractIssueKeyAt(text string, start int) (string, int) {
	pos := start

	// Project part: must start with letter, allow alphanumeric
	if pos >= len(text) || text[pos] < 'A' || text[pos] > 'Z' {
		return "", 0
	}
	pos++

	// Continue with uppercase letters or digits
	for pos < len(text) && ((text[pos] >= 'A' && text[pos] <= 'Z') || (text[pos] >= '0' && text[pos] <= '9')) {
		pos++
	}

	// Need at least 2 chars for project
	if pos-start < 2 {
		return "", 0
	}

	// Must have dash
	if pos >= len(text) || text[pos] != '-' {
		return "", 0
	}
	pos++

	// Number part
	numStart := pos
	for pos < len(text) && text[pos] >= '0' && text[pos] <= '9' {
		pos++
	}

	// Need at least 1 digit
	if pos-numStart < 1 {
		return "", 0
	}

	return text[start:pos], pos - start
}

// isIssueKey checks if a string looks like a Jira issue key (e.g., PROJ-123, ABC1-456).
// P2 Fix: Accept uppercase alphanumeric project keys (must start with letter).
func isIssueKey(s string) bool {
	dashIdx := strings.Index(s, "-")
	if dashIdx < 1 || dashIdx >= len(s)-1 {
		return false
	}
	// Project part: must start with letter, followed by uppercase letters/digits
	project := s[:dashIdx]
	if len(project) < 2 {
		return false
	}
	// First character must be uppercase letter
	if project[0] < 'A' || project[0] > 'Z' {
		return false
	}
	// Rest can be uppercase letters or digits
	for _, c := range project[1:] {
		if !((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
			return false
		}
	}
	// Number part must be digits
	number := s[dashIdx+1:]
	for _, c := range number {
		if c < '0' || c > '9' {
			return false
		}
	}
	return len(number) >= 1
}

// registerDiscovery registers Jira discovery interfaces.
// P2 Fix: Use "http.jira" to match endpoint registry ID.
func registerDiscovery() {
	reg := endpoint.DefaultDiscoveryRegistry()
	reg.RegisterRelationExtractor("http.jira", &JiraRelationExtractor{})
	reg.RegisterMentionExtractor("http.jira", &JiraMentionExtractor{})
}

// init registers Jira discovery on package load.
func init() {
	registerDiscovery()
}
