# Story — signals-evaluator-scaling-v1

- 2025-12-11T09:23Z | Refactored the signals evaluator to stream CDM work/doc rows page-by-page, added SignalStore paging for full reconciliation (no 200-instance cap), hardened skips/error isolation, expanded signal/store tests, and documented the scaling behaviour; signal tests initially blocked by tsx IPC permissions.
- 2025-12-11T13:27Z | Fixed SignalStore paging mock and definition cdmModel alignment; `pnpm --filter @apps/metadata-api test:signals` now passes and scaling evaluator is complete.
