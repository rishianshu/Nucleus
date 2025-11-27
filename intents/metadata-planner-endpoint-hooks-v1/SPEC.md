### `SPEC.md`

````markdown
# SPEC — Metadata planner endpoint hooks v1

## Problem

The current planner (`metadata_service/planning.py`) decides metadata jobs via:

- resolving `templateId` → endpoint class,
- checking `descriptor.family`:
  - if HTTP → `_plan_http_endpoint_jobs` (effectively Jira-only),
  - else → `_plan_jdbc_metadata_jobs` for all others.

This means:

- HTTP code is Jira-specific but lives in a generic module,
- JDBC is treated as a global default (even for non-JDBC endpoints),
- endpoints/subsystems cannot fully own their metadata planning.

We want a planner that:

- asks endpoints/subsystems “Do you know how to plan metadata jobs?”,
- uses JDBC helpers only when a JDBC endpoint explicitly opts in,
- never assumes a fallback if the endpoint does not implement planning.

## Interfaces / Contracts

### 1. Subsystem hooks

Extend the metadata subsystem protocol with two optional hooks:

```python
@dataclass
class MetadataConfigValidationResult:
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    normalized_parameters: dict = field(default_factory=dict)

class MetadataSubsystem(Protocol):
    def validate_metadata_config(
        self,
        *,
        parameters: dict,
    ) -> MetadataConfigValidationResult:
        ...

    def plan_metadata_jobs(
        self,
        *,
        parameters: dict,
        request: Any,
        logger: Any,
    ) -> MetadataPlanningResult:
        ...
````

* `validate_metadata_config`:

  * Checks required fields, formats, and consistency for a given endpoint config.
  * May enrich/normalize `parameters` (e.g., infer `base_url` from `connectionUrl`).
  * Returns `ok=False` and error messages if config is unusable.

* `plan_metadata_jobs`:

  * Given validated parameters and the collection request, returns a `MetadataPlanningResult` (jobs + cleanup callbacks).
  * Can be a thin wrapper around helpers like `_plan_jdbc_metadata_jobs` for JDBC endpoints.

Endpoints that don’t need special logic can skip these hooks; the planner will handle that.

### 2. Planner behavior

Refactor `plan_metadata_jobs(request, logger)` so that it:

1. Extracts `config` and `parameters` from the request (as it does today).

2. Resolves `templateId` and endpoint class via `get_endpoint_class`.

3. Instantiates an endpoint instance (if possible) and obtains its metadata subsystem:

   ```python
   endpoint = endpoint_cls(tool=None, endpoint_cfg=parameters, table_cfg=None)
   subsystem_factory = getattr(endpoint, "metadata_subsystem", None)
   subsystem = subsystem_factory() if callable(subsystem_factory) else subsystem_factory
   ```

4. If a subsystem exists:

   * If it has `validate_metadata_config`:

     * call it; if `ok is False`, log and return `MetadataPlanningResult(jobs=[])`.
     * otherwise, pass `normalized_parameters` forward.
   * If it has `plan_metadata_jobs`:

     * call it and return the resulting `MetadataPlanningResult`.

5. If there is no subsystem or no `plan_metadata_jobs` hook:

   * Log an event like `metadata_planning_unsupported` with endpoint/template info.
   * Return `MetadataPlanningResult(jobs=[])`.

6. Remove `_plan_http_endpoint_jobs` and `_discover_datasets` from `planning.py`; Jira (or similar endpoints) must implement their planning inside their metadata subsystem using the new hooks.

7. Keep `_plan_jdbc_metadata_jobs` unchanged as a helper function that JDBC subsystems can call from their `plan_metadata_jobs` implementation if they want generic information_schema scanning.

This removes any implicit JDBC fallback: the planner never calls `_plan_jdbc_metadata_jobs` directly.

### 3. Jira metadata subsystem

Update the Jira metadata subsystem to:

* implement `validate_metadata_config`:

  * verify required keys like `base_url`, auth type, and any Jira-specific setup;
  * normalize parameters (e.g., fallback to `connectionUrl` for base_url if needed);
* implement `plan_metadata_jobs`:

  * use its own dataset definitions (already present in Jira metadata HLD/LLD) to:

    * decide which datasets to collect,
    * build `table_cfg` artifacts (schema/table names),
    * instantiate Jira endpoints,
    * create corresponding `MetadataJob`s.

This replaces the current `_plan_http_endpoint_jobs` + `_discover_datasets` logic.

### 4. JDBC endpoints

For JDBC endpoints that want generic planning:

* add a metadata subsystem (or endpoint classmethod) that:

  ```python
  def plan_metadata_jobs(self, *, parameters, request, logger) -> MetadataPlanningResult:
      return _plan_jdbc_metadata_jobs(parameters, request, logger)
  ```

Endpoints that do not implement this hook will simply not participate in metadata collection.

## Data & State

* No schema changes.
* `MetadataPlanningResult` remains unchanged.
* The set of jobs planned for existing endpoints (Jira, standard JDBC) must remain equivalent to current behavior.

## Acceptance Mapping

* AC1 → planner no longer has HTTP vs JDBC branching; it only calls subsystem hooks and returns empty when unsupported.
* AC2 → Jira metadata subsystem implements `validate_metadata_config` and `plan_metadata_jobs`; no Jira-specific logic remains in `planning.py`.
* AC3 → a JDBC endpoint with a metadata subsystem that calls `_plan_jdbc_metadata_jobs` still produces the same metadata jobs as before.
* AC4 → when an endpoint lacks a planning hook, planner logs `metadata_planning_unsupported` and returns no jobs (no fallback to JDBC).

## Risks / Open Questions

* R1: Endpoint instantiation for planning must not trigger heavy side effects (network calls, etc.); ensure constructors remain cheap.
* R2: We must be careful about circular imports between `planning.py` and endpoint/subsystem modules.
* Q1: Do we need a shared base class or mixin for metadata subsystems to avoid repeated boilerplate for `validate_metadata_config`?

````

---

