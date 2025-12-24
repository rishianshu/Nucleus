package activities

import "sync/atomic"

// Simple in-memory counters for observability (per-process only).
type insightCounters struct {
	skippedMissing uint64
	skippedCache   uint64
	llmErrors      uint64
	parsed         uint64
}

func (c *insightCounters) incMissing() { atomic.AddUint64(&c.skippedMissing, 1) }
func (c *insightCounters) incCache()   { atomic.AddUint64(&c.skippedCache, 1) }
func (c *insightCounters) incErr()     { atomic.AddUint64(&c.llmErrors, 1) }
func (c *insightCounters) incParsed()  { atomic.AddUint64(&c.parsed, 1) }

func (c *insightCounters) snapshot() (missing, cache, errs, parsed uint64) {
	return atomic.LoadUint64(&c.skippedMissing),
		atomic.LoadUint64(&c.skippedCache),
		atomic.LoadUint64(&c.llmErrors),
		atomic.LoadUint64(&c.parsed)
}
