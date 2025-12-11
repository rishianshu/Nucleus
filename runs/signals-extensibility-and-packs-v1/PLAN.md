Plan for signals-extensibility-and-packs-v1 (current run):
- Extend SignalDefinition schema/types with implMode, sourceFamily, surfaceHints + migrations.
- Add evaluator registry keyed by spec.type and widen DSL for cdm.generic.filter.
- Implement cdm.generic.filter evaluation using paged CDM access and severity templating.
- Seed Jira and Confluence DSL signal packs and cover with tests.
- Refresh docs on impl modes/DSL/packs and validate (targeted checks, then ci-check if time permits).
