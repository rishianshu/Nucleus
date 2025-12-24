package github

import (
	"context"

	"github.com/nucleus/ucl-core/internal/endpoint"
)

// =============================================================================
// DISCOVERY INTERFACES - RelationExtractor & MentionExtractor
// Implements hybrid discovery model for Brain NER/EPP
// =============================================================================

// Ensure interface compliance
var (
	_ endpoint.RelationExtractor = (*GitHubRelationExtractor)(nil)
	_ endpoint.MentionExtractor  = (*GitHubMentionExtractor)(nil)
)

// GitHubRelationExtractor extracts explicit relations from GitHub content.
type GitHubRelationExtractor struct{}

// ExtractRelations extracts relationships from a GitHub record.
// Supports: issues, pull_requests, commits, comments, reviews
// Relations: AUTHORED_BY, ASSIGNED_TO, MERGED_BY, BELONGS_TO (repo)
func (e *GitHubRelationExtractor) ExtractRelations(ctx context.Context, payload endpoint.Record) []endpoint.Relation {
	var relations []endpoint.Relation

	// Determine content type and ID from available fields
	var contentID, contentType, fromRef string

	if issueID, _ := payload["issueId"].(string); issueID != "" {
		contentID = issueID
		contentType = "issue"
	} else if prID, _ := payload["prId"].(string); prID != "" {
		contentID = prID
		contentType = "pull_request"
	} else if sha, _ := payload["sha"].(string); sha != "" {
		contentID = sha
		contentType = "commit"
	} else if commentId, _ := payload["commentId"].(string); commentId != "" {
		contentID = commentId
		contentType = "comment"
	} else if reviewId, _ := payload["reviewId"].(string); reviewId != "" {
		contentID = reviewId
		contentType = "review"
	}

	if contentID == "" {
		return relations
	}

	fromRef = "github." + contentType + ":" + contentID

	// BELONGS_TO repo relation
	if repo, _ := payload["repo"].(string); repo != "" {
		relations = append(relations, endpoint.Relation{
			FromRef:    fromRef,
			ToRef:      "github.repo:" + repo,
			Type:       "BELONGS_TO",
			Direction:  endpoint.RelationForward,
			Explicit:   true,
			Confidence: 1.0,
		})
	}

	// AUTHORED_BY relation
	if author, _ := payload["author"].(string); author != "" {
		relations = append(relations, endpoint.Relation{
			FromRef:    fromRef,
			ToRef:      "github.user:" + author,
			Type:       "AUTHORED_BY",
			Direction:  endpoint.RelationForward,
			Explicit:   true,
			Confidence: 1.0,
		})
	}

	// ASSIGNED_TO relations (can have multiple assignees)
	if assignees, ok := payload["assignees"].([]string); ok {
		for _, assignee := range assignees {
			if assignee != "" {
				relations = append(relations, endpoint.Relation{
					FromRef:    fromRef,
					ToRef:      "github.user:" + assignee,
					Type:       "ASSIGNED_TO",
					Direction:  endpoint.RelationForward,
					Explicit:   true,
					Confidence: 1.0,
				})
			}
		}
	}
	// Also check []any since JSON unmarshals to []any
	if assignees, ok := payload["assignees"].([]any); ok {
		for _, a := range assignees {
			if assignee, ok := a.(string); ok && assignee != "" {
				relations = append(relations, endpoint.Relation{
					FromRef:    fromRef,
					ToRef:      "github.user:" + assignee,
					Type:       "ASSIGNED_TO",
					Direction:  endpoint.RelationForward,
					Explicit:   true,
					Confidence: 1.0,
				})
			}
		}
	}

	// MERGED_BY relation (for PRs)
	if mergedBy, _ := payload["mergedBy"].(string); mergedBy != "" {
		relations = append(relations, endpoint.Relation{
			FromRef:    fromRef,
			ToRef:      "github.user:" + mergedBy,
			Type:       "MERGED_BY",
			Direction:  endpoint.RelationForward,
			Explicit:   true,
			Confidence: 1.0,
		})
	}

	// REVIEWED_BY relation (for reviews)
	if reviewer, _ := payload["reviewer"].(string); reviewer != "" {
		relations = append(relations, endpoint.Relation{
			FromRef:    fromRef,
			ToRef:      "github.user:" + reviewer,
			Type:       "REVIEWED_BY",
			Direction:  endpoint.RelationForward,
			Explicit:   true,
			Confidence: 1.0,
		})
	}

	return relations
}

// GitHubMentionExtractor extracts entity mentions from GitHub content.
type GitHubMentionExtractor struct{}

// ExtractMentions extracts @mentions and issue/PR references from GitHub content.
func (e *GitHubMentionExtractor) ExtractMentions(ctx context.Context, payload endpoint.Record) []endpoint.Mention {
	var mentions []endpoint.Mention

	// Extract from title
	if title, _ := payload["title"].(string); title != "" {
		mentions = append(mentions, extractGitHubMentions(title)...)
	}

	// Extract from body
	if body, _ := payload["body"].(string); body != "" {
		mentions = append(mentions, extractGitHubMentions(body)...)
	}

	// Extract from commit message
	if message, _ := payload["message"].(string); message != "" {
		mentions = append(mentions, extractGitHubMentions(message)...)
	}

	return mentions
}

// extractGitHubMentions extracts GitHub-specific mentions from text.
// Patterns: @username, #123 (issue/PR reference)
func extractGitHubMentions(text string) []endpoint.Mention {
	var mentions []endpoint.Mention

	pos := 0
	for pos < len(text) {
		// Look for @mentions
		if text[pos] == '@' && pos+1 < len(text) {
			// Extract username (alphanumeric + hyphen)
			start := pos + 1
			end := start
			for end < len(text) && isGitHubUsernameChar(text[end]) {
				end++
			}
			if end > start {
				username := text[start:end]
				mentions = append(mentions, endpoint.Mention{
					Text:       "@" + username,
					Type:       "person",
					EntityRef:  "github.user:" + username,
					Confidence: 1.0,
					Source:     "pattern",
					Offset:     pos,
					Length:     end - pos,
				})
				pos = end
				continue
			}
		}

		// Look for issue/PR references: #123
		if text[pos] == '#' && pos+1 < len(text) && text[pos+1] >= '0' && text[pos+1] <= '9' {
			// Simple #123 reference
			start := pos + 1
			end := start
			for end < len(text) && text[end] >= '0' && text[end] <= '9' {
				end++
			}
			if end > start {
				number := text[start:end]
				mentions = append(mentions, endpoint.Mention{
					Text:       "#" + number,
					Type:       "issue",
					EntityRef:  "github.issue:#" + number, // Relative reference
					Confidence: 0.9, // Slightly lower - repo context needed
					Source:     "pattern",
					Offset:     pos,
					Length:     end - pos,
				})
				pos = end
				continue
			}
		}

		pos++
	}

	return mentions
}

// isGitHubUsernameChar checks if a character is valid in a GitHub username.
func isGitHubUsernameChar(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
		(c >= '0' && c <= '9') || c == '-'
}

// registerDiscovery registers GitHub discovery interfaces.
func registerDiscovery() {
	reg := endpoint.DefaultDiscoveryRegistry()
	reg.RegisterRelationExtractor("http.github", &GitHubRelationExtractor{})
	reg.RegisterMentionExtractor("http.github", &GitHubMentionExtractor{})
}

// init registers GitHub discovery on package load.
func init() {
	registerDiscovery()
}
