package confluence

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
	_ endpoint.RelationExtractor = (*ConfluenceRelationExtractor)(nil)
	_ endpoint.MentionExtractor  = (*ConfluenceMentionExtractor)(nil)
)

// ConfluenceRelationExtractor extracts explicit relations from Confluence content.
type ConfluenceRelationExtractor struct{}

// ExtractRelations extracts relationships from a Confluence content record.
// Extracts: CREATED_BY, UPDATED_BY, BELONGS_TO (space), CHILD_OF (parent page)
// P1 Fix: Infer content type from attachmentId presence.
// P2 Fix: Check both author and createdBy fields for creator.
func (e *ConfluenceRelationExtractor) ExtractRelations(ctx context.Context, payload endpoint.Record) []endpoint.Relation {
	var relations []endpoint.Relation

	// Get content ID and type - check attachmentId FIRST since attachment records
	// have both attachmentId AND pageId (parent page), prioritizing attachmentId
	var contentID, contentType string
	if attachmentID, _ := payload["attachmentId"].(string); attachmentID != "" {
		contentID = attachmentID
		contentType = "attachment"
	} else if pageID, _ := payload["pageId"].(string); pageID != "" {
		contentID = pageID
		contentType, _ = payload["contentType"].(string)
		if contentType == "" {
			contentType = "page"
		}
	}

	if contentID == "" {
		return relations
	}

	fromRef := "confluence." + contentType + ":" + contentID

	// BELONGS_TO space relation (from flattened spaceKey)
	if spaceKey, _ := payload["spaceKey"].(string); spaceKey != "" {
		relations = append(relations, endpoint.Relation{
			FromRef:    fromRef,
			ToRef:      "confluence.space:" + spaceKey,
			Type:       "BELONGS_TO",
			Direction:  endpoint.RelationForward,
			Explicit:   true,
			Confidence: 1.0,
		})
	}

	// CREATED_BY relation - check both author (pages) and createdBy (attachments)
	// P2 Fix: Attachments use "createdBy" field instead of "author"
	creator, _ := payload["author"].(string)
	if creator == "" {
		creator, _ = payload["createdBy"].(string)
	}
	if creator != "" {
		relations = append(relations, endpoint.Relation{
			FromRef:    fromRef,
			ToRef:      "confluence.user:" + creator,
			Type:       "CREATED_BY",
			Direction:  endpoint.RelationForward,
			Explicit:   true,
			Confidence: 1.0,
		})
	}

	// UPDATED_BY relation (from flattened updatedBy field)
	if updatedBy, _ := payload["updatedBy"].(string); updatedBy != "" {
		relations = append(relations, endpoint.Relation{
			FromRef:    fromRef,
			ToRef:      "confluence.user:" + updatedBy,
			Type:       "UPDATED_BY",
			Direction:  endpoint.RelationForward,
			Explicit:   true,
			Confidence: 1.0,
		})
	}

	// Try to get richer data from _raw Content (value, not pointer)
	raw, ok := payload["_raw"].(Content)
	if ok {
		// CHILD_OF relations (parent pages via ancestors)
		for _, ancestor := range raw.Ancestors {
			if ancestor.ID != "" {
				relations = append(relations, endpoint.Relation{
					FromRef:   fromRef,
					ToRef:     "confluence.page:" + ancestor.ID,
					Type:      "CHILD_OF",
					Direction: endpoint.RelationForward,
					Properties: map[string]any{
						"parentTitle": ancestor.Title,
					},
					Explicit:   true,
					Confidence: 1.0,
				})
			}
		}

		// Upgrade CREATED_BY with AccountID if available
		if raw.History != nil && raw.History.CreatedBy != nil && raw.History.CreatedBy.AccountID != "" {
			// Replace display name with account ID for better matching
			for i, rel := range relations {
				if rel.Type == "CREATED_BY" {
					relations[i].ToRef = "confluence.user:" + raw.History.CreatedBy.AccountID
					relations[i].Properties = map[string]any{
						"displayName": raw.History.CreatedBy.DisplayName,
						"email":       raw.History.CreatedBy.Email,
					}
					break
				}
			}
		}
	}

	return relations
}

// ConfluenceMentionExtractor extracts entity mentions from Confluence content.
type ConfluenceMentionExtractor struct{}

// ExtractMentions extracts @mentions and page references from Confluence content.
func (e *ConfluenceMentionExtractor) ExtractMentions(ctx context.Context, payload endpoint.Record) []endpoint.Mention {
	var mentions []endpoint.Mention

	// Extract mentions from title
	if title, _ := payload["title"].(string); title != "" {
		mentions = append(mentions, extractConfluenceMentions(title)...)
	}

	// Description/body would need expanded API fields
	// For now, we extract from title and any available text

	return mentions
}

// extractConfluenceMentions extracts Confluence-specific mentions from text.
func extractConfluenceMentions(text string) []endpoint.Mention {
	var mentions []endpoint.Mention

	// Scan for @mentions and page links
	pos := 0
	for pos < len(text) {
		// Look for @mention pattern (Atlassian format: [~accountid:xxx])
		if pos < len(text) && text[pos] == '[' && pos+12 < len(text) && text[pos:pos+12] == "[~accountid:" {
			endBracket := strings.Index(text[pos:], "]")
			if endBracket > 12 {
				mentionText := text[pos : pos+endBracket+1]
				accountID := text[pos+12 : pos+endBracket]
				mentions = append(mentions, endpoint.Mention{
					Text:       mentionText,
					Type:       "person",
					EntityRef:  "confluence.user:" + accountID,
					Confidence: 1.0,
					Source:     "pattern",
					Offset:     pos,
					Length:     len(mentionText),
				})
				pos += endBracket + 1
				continue
			}
		}

		// Look for Jira issue references in Confluence pages
		if text[pos] >= 'A' && text[pos] <= 'Z' {
			key, keyLen := extractIssueKeyAt(text, pos)
			if key != "" {
				mentions = append(mentions, endpoint.Mention{
					Text:       key,
					Type:       "issue",
					EntityRef:  "jira.issue:" + key,
					Confidence: 1.0,
					Source:     "pattern",
					Offset:     pos,
					Length:     keyLen,
				})
				pos += keyLen
				continue
			}
		}

		pos++
	}

	return mentions
}

// extractIssueKeyAt tries to extract a Jira issue key at the given position.
// Shared pattern with Jira connector for cross-reference detection.
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

// registerDiscovery registers Confluence discovery interfaces.
func registerDiscovery() {
	reg := endpoint.DefaultDiscoveryRegistry()
	reg.RegisterRelationExtractor("http.confluence", &ConfluenceRelationExtractor{})
	reg.RegisterMentionExtractor("http.confluence", &ConfluenceMentionExtractor{})
}

// init registers Confluence discovery on package load.
func init() {
	registerDiscovery()
}
