package gateway

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	kgpb "github.com/nucleus/ucl-core/pkg/kgpb"
)

type kgRepository interface {
	upsertNode(ctx context.Context, req *kgpb.UpsertNodeRequest) (*kgpb.Node, error)
	upsertEdge(ctx context.Context, req *kgpb.UpsertEdgeRequest) (*kgpb.Edge, error)
	getNode(ctx context.Context, req *kgpb.GetNodeRequest) (*kgpb.Node, error)
	listNodes(ctx context.Context, req *kgpb.ListEntitiesRequest) ([]*kgpb.Node, error)
	listEdges(ctx context.Context, req *kgpb.ListEdgesRequest) ([]*kgpb.Edge, error)
	listNeighbors(ctx context.Context, req *kgpb.ListNeighborsRequest) ([]*kgpb.Node, error)
}

type kgPostgresRepo struct {
	db *pgxpool.Pool
}

func newKgPostgresRepo(db *pgxpool.Pool) kgRepository {
	return &kgPostgresRepo{db: db}
}

func (r *kgPostgresRepo) upsertNode(ctx context.Context, req *kgpb.UpsertNodeRequest) (*kgpb.Node, error) {
	if req.Node.Id == "" {
		return nil, fmt.Errorf("node.id is required")
	}
	props := req.Node.Properties
	if props == nil {
		props = map[string]string{}
	}
	// Fill required fields with safe fallbacks to avoid constraint failures.
	displayName := props["displayName"]
	if displayName == "" {
		displayName = req.Node.Id
	}
	scopeOrg := props["scopeOrgId"]
	if scopeOrg == "" {
		scopeOrg = req.TenantId
	}
	logicalKey := props["logicalKey"]
	if logicalKey == "" {
		logicalKey = req.Node.Id
	}
	columns := []string{
		"id", "tenant_id", "project_id", "entity_type", "display_name", "canonical_path",
		"source_system", "spec_ref", "properties", "version", "scope_org_id", "scope_domain_id",
		"scope_project_id", "scope_team_id", "origin_endpoint_id", "origin_vendor", "logical_key",
		"external_id", "phase", "provenance",
	}
	values := []any{
		req.Node.Id, req.TenantId, nullable(req.ProjectId), req.Node.Type, displayName,
		props["canonicalPath"], props["sourceSystem"], props["specRef"],
		jsonOrEmpty(props), 1, scopeOrg, props["scopeDomainId"],
		props["scopeProjectId"], props["scopeTeamId"], props["originEndpointId"],
		props["originVendor"], logicalKey, props["externalId"],
		props["phase"], props["provenance"],
	}
	sets := []string{
		"tenant_id = EXCLUDED.tenant_id",
		"project_id = EXCLUDED.project_id",
		"entity_type = EXCLUDED.entity_type",
		"display_name = EXCLUDED.display_name",
		"canonical_path = EXCLUDED.canonical_path",
		"source_system = EXCLUDED.source_system",
		"spec_ref = EXCLUDED.spec_ref",
		"properties = EXCLUDED.properties",
		"version = graph_nodes.version + 1",
		"scope_org_id = EXCLUDED.scope_org_id",
		"scope_domain_id = EXCLUDED.scope_domain_id",
		"scope_project_id = EXCLUDED.scope_project_id",
		"scope_team_id = EXCLUDED.scope_team_id",
		"origin_endpoint_id = EXCLUDED.origin_endpoint_id",
		"origin_vendor = EXCLUDED.origin_vendor",
		"logical_key = EXCLUDED.logical_key",
		"external_id = EXCLUDED.external_id",
		"phase = EXCLUDED.phase",
		"provenance = EXCLUDED.provenance",
		"updated_at = now()",
	}
	stmt := fmt.Sprintf(`INSERT INTO graph_nodes (%s)
VALUES (%s)
ON CONFLICT (id) DO UPDATE SET %s
RETURNING id, entity_type, display_name, properties;`,
		strings.Join(columns, ","),
		placeholders(len(columns)),
		strings.Join(sets, ","))

	var id, entityType, displayNameDB string
	var propsDB map[string]string
	row := r.db.QueryRow(ctx, stmt, values...)
	if err := row.Scan(&id, &entityType, &displayNameDB, &propsDB); err != nil {
		return nil, err
	}
	return &kgpb.Node{Id: id, Type: entityType, Properties: propsDB}, nil
}

func (r *kgPostgresRepo) upsertEdge(ctx context.Context, req *kgpb.UpsertEdgeRequest) (*kgpb.Edge, error) {
	if req.Edge.Id == "" {
		return nil, fmt.Errorf("edge.id is required")
	}
	props := req.Edge.Properties
	if props == nil {
		props = map[string]string{}
	}
	scopeOrg := props["scopeOrgId"]
	if scopeOrg == "" {
		scopeOrg = req.TenantId
	}
	sourceLogical := props["sourceLogicalKey"]
	if sourceLogical == "" {
		sourceLogical = req.Edge.FromId
	}
	targetLogical := props["targetLogicalKey"]
	if targetLogical == "" {
		targetLogical = req.Edge.ToId
	}
	logicalKey := props["logicalKey"]
	if logicalKey == "" {
		logicalKey = fmt.Sprintf("%s|%s|%s|%s", req.TenantId, req.Edge.FromId, req.Edge.ToId, req.Edge.Type)
	}
	columns := []string{
		"id", "tenant_id", "project_id", "edge_type", "source_entity_id", "target_entity_id",
		"source_logical_key", "target_logical_key", "scope_org_id", "scope_domain_id", "scope_project_id",
		"scope_team_id", "origin_endpoint_id", "origin_vendor", "logical_key", "confidence", "spec_ref",
		"metadata", "external_id", "phase", "provenance",
	}
	values := []any{
		req.Edge.Id, req.TenantId, nullable(req.ProjectId), req.Edge.Type, req.Edge.FromId, req.Edge.ToId,
		sourceLogical, targetLogical, scopeOrg,
		props["scopeDomainId"], props["scopeProjectId"], props["scopeTeamId"],
		props["originEndpointId"], props["originVendor"], logicalKey,
		props["confidence"], props["specRef"], jsonOrEmpty(props),
		props["externalId"], props["phase"], props["provenance"],
	}
	sets := []string{
		"tenant_id = EXCLUDED.tenant_id",
		"project_id = EXCLUDED.project_id",
		"edge_type = EXCLUDED.edge_type",
		"source_entity_id = EXCLUDED.source_entity_id",
		"target_entity_id = EXCLUDED.target_entity_id",
		"source_logical_key = EXCLUDED.source_logical_key",
		"target_logical_key = EXCLUDED.target_logical_key",
		"scope_org_id = EXCLUDED.scope_org_id",
		"scope_domain_id = EXCLUDED.scope_domain_id",
		"scope_project_id = EXCLUDED.scope_project_id",
		"scope_team_id = EXCLUDED.scope_team_id",
		"origin_endpoint_id = EXCLUDED.origin_endpoint_id",
		"origin_vendor = EXCLUDED.origin_vendor",
		"logical_key = EXCLUDED.logical_key",
		"confidence = EXCLUDED.confidence",
		"spec_ref = EXCLUDED.spec_ref",
		"metadata = EXCLUDED.metadata",
		"external_id = EXCLUDED.external_id",
		"phase = EXCLUDED.phase",
		"provenance = EXCLUDED.provenance",
		"updated_at = now()",
	}
	stmt := fmt.Sprintf(`INSERT INTO graph_edges (%s)
VALUES (%s)
ON CONFLICT (tenant_id, source_entity_id, target_entity_id, edge_type) DO UPDATE SET %s
RETURNING id, edge_type, source_entity_id, target_entity_id, metadata;`,
		strings.Join(columns, ","),
		placeholders(len(columns)),
		strings.Join(sets, ","))
	var id, edgeType, from, to string
	var propsDB map[string]string
	row := r.db.QueryRow(ctx, stmt, values...)
	if err := row.Scan(&id, &edgeType, &from, &to, &propsDB); err != nil {
		return nil, err
	}
	return &kgpb.Edge{Id: id, Type: edgeType, FromId: from, ToId: to, Properties: propsDB}, nil
}

func (r *kgPostgresRepo) getNode(ctx context.Context, req *kgpb.GetNodeRequest) (*kgpb.Node, error) {
	stmt := `SELECT id, entity_type, display_name, properties FROM graph_nodes WHERE tenant_id=$1 AND id=$2`
	args := []any{req.TenantId, req.NodeId}
	if req.ProjectId != "" {
		stmt += " AND (project_id = $3 OR project_id IS NULL)"
		args = append(args, req.ProjectId)
	}
	var id, entityType, display string
	var props map[string]string
	if err := r.db.QueryRow(ctx, stmt, args...).Scan(&id, &entityType, &display, &props); err != nil {
		if strings.Contains(err.Error(), "no rows") {
			return nil, nil
		}
		return nil, err
	}
	return &kgpb.Node{Id: id, Type: entityType, Properties: props}, nil
}

func (r *kgPostgresRepo) listNodes(ctx context.Context, req *kgpb.ListEntitiesRequest) ([]*kgpb.Node, error) {
	limit := req.Limit
	if limit <= 0 {
		limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{req.TenantId}
	argIdx := 2
	if req.ProjectId != "" {
		where = append(where, fmt.Sprintf("(project_id = $%d OR project_id IS NULL)", argIdx))
		args = append(args, req.ProjectId)
		argIdx++
	}
	if len(req.EntityTypes) > 0 {
		where = append(where, fmt.Sprintf("entity_type = ANY($%d)", argIdx))
		args = append(args, req.EntityTypes)
		argIdx++
	}
	stmt := fmt.Sprintf(`SELECT id, entity_type, display_name, properties FROM graph_nodes WHERE %s ORDER BY updated_at DESC LIMIT %d`,
		strings.Join(where, " AND "), limit)
	rows, err := r.db.Query(ctx, stmt, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*kgpb.Node
	for rows.Next() {
		var id, etype, display string
		var props map[string]string
		if err := rows.Scan(&id, &etype, &display, &props); err != nil {
			return nil, err
		}
		out = append(out, &kgpb.Node{Id: id, Type: etype, Properties: props})
	}
	return out, rows.Err()
}

func (r *kgPostgresRepo) listEdges(ctx context.Context, req *kgpb.ListEdgesRequest) ([]*kgpb.Edge, error) {
	limit := req.Limit
	if limit <= 0 {
		limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{req.TenantId}
	argIdx := 2
	if req.ProjectId != "" {
		where = append(where, fmt.Sprintf("(project_id = $%d OR project_id IS NULL)", argIdx))
		args = append(args, req.ProjectId)
		argIdx++
	}
	if len(req.EdgeTypes) > 0 {
		where = append(where, fmt.Sprintf("edge_type = ANY($%d)", argIdx))
		args = append(args, req.EdgeTypes)
		argIdx++
	}
	if req.SourceId != "" {
		where = append(where, fmt.Sprintf("source_entity_id = $%d", argIdx))
		args = append(args, req.SourceId)
		argIdx++
	}
	if req.TargetId != "" {
		where = append(where, fmt.Sprintf("target_entity_id = $%d", argIdx))
		args = append(args, req.TargetId)
		argIdx++
	}
	stmt := fmt.Sprintf(`SELECT id, edge_type, source_entity_id, target_entity_id, metadata FROM graph_edges WHERE %s ORDER BY updated_at DESC LIMIT %d`,
		strings.Join(where, " AND "), limit)
	rows, err := r.db.Query(ctx, stmt, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*kgpb.Edge
	for rows.Next() {
		var id, etype, from, to string
		var props map[string]string
		if err := rows.Scan(&id, &etype, &from, &to, &props); err != nil {
			return nil, err
		}
		out = append(out, &kgpb.Edge{Id: id, Type: etype, FromId: from, ToId: to, Properties: props})
	}
	return out, rows.Err()
}

func (r *kgPostgresRepo) listNeighbors(ctx context.Context, req *kgpb.ListNeighborsRequest) ([]*kgpb.Node, error) {
	limit := req.Limit
	if limit <= 0 {
		limit = 25
	}
	whereEdges := []string{"e.tenant_id = $1"}
	args := []any{req.TenantId}
	argIdx := 2
	if req.ProjectId != "" {
		whereEdges = append(whereEdges, fmt.Sprintf("(e.project_id = $%d OR e.project_id IS NULL)", argIdx))
		args = append(args, req.ProjectId)
		argIdx++
	}
	if len(req.EdgeTypes) > 0 {
		whereEdges = append(whereEdges, fmt.Sprintf("e.edge_type = ANY($%d)", argIdx))
		args = append(args, req.EdgeTypes)
		argIdx++
	}
	whereEdges = append(whereEdges, fmt.Sprintf("(e.source_entity_id = $%d OR e.target_entity_id = $%d)", argIdx, argIdx))
	args = append(args, req.NodeId)
	stmt := fmt.Sprintf(`
SELECT DISTINCT n.id, n.entity_type, n.display_name, n.properties
FROM graph_edges e
JOIN graph_nodes n
  ON (n.id = CASE WHEN e.source_entity_id = $%d THEN e.target_entity_id ELSE e.source_entity_id END)
WHERE %s
ORDER BY n.updated_at DESC
LIMIT %d;`, argIdx, strings.Join(whereEdges, " AND "), limit)

	rows, err := r.db.Query(ctx, stmt, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*kgpb.Node
	for rows.Next() {
		var id, etype, display string
		var props map[string]string
		if err := rows.Scan(&id, &etype, &display, &props); err != nil {
			return nil, err
		}
		out = append(out, &kgpb.Node{Id: id, Type: etype, Properties: props})
	}
	return out, rows.Err()
}

func placeholders(n int) string {
	parts := make([]string, n)
	for i := 0; i < n; i++ {
		parts[i] = fmt.Sprintf("$%d", i+1)
	}
	return strings.Join(parts, ",")
}

func nullable(v string) any {
	if v == "" {
		return nil
	}
	return v
}

func jsonOrEmpty(m map[string]string) any {
	if m == nil {
		return map[string]string{}
	}
	return m
}
