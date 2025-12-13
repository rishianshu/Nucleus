package staging

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
)

// cloneEnvelopes makes a shallow copy of envelope slice to avoid mutation.
func cloneEnvelopes(in []RecordEnvelope) []RecordEnvelope {
	out := make([]RecordEnvelope, len(in))
	copy(out, in)
	return out
}

// envelopeSizeBytes approximates payload size using JSONL encoding.
func envelopeSizeBytes(records []RecordEnvelope) (int64, error) {
	buf := &bytes.Buffer{}
	if err := writeJSONLines(buf, records, false); err != nil {
		return 0, err
	}
	return int64(buf.Len()), nil
}

func writeJSONLines(w io.Writer, records []RecordEnvelope, compress bool) error {
	var writer io.Writer = w
	var gz *gzip.Writer

	if compress {
		gz = gzip.NewWriter(w)
		writer = gz
		defer gz.Close()
	}

	enc := json.NewEncoder(writer)
	for _, rec := range records {
		if err := enc.Encode(rec); err != nil {
			return fmt.Errorf("encode record: %w", err)
		}
	}

	if gz != nil {
		if err := gz.Close(); err != nil {
			return fmt.Errorf("flush gzip: %w", err)
		}
	}
	return nil
}

func readJSONLines(r io.Reader) ([]RecordEnvelope, error) {
	dec := json.NewDecoder(r)
	var records []RecordEnvelope
	for dec.More() {
		var rec RecordEnvelope
		if err := dec.Decode(&rec); err != nil {
			return nil, fmt.Errorf("decode record: %w", err)
		}
		records = append(records, rec)
	}
	return records, nil
}
