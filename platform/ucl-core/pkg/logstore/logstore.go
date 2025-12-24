package logstore

import "context"

// Record represents a single log event.
type Record struct {
	RunID       string `json:"runId"`
	DatasetSlug string `json:"datasetSlug"`
	Op          string `json:"op"`
	Kind        string `json:"kind"`
	ID          string `json:"id"`
	Hash        string `json:"hash"`
	Seq         int64  `json:"seq"`
	At          string `json:"at"`
}

// Store abstracts append-only log storage.
type Store interface {
	CreateTable(ctx context.Context, table string) error
	Append(ctx context.Context, table, runID string, records []Record) (string, error)
	WriteSnapshot(ctx context.Context, table, runID string, snapshot []byte) (string, error)
	Prune(ctx context.Context, table string, retentionDays int) error
	ListPaths(ctx context.Context, prefix string) ([]string, error)
}
