package community

import (
	"context"
	"time"
)

// ===================================================
// Community Detection Types
// Supports hierarchical community detection (Leiden algorithm)
// with multi-resolution levels stored as KG nodes
// ===================================================

// Community represents a detected community in the knowledge graph.
// Communities are stored as KG nodes with BELONGS_TO edges from members.
type Community struct {
	ID          string                 `json:"id"`          // Unique community ID
	TenantID    string                 `json:"tenantId"`    // Tenant for multi-tenancy
	Level       CommunityLevel         `json:"level"`       // Hierarchy level (LevelTopic, LevelCluster, LevelMicroCluster)
	ParentID    string                 `json:"parentId"`    // Parent community at higher level (empty for root)
	Label       string                 `json:"label"`       // Human-readable label (LLM or keyword generated)
	Description string                 `json:"description"` // LLM-generated description
	Size        int                    `json:"size"`        // Number of members
	Modularity  float64                `json:"modularity"`  // Leiden modularity score
	Properties  map[string]any         `json:"properties"`  // Additional properties
	Temporal    CommunityTemporalMeta  `json:"temporal"`    // Temporal metadata
	Keywords    []string               `json:"keywords"`    // Representative keywords
	Centroid    []float32              `json:"centroid"`    // Average embedding vector
}

// CommunityTemporalMeta tracks community lifecycle.
type CommunityTemporalMeta struct {
	FirstSeen     time.Time `json:"firstSeen"`     // When community was first detected
	LastSeen      time.Time `json:"lastSeen"`      // Most recent detection
	LastActivity  time.Time `json:"lastActivity"`  // Most recent member activity
	ActivityCount int       `json:"activityCount"` // Total activity events
	Stability     float64   `json:"stability"`     // How stable membership is over time (0-1)
}

// CommunityMember represents an entity's membership in a community.
type CommunityMember struct {
	EntityID       string    `json:"entityId"`       // Member entity reference
	CommunityID    string    `json:"communityId"`    // Parent community
	Centrality     float64   `json:"centrality"`     // How central in the community (0-1)
	JoinedAt       time.Time `json:"joinedAt"`       // When entity joined this community
	LeftAt         *time.Time `json:"leftAt"`        // When entity left (nil if current)
	Contribution   float64   `json:"contribution"`   // Contribution to community cohesion
}

// CommunityLevel defines resolution levels for hierarchical communities.
type CommunityLevel int

const (
	// LevelTopic is the highest level (broadest grouping, e.g., "Authentication")
	LevelTopic CommunityLevel = 0
	// LevelCluster is mid-level grouping (e.g., "Login Issues")
	LevelCluster CommunityLevel = 1
	// LevelMicroCluster is finest grouping (very cohesive entity groups)
	LevelMicroCluster CommunityLevel = 2
)

// String returns the level name.
func (l CommunityLevel) String() string {
	switch l {
	case LevelTopic:
		return "topic"
	case LevelCluster:
		return "cluster"
	case LevelMicroCluster:
		return "micro-cluster"
	default:
		return "unknown"
	}
}

// ===================================================
// Leiden Algorithm Types
// ===================================================

// LeidenConfig configures the Leiden community detection algorithm.
type LeidenConfig struct {
	// Resolution parameter: higher = more communities (finer granularity)
	// Typical range: 0.5-2.0, default 1.0
	Resolution float64 `json:"resolution"`

	// MinCommunitySize filters out communities below this threshold
	MinCommunitySize int `json:"minCommunitySize"`

	// MaxIterations limits algorithm iterations
	MaxIterations int `json:"maxIterations"`

	// RandomSeed for reproducible results (0 = use current time)
	RandomSeed int64 `json:"randomSeed"`

	// NumLevels specifies how many hierarchy levels to generate
	NumLevels int `json:"numLevels"`

	// SimilarityThreshold for edge creation (cosine similarity)
	SimilarityThreshold float64 `json:"similarityThreshold"`
}

// DefaultLeidenConfig returns sensible defaults for Leiden.
func DefaultLeidenConfig() LeidenConfig {
	return LeidenConfig{
		Resolution:          1.0,
		MinCommunitySize:    3,
		MaxIterations:       100,
		RandomSeed:          0,
		NumLevels:           3, // Topic → Cluster → MicroCluster
		SimilarityThreshold: 0.5,
	}
}

// LeidenResult holds the output of Leiden community detection.
type LeidenResult struct {
	Communities     []Community         `json:"communities"`
	Memberships     []CommunityMember   `json:"memberships"`
	Modularity      float64             `json:"modularity"`      // Overall graph modularity
	NumLevels       int                 `json:"numLevels"`       // Levels generated
	ProcessingTime  time.Duration       `json:"processingTime"`
}

// ===================================================
// Graph Types for Leiden Input
// ===================================================

// Node represents an entity for community detection.
type Node struct {
	ID        string    `json:"id"`
	Embedding []float32 `json:"embedding"` // Vector for similarity
	Label     string    `json:"label"`     // Display name
	Type      string    `json:"type"`      // Entity type
}

// Edge represents a weighted connection between nodes.
type Edge struct {
	Source string  `json:"source"`
	Target string  `json:"target"`
	Weight float64 `json:"weight"` // Similarity or explicit edge weight
}

// Graph is the input structure for Leiden algorithm.
type Graph struct {
	Nodes []Node `json:"nodes"`
	Edges []Edge `json:"edges"`
}

// ===================================================
// Interfaces
// ===================================================

// CommunityDetector detects communities in a graph.
type CommunityDetector interface {
	// Detect runs community detection on the given graph.
	Detect(ctx context.Context, graph Graph, config LeidenConfig) (*LeidenResult, error)
}

// CommunityStore persists and retrieves communities from KG.
type CommunityStore interface {
	// UpsertCommunity creates or updates a community node in KG.
	UpsertCommunity(ctx context.Context, community Community) error

	// UpsertMembership creates or updates a membership edge.
	UpsertMembership(ctx context.Context, member CommunityMember) error

	// GetCommunity retrieves a community by ID.
	GetCommunity(ctx context.Context, id string) (*Community, error)

	// ListCommunities lists communities with filtering.
	ListCommunities(ctx context.Context, filter CommunityFilter) ([]Community, error)

	// GetCommunityMembers returns members of a community.
	GetCommunityMembers(ctx context.Context, communityID string) ([]CommunityMember, error)

	// GetEntityCommunities returns communities an entity belongs to.
	GetEntityCommunities(ctx context.Context, entityID string) ([]Community, error)

	// GetHierarchy returns the community hierarchy (parent-child tree).
	GetHierarchy(ctx context.Context, rootID string) (*CommunityHierarchy, error)

	// ExpireMemberships marks memberships as expired (set LeftAt).
	ExpireMemberships(ctx context.Context, communityID string, exceptEntityIDs []string, at time.Time) error
}

// CommunityFilter specifies community list filtering options.
type CommunityFilter struct {
	TenantID      string         `json:"tenantId"`
	Level         *CommunityLevel `json:"level"`
	ParentID      *string        `json:"parentId"`
	MinSize       int            `json:"minSize"`
	MaxSize       int            `json:"maxSize"`
	ActiveAfter   *time.Time     `json:"activeAfter"`
	Limit         int            `json:"limit"`
	Offset        int            `json:"offset"`
}

// CommunityHierarchy represents a tree of communities.
type CommunityHierarchy struct {
	Root     Community            `json:"root"`
	Children []CommunityHierarchy `json:"children"`
}

// CommunityLabeler generates human-readable labels for communities.
type CommunityLabeler interface {
	// LabelCommunity generates a label and description for a community.
	// Uses member content to derive meaningful names.
	LabelCommunity(ctx context.Context, community Community, memberSummaries []string) (label, description string, keywords []string, err error)
}
