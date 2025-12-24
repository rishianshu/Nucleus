package activities

import (
	"context"
	"crypto/sha1"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/nucleus/ucl-core/pkg/kgpb"
	"github.com/nucleus/ucl-core/pkg/kvstore"
	"github.com/nucleus/ucl-core/pkg/logstore"
	"github.com/nucleus/ucl-core/pkg/vectorstore"
	"go.temporal.io/sdk/activity"
)

type clusterStats struct {
	centroid    []float32
	size        int
	avgSim      float32
	maxSim      float32
	memberIDs   []string
	cachedAtStr string
	edgeDegree  int
	memberHash  string
	topRelated  []edgeSummary
}

type edgeSummary struct {
	Src   string  `json:"src"`
	Dst   string  `json:"dst"`
	Score float32 `json:"score"`
}

type centroidCacheEntry struct {
	Centroid   []float32     `json:"centroid"`
	Size       int           `json:"size"`
	AvgSim     float32       `json:"avgSim"`
	MaxSim     float32       `json:"maxSim"`
	UpdatedAt  string        `json:"updatedAt"`
	EdgeDegree int           `json:"edgeDegree"`
	MemberHash string        `json:"memberHash"`
	TopRelated []edgeSummary `json:"topRelated"`
	Dim        int           `json:"dim"`
	updatedAt  time.Time
}

type kbEvent struct {
	Seq         int64  `json:"seq"`
	RunID       string `json:"runId"`
	DatasetSlug string `json:"datasetSlug"`
	Op          string `json:"op"` // upsert_node / upsert_edge
	Kind        string `json:"kind"`
	ID          string `json:"id"`
	Hash        string `json:"hash"`
	At          string `json:"at"`
}

// BuildClusters groups entities using vector embeddings (greedy centroid assignment) and writes cluster nodes/edges to KG.
func (a *Activities) BuildClusters(ctx context.Context, req IndexArtifactRequest) error {
	logger := activity.GetLogger(ctx)
	if strings.TrimSpace(req.SinkEndpointID) == "" {
		return fmt.Errorf("sinkEndpointId is required")
	}

	tenant := req.TenantID
	if tenant == "" {
		tenant = getenv("TENANT_ID", "dev")
	}
	project := req.ProjectID
	if project == "" {
		project = getenv("METADATA_DEFAULT_PROJECT", "global")
	}

	var since *time.Time
	if ts, ok := req.Checkpoint["lastUpdatedAt"].(string); ok && ts != "" {
		if t, err := time.Parse(time.RFC3339, ts); err == nil {
			since = &t
		}
	}

	client, err := getVectorStore()
	if err != nil {
		return err
	}
	entries, err := client.ListEntries(vectorstore.QueryFilter{
		TenantID:       tenant,
		ProjectID:      project,
		DatasetSlug:    req.DatasetSlug,
		SourceFamily:   req.SourceFamily,
		SinkEndpointID: req.SinkEndpointID,
		SinceUpdatedAt: since,
		Limit:          300,
	}, 300)
	if err != nil {
		return err
	}
	if len(entries) == 0 {
		logger.Info("cluster-skip-no-entries", "dataset", req.DatasetSlug)
		return nil
	}

	var latestUpdated time.Time
	for _, e := range entries {
		if e.UpdatedAt != nil && e.UpdatedAt.After(latestUpdated) {
			latestUpdated = *e.UpdatedAt
		}
	}

	simThreshold := getEnvFloat("CLUSTER_SIM_THRESHOLD", 0.35)
	graphThreshold := getEnvFloat("CLUSTER_GRAPH_THRESHOLD", 0.45)
	maxClusterSize := getEnvInt("CLUSTER_MAX_SIZE", 5)
	if maxClusterSize < 2 {
		maxClusterSize = 5
	}

	type centroid struct {
		vec []float32
		n   int
		id  string
	}
	var clusters []centroid
	assignments := make(map[string]string)
	clusterSeq := 0

	for _, e := range entries {
		if len(e.Embedding) == 0 {
			continue
		}
		bestIdx := -1
		bestSim := float32(-1)
		for idx, c := range clusters {
			if c.n >= maxClusterSize {
				continue
			}
			sim := cosineSim(e.Embedding, c.vec)
			if sim > bestSim {
				bestSim = sim
				bestIdx = idx
			}
		}
		if bestIdx >= 0 && bestSim >= simThreshold {
			assignments[e.NodeID] = clusters[bestIdx].id
			clusters[bestIdx].vec = avgVec(clusters[bestIdx].vec, e.Embedding, clusters[bestIdx].n+1)
			clusters[bestIdx].n++
		} else {
			clusterSeq++
			cid := fmt.Sprintf("cluster:%s:%d", req.DatasetSlug, clusterSeq)
			clusters = append(clusters, centroid{vec: e.Embedding, n: 1, id: cid})
			assignments[e.NodeID] = cid
		}
	}

	if len(assignments) == 0 {
		logger.Info("cluster-skip-no-assignments", "dataset", req.DatasetSlug)
		return nil
	}

	// Graph-based refinement: merge items that are mutually similar above graphThreshold.
	compAssignments := make(map[string]string)
	components, edgeMap := buildComponents(entries, graphThreshold)
	compSeq := 0
	for _, comp := range components {
		if len(comp) < 2 {
			continue
		}
		compSeq++
		cid := fmt.Sprintf("cluster:%s:cc%d", req.DatasetSlug, compSeq)
		for _, nodeID := range comp {
			compAssignments[nodeID] = cid
		}
	}

	// If components found, prefer those assignments (merging clusters).
	if len(compAssignments) > 0 {
		assignments = compAssignments
		clusters = clusters[:0]
		seenClusters := make(map[string]struct{})
		for _, cid := range compAssignments {
			if _, ok := seenClusters[cid]; !ok {
				seenClusters[cid] = struct{}{}
				clusters = append(clusters, centroid{id: cid, n: 0})
			}
		}
		for _, cid := range compAssignments {
			for i := range clusters {
				if clusters[i].id == cid {
					clusters[i].n++
				}
			}
		}
	}

	// Rebuild stable IDs using member sets to keep clusters consistent across runs.
	clusterMembers := make(map[string][]string)
	for node, cid := range assignments {
		clusterMembers[cid] = append(clusterMembers[cid], node)
	}
	stableIDs := make(map[string]string)
	for cid, members := range clusterMembers {
		stableIDs[cid] = makeStableClusterID(req.DatasetSlug, req.SourceFamily, members)
	}

	finalClusters := make(map[string]*clusterStats)

	cacheEntries, cacheVersion, _ := loadCentroidCache(ctx, tenant, project, req.DatasetSlug)
	cacheHits := 0

	for cid, members := range clusterMembers {
		sid := stableIDs[cid]
		cs := finalClusters[sid]
		if cs == nil {
			cs = &clusterStats{}
			finalClusters[sid] = cs
		}
		cs.size += len(members)
		cs.memberIDs = append(cs.memberIDs, members...)
		cs.memberHash = makeStableClusterID(req.DatasetSlug, req.SourceFamily, members)

		// reuse cached centroid if membership unchanged and cache is fresh enough
		if entry, ok := cacheEntries[sid]; ok && len(entry.Centroid) > 0 && len(entry.Centroid) == len(entries[0].Embedding) && entry.MemberHash == cs.memberHash && entry.Dim == len(entries[0].Embedding) {
			// if we have no newer updates, trust cache
			if latestUpdated.IsZero() || entry.updatedAt.After(latestUpdated) || entry.updatedAt.Equal(latestUpdated) {
				cs.centroid = entry.Centroid
				cs.avgSim = entry.AvgSim
				cs.maxSim = entry.MaxSim
				cs.cachedAtStr = entry.updatedAt.Format(time.RFC3339)
				cs.edgeDegree = entry.EdgeDegree
				cs.topRelated = entry.TopRelated
				cs.memberHash = entry.MemberHash
				cacheHits++
				continue
			}
		}

		// recompute centroid from members
		count := 0
		for _, m := range members {
			for _, e := range entries {
				if e.NodeID == m && len(e.Embedding) > 0 {
					if cs.centroid == nil {
						cs.centroid = make([]float32, len(e.Embedding))
					}
					cs.centroid = avgVec(cs.centroid, e.Embedding, count+1)
					count++
				}
			}
		}
	}

	// compute similarity stats to centroid
	for _, cs := range finalClusters {
		var sumSim float32
		var count int
		if len(cs.centroid) == 0 {
			continue
		}
		for _, m := range cs.memberIDs {
			for _, e := range entries {
				if e.NodeID == m && len(e.Embedding) > 0 && len(cs.centroid) > 0 {
					s := cosineSim(e.Embedding, cs.centroid)
					sumSim += s
					if s > cs.maxSim {
						cs.maxSim = s
					}
					count++
				}
			}
		}
		if count > 0 {
			cs.avgSim = sumSim / float32(count)
		}
	}

	clusterKind := "episode"
	if req.SourceFamily != "" {
		clusterKind = strings.ToLower(req.SourceFamily)
	}

	kgc := newKgGRPCClient()
	defer kgc.Close()
	if kgc == nil {
		return nil
	}

	topEdges := make(map[string][]edgeSummary)
	nodesTouched := len(finalClusters)
	edgesTouched := len(assignments)
	var kbEvents []kbEvent
	seq := int64(0)

	now := time.Now().UTC().Format(time.RFC3339)
	for cid, c := range finalClusters {
		if edges := topEdges[cid]; len(edges) > 0 {
			sort.Slice(edges, func(i, j int) bool { return edges[i].Score > edges[j].Score })
			if len(edges) > 5 {
				edges = edges[:5]
			}
			c.topRelated = edges
		}
		seq++
		nodesTouched++
		nodeHash := sha1.Sum([]byte(fmt.Sprintf("%s|%d|%s|%s|%s", cid, c.size, c.memberHash, c.cachedAtStr, req.RunID)))
		kbEvents = append(kbEvents, kbEvent{
			Seq:         seq,
			RunID:       req.RunID,
			DatasetSlug: req.DatasetSlug,
			Op:          "upsert_node",
			Kind:        "kg.cluster",
			ID:          cid,
			Hash:        fmt.Sprintf("%x", nodeHash[:6]),
			At:          now,
		})
		_, _ = kgc.client.UpsertNode(ctx, &kgpb.UpsertNodeRequest{
			TenantId:  tenant,
			ProjectId: project,
			Node: &kgpb.Node{
				Id:   cid,
				Type: "kg.cluster",
				Properties: map[string]string{
					"clusterKind":    clusterKind,
					"dataset":        req.DatasetSlug,
					"artifactId":     req.ArtifactID,
					"runId":          req.RunID,
					"sinkEndpointId": req.SinkEndpointID,
					"sourceFamily":   req.SourceFamily,
					"updatedAt":      now,
					"size":           fmt.Sprintf("%d", c.size),
					"avgSim":         fmt.Sprintf("%.4f", c.avgSim),
					"maxSim":         fmt.Sprintf("%.4f", c.maxSim),
					"edgeDegree":     fmt.Sprintf("%d", c.edgeDegree),
					"cacheAt":        c.cachedAtStr,
					"memberHash":     c.memberHash,
				},
			},
		})
	}

	for nodeID, cid := range assignments {
		sid := stableIDs[cid]
		edgeID := fmt.Sprintf("in_cluster:%s:%s", sid, nodeID)
		edgesTouched++
		seq++
		edgeHash := sha1.Sum([]byte(edgeID + req.RunID))
		kbEvents = append(kbEvents, kbEvent{
			Seq:         seq,
			RunID:       req.RunID,
			DatasetSlug: req.DatasetSlug,
			Op:          "upsert_edge",
			Kind:        "IN_CLUSTER",
			ID:          edgeID,
			Hash:        fmt.Sprintf("%x", edgeHash[:6]),
			At:          now,
		})
		_, _ = kgc.client.UpsertEdge(ctx, &kgpb.UpsertEdgeRequest{
			TenantId:  tenant,
			ProjectId: project,
			Edge: &kgpb.Edge{
				Id:     edgeID,
				Type:   "IN_CLUSTER",
				FromId: sid,
				ToId:   nodeID,
			},
		})
	}

	// Optional related edges from similarity graph (only for component edges)
	relatedSeen := make(map[string]struct{})
	relatedCount := 0
	for src, neighbors := range edgeMap {
		for _, dst := range neighbors {
			key := src + "->" + dst
			if _, ok := relatedSeen[key]; ok {
				continue
			}
			relatedSeen[key] = struct{}{}
			relatedCount++
			// bump edge degree per cluster
			if cid := findClusterID(assignments, src); cid != "" {
				if cs, ok := finalClusters[stableIDs[cid]]; ok {
					cs.edgeDegree++
					topEdges[cid] = append(topEdges[cid], edgeSummary{Src: src, Dst: dst, Score: cosineSim(findEmb(entries, src), findEmb(entries, dst))})
				}
			}
			if cid := findClusterID(assignments, dst); cid != "" {
				if cs, ok := finalClusters[stableIDs[cid]]; ok {
					cs.edgeDegree++
					topEdges[cid] = append(topEdges[cid], edgeSummary{Src: src, Dst: dst, Score: cosineSim(findEmb(entries, src), findEmb(entries, dst))})
				}
			}
			_, _ = kgc.client.UpsertEdge(ctx, &kgpb.UpsertEdgeRequest{
				TenantId:  tenant,
				ProjectId: project,
				Edge: &kgpb.Edge{
					Id:     fmt.Sprintf("related:%s:%s", src, dst),
					Type:   "RELATED",
					FromId: src,
					ToId:   dst,
				},
			})
			seq++
			edgeHash := sha1.Sum([]byte(key + req.RunID))
			kbEvents = append(kbEvents, kbEvent{
				Seq:         seq,
				RunID:       req.RunID,
				DatasetSlug: req.DatasetSlug,
				Op:          "upsert_edge",
				Kind:        "RELATED",
				ID:          key,
				Hash:        fmt.Sprintf("%x", edgeHash[:6]),
				At:          now,
			})
			edgesTouched++
		}
	}

	logger.Info("cluster-built", "clusters", len(finalClusters), "assignments", len(assignments), "relatedEdges", relatedCount, "cacheHits", cacheHits, "dataset", req.DatasetSlug)

	// Save checkpoint for incremental runs
	cpTime := now
	if !latestUpdated.IsZero() {
		cpTime = latestUpdated.UTC().Format(time.RFC3339)
	}
	saveCheckpointKV(ctx, tenant, project, fmt.Sprintf("cluster:%s", req.DatasetSlug), map[string]any{
		"lastUpdatedAt": cpTime,
	})

	if regClient, _ := newRegistryClient(); regClient != nil {
		defer regClient.Close()
		versionHash := sha1.Sum([]byte(strings.Join(sortedKeys(finalClusters), "|")))
		eventsPath, snapPath := saveKBEvents(ctx, tenant, project, req.DatasetSlug, req.RunID, kbEvents, seq)
		regClient.markClustered(ctx, req.ArtifactID, map[string]any{
			"clustersCreated": len(finalClusters),
			"membersLinked":   len(assignments),
			"relatedEdges":    relatedCount,
			"cacheHits":       cacheHits,
			"cacheAt":         now,
			"clusterKind":     clusterKind,
			"dataset":         req.DatasetSlug,
			"runId":           req.RunID,
			"versionHash":     fmt.Sprintf("%x", versionHash[:6]),
			"nodesTouched":    nodesTouched,
			"edgesTouched":    edgesTouched,
			"logEventsPath":   eventsPath,
			"logSnapshotPath": snapPath,
		})
	}

	// persist centroid summaries for next incremental run
	saveCentroidCache(ctx, tenant, project, req.DatasetSlug, finalClusters, cacheVersion)
	// persist kb events and snapshot header (log store)
	saveKBEvents(ctx, tenant, project, req.DatasetSlug, req.RunID, kbEvents, seq)
	return nil
}

func saveKBEvents(ctx context.Context, tenant, project, dataset, runID string, events []kbEvent, seq int64) (string, string) {
	store, err := logstore.NewMinioStoreFromEnv()
	if err != nil {
		return "", ""
	}
	_ = store.CreateTable(ctx, dataset)
	var eventsPath, snapPath string
	if len(events) > 0 {
		records := make([]logstore.Record, 0, len(events))
		for _, ev := range events {
			records = append(records, logstore.Record{
				RunID:       ev.RunID,
				DatasetSlug: ev.DatasetSlug,
				Op:          ev.Op,
				Kind:        ev.Kind,
				ID:          ev.ID,
				Hash:        ev.Hash,
				Seq:         ev.Seq,
				At:          ev.At,
			})
		}
		if path, err := store.Append(ctx, dataset, runID, records); err == nil {
			eventsPath = path
		}
	}
	header := map[string]any{
		"runId":       runID,
		"dataset":     dataset,
		"events":      seq,
		"generatedAt": time.Now().UTC().Format(time.RFC3339),
	}
	hb, _ := json.Marshal(header)
	if path, err := store.WriteSnapshot(ctx, dataset, runID, hb); err == nil {
		snapPath = path
	}
	return eventsPath, snapPath
}

func sortedKeys(clusters map[string]*clusterStats) []string {
	keys := make([]string, 0, len(clusters))
	for k := range clusters {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func cosineSim(a, b []float32) float32 {
	if len(a) == 0 || len(b) == 0 || len(a) != len(b) {
		return 0
	}
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return float32(dot / (math.Sqrt(na) * math.Sqrt(nb)))
}

func avgVec(a, b []float32, total int) []float32 {
	if len(a) == 0 {
		return b
	}
	out := make([]float32, len(a))
	for i := range a {
		out[i] = (a[i]*float32(total-1) + b[i]) / float32(total)
	}
	return out
}

// buildComponents builds connected components over entries using a similarity threshold and returns component membership plus the underlying edge map for RELATED edges.
func buildComponents(entries []vectorstore.Entry, threshold float32) ([][]string, map[string][]string) {
	ids := make([]string, 0, len(entries))
	emb := make([][]float32, 0, len(entries))
	for _, e := range entries {
		if len(e.Embedding) == 0 {
			continue
		}
		ids = append(ids, e.NodeID)
		emb = append(emb, e.Embedding)
	}
	n := len(ids)
	graph := make([][]int, n)
	edgeMap := make(map[string][]string)
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			if cosineSim(emb[i], emb[j]) >= threshold {
				graph[i] = append(graph[i], j)
				graph[j] = append(graph[j], i)
				edgeMap[ids[i]] = append(edgeMap[ids[i]], ids[j])
				edgeMap[ids[j]] = append(edgeMap[ids[j]], ids[i])
			}
		}
	}
	visited := make([]bool, n)
	var comps [][]string
	var stack []int
	for i := 0; i < n; i++ {
		if visited[i] {
			continue
		}
		stack = stack[:0]
		stack = append(stack, i)
		var comp []string
		for len(stack) > 0 {
			k := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if visited[k] {
				continue
			}
			visited[k] = true
			comp = append(comp, ids[k])
			for _, nei := range graph[k] {
				if !visited[nei] {
					stack = append(stack, nei)
				}
			}
		}
		if len(comp) > 0 {
			comps = append(comps, comp)
		}
	}
	return comps, edgeMap
}

func getEnvFloat(key string, defaultVal float64) float32 {
	if val := os.Getenv(key); val != "" {
		if f, err := strconv.ParseFloat(val, 64); err == nil {
			return float32(f)
		}
	}
	return float32(defaultVal)
}

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}

func makeStableClusterID(dataset, sourceFamily string, members []string) string {
	sort.Strings(members)
	key := fmt.Sprintf("%s|%s|%s", dataset, sourceFamily, strings.Join(members, "|"))
	sum := sha1.Sum([]byte(key))
	return fmt.Sprintf("cluster:%s:%x", dataset, sum[:6])
}

func findClusterID(assignments map[string]string, nodeID string) string {
	if cid, ok := assignments[nodeID]; ok {
		return cid
	}
	return ""
}

func findEmb(entries []vectorstore.Entry, nodeID string) []float32 {
	for _, e := range entries {
		if e.NodeID == nodeID {
			return e.Embedding
		}
	}
	return nil
}

func loadCentroidCache(ctx context.Context, tenant, project, dataset string) (map[string]centroidCacheEntry, int64, error) {
	store, err := kvstore.NewPostgresStore()
	if err != nil {
		return map[string]centroidCacheEntry{}, 0, err
	}
	defer store.Close()
	key := fmt.Sprintf("cluster:centroids:%s", dataset)
	rec, err := store.Get(ctx, tenant, project, key)
	if err != nil || rec == nil {
		return map[string]centroidCacheEntry{}, 0, err
	}
	var payload map[string]centroidCacheEntry
	if err := json.Unmarshal(rec.Value, &payload); err != nil {
		return map[string]centroidCacheEntry{}, rec.Version, err
	}
	for id, entry := range payload {
		if t, err := time.Parse(time.RFC3339, entry.UpdatedAt); err == nil {
			entry.updatedAt = t
			payload[id] = entry
		}
	}
	return payload, rec.Version, nil
}

func saveCentroidCache(ctx context.Context, tenant, project, dataset string, clusters map[string]*clusterStats, currentVersion int64) {
	store, err := kvstore.NewPostgresStore()
	if err != nil {
		return
	}
	defer store.Close()
	key := fmt.Sprintf("cluster:centroids:%s", dataset)
	payload := make(map[string]centroidCacheEntry)
	now := time.Now().UTC().Format(time.RFC3339)
	for id, cs := range clusters {
		payload[id] = centroidCacheEntry{
			Centroid:   cs.centroid,
			Size:       cs.size,
			AvgSim:     cs.avgSim,
			MaxSim:     cs.maxSim,
			UpdatedAt:  now,
			EdgeDegree: cs.edgeDegree,
			MemberHash: cs.memberHash,
			TopRelated: cs.topRelated,
		}
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	_, _ = store.Put(ctx, kvstore.Record{
		TenantID:  tenant,
		ProjectID: project,
		Key:       key,
		Value:     b,
	}, currentVersion)
}
