# Metadata Service Package

Wraps metadata collection/runtime helpers so ingestion and reconciliation depend
on a dedicated package instead of internal modules. The implementation now lives
entirely under this package; the old shims have been removed.
