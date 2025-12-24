package activities

import "context"

// DiffRunSummaries compares two artifacts (runs) using registry counters/hashes.
type DiffRunSummariesRequest struct {
	LeftArtifactID  string `json:"leftArtifactId"`
	RightArtifactID string `json:"rightArtifactId"`
}

type DiffRunSummariesResponse struct {
	Left          *RunSummaryResponse `json:"left"`
	Right         *RunSummaryResponse `json:"right"`
	VersionEqual  bool                `json:"versionEqual"`
	Notes         string              `json:"notes"`
	LogEventsPath string              `json:"logEventsPath,omitempty"`
}

// DiffRunSummaries fetches summaries and reports whether version hashes match.
// If hashes differ, caller can stream logs from the returned logEventsPath/logSnapshotPath.
func (a *Activities) DiffRunSummaries(ctx context.Context, req DiffRunSummariesRequest) (*DiffRunSummariesResponse, error) {
	left, err := a.GetRunSummary(ctx, RunSummaryRequest{ArtifactID: req.LeftArtifactID})
	if err != nil {
		return nil, err
	}
	right, err := a.GetRunSummary(ctx, RunSummaryRequest{ArtifactID: req.RightArtifactID})
	if err != nil {
		return nil, err
	}
	resp := &DiffRunSummariesResponse{
		Left:  left,
		Right: right,
	}
	resp.VersionEqual = left.VersionHash != "" && right.VersionHash != "" && left.VersionHash == right.VersionHash
	if resp.VersionEqual {
		resp.Notes = "versionHash matches; no replay needed"
	} else {
		resp.Notes = "versionHash differs; replay logs to inspect changes"
		if right.LogEventsPath != "" {
			resp.LogEventsPath = right.LogEventsPath
		} else {
			resp.LogEventsPath = left.LogEventsPath
		}
	}
	return resp, nil
}
