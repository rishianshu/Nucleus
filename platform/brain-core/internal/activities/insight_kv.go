package activities

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

type insightSignature struct {
	Signature   string `json:"signature"`
	GeneratedAt string `json:"generatedAt"`
}

func makeInsightKey(skillID, entityRef string) string {
	return fmt.Sprintf("insight:%s:%s", skillID, entityRef)
}

func hashInsight(skillID, entityRef string, params map[string]string) string {
	b, _ := json.Marshal(params)
	h := sha256.Sum256(append([]byte(skillID+"|"+entityRef+"|"), b...))
	return hex.EncodeToString(h[:])
}

func loadInsightSignature(ctx context.Context, tenantID, projectID, skillID, entityRef string) (string, error) {
	m, err := loadCheckpointKV(ctx, tenantID, projectID, makeInsightKey(skillID, entityRef))
	if err != nil || m == nil {
		return "", err
	}
	if sig, ok := m["signature"].(string); ok {
		return sig, nil
	}
	return "", nil
}

func saveInsightSignature(ctx context.Context, tenantID, projectID, skillID, entityRef, signature string) {
	_ = saveCheckpointKV(ctx, tenantID, projectID, makeInsightKey(skillID, entityRef), map[string]any{
		"signature":   signature,
		"generatedAt": time.Now().UTC().Format(time.RFC3339),
	})
}
