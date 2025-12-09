// Package graph provides additional GraphQL types for KB/Graph.
package graph

import (
	"encoding/json"
	"time"
)

// =============================================================================
// GRAPH SCOPE TYPES
// =============================================================================

// GraphScopeInput is input for scoping graph queries.
type GraphScopeInput struct {
	OrgID     *string `json:"orgId,omitempty"`
	DomainID  *string `json:"domainId,omitempty"`
	ProjectID *string `json:"projectId,omitempty"`
	TeamID    *string `json:"teamId,omitempty"`
}

// GraphEdgeDirection represents edge traversal direction.
type GraphEdgeDirection string

const (
	GraphEdgeDirectionOutbound GraphEdgeDirection = "OUTBOUND"
	GraphEdgeDirectionInbound  GraphEdgeDirection = "INBOUND"
	GraphEdgeDirectionBoth     GraphEdgeDirection = "BOTH"
)

// =============================================================================
// KB NODE TYPES
// =============================================================================

// KbGraphNode represents a KB graph node.
type KbGraphNode struct {
	ID            string          `json:"id"`
	TenantID      string          `json:"tenantId"`
	ProjectID     *string         `json:"projectId,omitempty"`
	EntityType    string          `json:"entityType"`
	DisplayName   string          `json:"displayName"`
	CanonicalPath *string         `json:"canonicalPath,omitempty"`
	SourceSystem  *string         `json:"sourceSystem,omitempty"`
	SpecRef       *string         `json:"specRef,omitempty"`
	Properties    json.RawMessage `json:"properties"`
	Version       int             `json:"version"`
	Phase         *string         `json:"phase,omitempty"`
	Scope         *GraphScope     `json:"scope,omitempty"`
	Identity      *GraphIdentity  `json:"identity,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// GraphScope represents a scope.
type GraphScope struct {
	OrgID     string  `json:"orgId"`
	DomainID  *string `json:"domainId,omitempty"`
	ProjectID *string `json:"projectId,omitempty"`
	TeamID    *string `json:"teamId,omitempty"`
}

// GraphIdentity represents identity info.
type GraphIdentity struct {
	LogicalKey       string          `json:"logicalKey"`
	ExternalID       json.RawMessage `json:"externalId,omitempty"`
	OriginEndpointID *string         `json:"originEndpointId,omitempty"`
	OriginVendor     *string         `json:"originVendor,omitempty"`
	Phase            *string         `json:"phase,omitempty"`
}

// KbNodeEdge is a connection edge for nodes.
type KbNodeEdge struct {
	Cursor string       `json:"cursor"`
	Node   *KbGraphNode `json:"node"`
}

// KbNodeConnection is a paginated list of nodes.
type KbNodeConnection struct {
	Edges      []*KbNodeEdge `json:"edges"`
	PageInfo   *PageInfo     `json:"pageInfo"`
	TotalCount int           `json:"totalCount"`
}

// =============================================================================
// KB EDGE TYPES
// =============================================================================

// KbGraphEdge represents a KB graph edge.
type KbGraphEdge struct {
	ID             string          `json:"id"`
	TenantID       string          `json:"tenantId"`
	ProjectID      *string         `json:"projectId,omitempty"`
	EdgeType       string          `json:"edgeType"`
	SourceEntityID string          `json:"sourceEntityId"`
	TargetEntityID string          `json:"targetEntityId"`
	Confidence     *float64        `json:"confidence,omitempty"`
	SpecRef        *string         `json:"specRef,omitempty"`
	Metadata       json.RawMessage `json:"metadata"`
	Scope          *GraphScope     `json:"scope,omitempty"`
	Identity       *GraphIdentity  `json:"identity,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

// KbEdgeEdge is a connection edge for edges.
type KbEdgeEdge struct {
	Cursor string       `json:"cursor"`
	Node   *KbGraphEdge `json:"node"`
}

// KbEdgeConnection is a paginated list of edges.
type KbEdgeConnection struct {
	Edges      []*KbEdgeEdge `json:"edges"`
	PageInfo   *PageInfo     `json:"pageInfo"`
	TotalCount int           `json:"totalCount"`
}

// =============================================================================
// KB SCENE TYPES
// =============================================================================

// KbScene represents a subgraph scene.
type KbScene struct {
	Nodes   []*KbGraphNode   `json:"nodes"`
	Edges   []*KbGraphEdge   `json:"edges"`
	Summary *KbSceneSummary  `json:"summary"`
}

// KbSceneSummary summarizes a scene.
type KbSceneSummary struct {
	NodeCount int  `json:"nodeCount"`
	EdgeCount int  `json:"edgeCount"`
	Truncated bool `json:"truncated"`
}

// =============================================================================
// KB FACET TYPES
// =============================================================================

// KbFacetValue represents a facet value with count.
type KbFacetValue struct {
	Value string `json:"value"`
	Label string `json:"label"`
	Count int    `json:"count"`
}

// KbFacets contains all facets.
type KbFacets struct {
	NodeTypes []*KbFacetValue `json:"nodeTypes"`
	EdgeTypes []*KbFacetValue `json:"edgeTypes"`
	Projects  []*KbFacetValue `json:"projects"`
	Domains   []*KbFacetValue `json:"domains"`
	Teams     []*KbFacetValue `json:"teams"`
}

// =============================================================================
// KB META TYPES
// =============================================================================

// KbNodeType describes a node type.
type KbNodeType struct {
	Value         string   `json:"value"`
	Label         string   `json:"label"`
	Description   *string  `json:"description,omitempty"`
	Synonyms      []string `json:"synonyms"`
	Icon          *string  `json:"icon,omitempty"`
	FieldsDisplay []string `json:"fieldsDisplay"`
	Actions       []string `json:"actions"`
}

// KbEdgeType describes an edge type.
type KbEdgeType struct {
	Value       string   `json:"value"`
	Label       string   `json:"label"`
	Description *string  `json:"description,omitempty"`
	Synonyms    []string `json:"synonyms"`
	Icon        *string  `json:"icon,omitempty"`
	Actions     []string `json:"actions"`
}

// KbMeta contains KB metadata.
type KbMeta struct {
	Version   string        `json:"version"`
	NodeTypes []*KbNodeType `json:"nodeTypes"`
	EdgeTypes []*KbEdgeType `json:"edgeTypes"`
}

// =============================================================================
// PAGINATION TYPES
// =============================================================================

// PageInfo contains pagination info.
type PageInfo struct {
	HasNextPage     bool    `json:"hasNextPage"`
	HasPreviousPage bool    `json:"hasPreviousPage"`
	StartCursor     *string `json:"startCursor,omitempty"`
	EndCursor       *string `json:"endCursor,omitempty"`
}
