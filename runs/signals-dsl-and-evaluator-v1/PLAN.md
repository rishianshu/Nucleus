# Plan

1. Capture DSL v1 schema and update example signal definitions/seeds.
2. Build a SignalEvaluator with per-type dispatch for work-stale and doc-orphan logic.
3. Wire an `evaluateSignals` GraphQL mutation (and optional CLI) to trigger evaluation and return a summary.
4. Add seeded CDM/signal fixtures and tests covering work/doc signals and idempotent instance upserts.
5. Document the DSL/evaluator behaviour and sync run artifacts before handoff.
