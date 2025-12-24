package activities

import (
	"context"
	"crypto/sha1"
	"fmt"
	"strings"
	"time"

	signalpb "github.com/nucleus/store-core/gen/go/signalpb"
	"github.com/nucleus/ucl-core/pkg/endpoint"
	"github.com/nucleus/ucl-core/pkg/kgpb"
	"go.temporal.io/sdk/activity"
	"google.golang.org/grpc"
)

// ExtractSignals reads records from the sink endpoint and extracts signal candidates.
// Uses store-core SignalService for persistence.
func (a *Activities) ExtractSignals(ctx context.Context, req IndexArtifactRequest) error {
	logger := activity.GetLogger(ctx)
	if strings.TrimSpace(req.SinkEndpointID) == "" {
		return fmt.Errorf("sinkEndpointId is required")
	}
	useStaging := strings.TrimSpace(req.StageRef) != "" && len(req.BatchRefs) > 0
	var (
		iter    endpoint.Iterator[endpoint.Record]
		closeFn func()
		err     error
	)
	if useStaging {
		iter, closeFn, err = streamFromStaging(ctx, req.StagingProviderID, req.StageRef, "", req.DatasetSlug, req.Checkpoint, 0)
	} else {
		iter, closeFn, err = streamDataset(ctx, req.SinkEndpointID, req.EndpointConfig, req.DatasetSlug, req.Checkpoint, 0)
	}
	if err != nil {
		return err
	}
	defer closeFn()

	sc, err := newSignalClient()
	if err != nil {
		return fmt.Errorf("init signal client: %w", err)
	}
	defer sc.Close()

	defs, err := sc.listDefinitions(ctx, req.SourceFamily)
	if err != nil {
		return fmt.Errorf("list definitions: %w", err)
	}
	if len(defs) == 0 {
		id, defErr := sc.upsertDefinition(ctx, signalpb.Definition{
			Slug:         fmt.Sprintf("auto.%s", req.DatasetSlug),
			Title:        fmt.Sprintf("Auto signals for %s", req.DatasetSlug),
			Description:  "Auto-generated signals from ingestion artifacts",
			Status:       "ACTIVE",
			ImplMode:     "CODE",
			SourceFamily: req.SourceFamily,
			EntityKind:   "record",
			Severity:     "INFO",
			Tags:         []string{},
		})
		if defErr != nil {
			return fmt.Errorf("upsert signal definition: %w", defErr)
		}
		defs = append(defs, &signalpb.Definition{
			Id:           id,
			Slug:         fmt.Sprintf("auto.%s", req.DatasetSlug),
			SourceFamily: req.SourceFamily,
			EntityKind:   "record",
			Severity:     "INFO",
			Title:        fmt.Sprintf("Auto signals for %s", req.DatasetSlug),
		})
	}

	engine := newSignalEngine(defs)
	// Preload existing instances per definition for reconciliation.
	existing := make(map[string]map[string]*signalpb.Instance)
	for _, def := range defs {
		insts, _ := sc.listInstances(ctx, def.GetId())
		defMap := make(map[string]*signalpb.Instance)
		for _, inst := range insts {
			defMap[inst.GetEntityRef()] = inst
		}
		existing[def.GetId()] = defMap
	}
	seen := make(map[string]map[string]bool) // defID -> entityRef
	var created, updated int64
	var count int64
	var kbEvents []kbEvent
	var kbSeq int64
	kgc := newKgGRPCClient()
	defer kgc.Close()
	for iter.Next() {
		count++
		rec := iter.Value()
		instances := engine.eval(rec, req, "")
		for _, inst := range instances {
			if _, ok := seen[inst.GetDefinitionId()]; !ok {
				seen[inst.GetDefinitionId()] = map[string]bool{}
			}
			if _, exists := existing[inst.GetDefinitionId()][inst.GetEntityRef()]; exists {
				updated++
			} else {
				created++
			}
			seen[inst.GetDefinitionId()][inst.GetEntityRef()] = true
			if err := sc.upsertInstance(ctx, *inst); err != nil {
				return fmt.Errorf("upsert signal instance: %w", err)
			}
			if kgc != nil {
				if err := kgc.upsertSignal(ctx, inst, req, defs); err != nil {
					return fmt.Errorf("kg upsert: %w", err)
				}
			}
			kbSeq++
			h := sha1.Sum([]byte(inst.GetDefinitionId() + inst.GetEntityRef() + req.RunID))
			kbEvents = append(kbEvents, kbEvent{
				Seq:         kbSeq,
				RunID:       req.RunID,
				DatasetSlug: req.DatasetSlug,
				Op:          "upsert_node",
				Kind:        "signal",
				ID:          fmt.Sprintf("signal:%s:%s", inst.GetDefinitionId(), inst.GetEntityRef()),
				Hash:        fmt.Sprintf("%x", h[:6]),
				At:          time.Now().UTC().Format(time.RFC3339),
			})
		}
	}
	if err := iter.Err(); err != nil {
		return err
	}

	// Reconciliation: resolve instances not seen in this run (no longer match criteria)
	var resolved int64
	for defID, defExisting := range existing {
		defSeen := seen[defID]
		for entityRef, inst := range defExisting {
			if defSeen != nil && defSeen[entityRef] {
				continue // Still active
			}
			if inst.GetStatus() == "RESOLVED" {
				continue // Already resolved
			}
			// Mark as resolved
			if err := sc.updateInstanceStatus(ctx, defID, entityRef, "RESOLVED"); err != nil {
				logger.Warn("failed to resolve instance", "id", inst.GetId(), "error", err)
				continue
			}
			resolved++
		}
	}

	logMsg := fmt.Sprintf("signals: records=%d created=%d updated=%d resolved=%d", count, created, updated, resolved)
	logger.Info(logMsg)
	if len(kbEvents) > 0 {
		saveKBEvents(ctx, req.TenantID, req.ProjectID, req.DatasetSlug, req.RunID, kbEvents, kbSeq)
	}
	logger.Info("signals extraction completed", "records", count, "created", created, "updated", updated, "resolved", resolved)
	return nil
}

type kgClient struct {
	conn   *grpc.ClientConn
	client kgpb.KgServiceClient
}

func newKgGRPCClient() *kgClient {
	addr := getenv("KG_GRPC_ADDR", "")
	if addr == "" {
		return nil
	}
	conn, err := grpc.Dial(addr, grpc.WithInsecure())
	if err != nil {
		return nil
	}
	return &kgClient{
		conn:   conn,
		client: kgpb.NewKgServiceClient(conn),
	}
}

func (c *kgClient) Close() {
	if c != nil && c.conn != nil {
		_ = c.conn.Close()
	}
}

func (c *kgClient) upsertSignal(ctx context.Context, inst *signalpb.Instance, req IndexArtifactRequest, defs []*signalpb.Definition) error {
	if c == nil || c.client == nil {
		return nil
	}
	tenant := req.TenantID
	if tenant == "" {
		tenant = getenv("TENANT_ID", "dev")
	}
	project := req.ProjectID
	if project == "" {
		project = getenv("METADATA_DEFAULT_PROJECT", "global")
	}
	defTitle := inst.GetSummary()
	for _, d := range defs {
		if d.GetId() == inst.GetDefinitionId() && d.GetTitle() != "" {
			defTitle = d.GetTitle()
			break
		}
	}
	signalNodeID := fmt.Sprintf("signal:%s:%s", inst.GetDefinitionId(), inst.GetEntityRef())
	_, _ = c.client.UpsertNode(ctx, &kgpb.UpsertNodeRequest{
		TenantId:  tenant,
		ProjectId: project,
		Node: &kgpb.Node{
			Id:   signalNodeID,
			Type: "signal",
			Properties: map[string]string{
				"definitionId": inst.GetDefinitionId(),
				"entityRef":    inst.GetEntityRef(),
				"entityKind":   inst.GetEntityKind(),
				"severity":     inst.GetSeverity(),
				"title":        defTitle,
			},
		},
	})
	// Edge to definition
	_, _ = c.client.UpsertEdge(ctx, &kgpb.UpsertEdgeRequest{
		TenantId:  tenant,
		ProjectId: project,
		Edge: &kgpb.Edge{
			Id:     fmt.Sprintf("signal-def:%s:%s", inst.GetDefinitionId(), inst.GetEntityRef()),
			Type:   "instance_of",
			FromId: signalNodeID,
			ToId:   inst.GetDefinitionId(),
			Properties: map[string]string{
				"severity": inst.GetSeverity(),
			},
		},
	})
	// Edge to entity
	_, _ = c.client.UpsertEdge(ctx, &kgpb.UpsertEdgeRequest{
		TenantId:  tenant,
		ProjectId: project,
		Edge: &kgpb.Edge{
			Id:     fmt.Sprintf("signal-entity:%s:%s", inst.GetDefinitionId(), inst.GetEntityRef()),
			Type:   "flags",
			FromId: signalNodeID,
			ToId:   deriveEntityRef(map[string]any{"id": inst.GetEntityRef()}),
			Properties: map[string]string{
				"severity": inst.GetSeverity(),
			},
		},
	})
	return nil
}
