"""Schema drift and snapshot utilities shared across ingestion runtimes."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional


@dataclass
class SchemaSnapshotColumn:
    name: str
    data_type: Any
    nullable: bool = True
    precision: Optional[Any] = None
    scale: Optional[Any] = None
    raw: Optional[Any] = None


@dataclass
class SchemaSnapshot:
    namespace: str
    entity: str
    columns: Dict[str, SchemaSnapshotColumn] = field(default_factory=dict)
    version: Optional[str] = None
    collected_at: Optional[Any] = None
    raw: Optional[Any] = None


@dataclass
class SchemaDriftResult:
    snapshot: Optional[SchemaSnapshot]
    new_columns: List[str] = field(default_factory=list)
    missing_columns: List[str] = field(default_factory=list)
    type_mismatches: List[Dict[str, Any]] = field(default_factory=list)


class SchemaValidationError(Exception):
    def __init__(self, message: str, result: Optional[SchemaDriftResult] = None) -> None:
        super().__init__(message)
        self.result = result


@dataclass
class SchemaDriftPolicy:
    require_snapshot: bool = False
    allow_new_columns: bool = True
    allow_missing_columns: bool = True
    allow_type_mismatch: bool = True

    @classmethod
    def from_config(cls, cfg: Optional[Mapping[str, Any]]) -> "SchemaDriftPolicy":
        cfg = cfg or {}
        return cls(
            require_snapshot=bool(cfg.get("require_snapshot", cfg.get("requireSnapshot", False))),
            allow_new_columns=bool(cfg.get("allow_new_columns", cfg.get("allowNewColumns", True))),
            allow_missing_columns=bool(cfg.get("allow_missing_columns", cfg.get("allowMissingColumns", True))),
            allow_type_mismatch=bool(cfg.get("allow_type_mismatch", cfg.get("allowTypeMismatch", True))),
        )

    def merge(self, override: Optional["SchemaDriftPolicy"]) -> "SchemaDriftPolicy":
        if override is None:
            return self
        return SchemaDriftPolicy(
            require_snapshot=override.require_snapshot if override.require_snapshot is not None else self.require_snapshot,
            allow_new_columns=override.allow_new_columns if override.allow_new_columns is not None else self.allow_new_columns,
            allow_missing_columns=override.allow_missing_columns
            if override.allow_missing_columns is not None
            else self.allow_missing_columns,
            allow_type_mismatch=override.allow_type_mismatch
            if override.allow_type_mismatch is not None
            else self.allow_type_mismatch,
        )

    def clone_with(
        self,
        *,
        require_snapshot: Optional[bool] = None,
        allow_new_columns: Optional[bool] = None,
        allow_missing_columns: Optional[bool] = None,
        allow_type_mismatch: Optional[bool] = None,
    ) -> "SchemaDriftPolicy":
        return SchemaDriftPolicy(
            require_snapshot=self.require_snapshot if require_snapshot is None else require_snapshot,
            allow_new_columns=self.allow_new_columns if allow_new_columns is None else allow_new_columns,
            allow_missing_columns=self.allow_missing_columns if allow_missing_columns is None else allow_missing_columns,
            allow_type_mismatch=self.allow_type_mismatch if allow_type_mismatch is None else allow_type_mismatch,
        )


class SchemaDriftValidator:
    def __init__(self, policy: Optional[SchemaDriftPolicy] = None) -> None:
        self.policy = policy or SchemaDriftPolicy()

    def validate(
        self,
        *,
        snapshot: Optional[SchemaSnapshot],
        dataframe_schema: Any,
        policy: Optional[SchemaDriftPolicy] = None,
    ) -> Optional[SchemaDriftResult]:
        active_policy = policy or self.policy
        if snapshot is None:
            if active_policy.require_snapshot:
                result = SchemaDriftResult(snapshot=None)
                raise SchemaValidationError("Metadata snapshot required but not found", result)
            return None

        observed_cols = _extract_dataframe_columns(dataframe_schema)
        snapshot_cols = snapshot.columns or {}

        new_columns = [name for name in observed_cols.keys() if name not in snapshot_cols]
        missing_columns = [name for name in snapshot_cols.keys() if name not in observed_cols]

        type_mismatches: List[Dict[str, Any]] = []
        for name, observed_type in observed_cols.items():
            if name not in snapshot_cols:
                continue
            expected_col = snapshot_cols[name]
            expected_type = str(expected_col.data_type).lower() if expected_col and expected_col.data_type else ""
            observed_type_str = str(observed_type).lower()
            if expected_type and not _types_equivalent(expected_type, observed_type_str):
                type_mismatches.append(
                    {"column": expected_col.name, "expected": expected_col.data_type, "observed": observed_type}
                )

        result = SchemaDriftResult(
            snapshot=snapshot,
            new_columns=new_columns,
            missing_columns=missing_columns,
            type_mismatches=type_mismatches,
        )

        if new_columns and not active_policy.allow_new_columns:
            raise SchemaValidationError("New columns not allowed", result)
        if missing_columns and not active_policy.allow_missing_columns:
            raise SchemaValidationError("Missing columns not allowed", result)
        if type_mismatches and not active_policy.allow_type_mismatch:
            raise SchemaValidationError("Type mismatches not allowed", result)

        return result


def build_schema_snapshot(schema: Any, *, namespace: str, entity: str, version: Optional[str] = None) -> SchemaSnapshot:
    columns: Dict[str, SchemaSnapshotColumn] = {}
    for field in _iter_fields(schema):
        columns[field.name.lower()] = SchemaSnapshotColumn(
            name=field.name,
            data_type=_simple_string(field.dataType),
            nullable=getattr(field, "nullable", True),
            raw=field,
        )
    return SchemaSnapshot(namespace=namespace, entity=entity, columns=columns, version=version, raw=schema)


def _extract_dataframe_columns(dataframe_schema: Any) -> Dict[str, str]:
    observed: Dict[str, str] = {}
    for field in _iter_fields(dataframe_schema):
        observed[field.name.lower()] = _simple_string(field.dataType)
    return observed


def _iter_fields(schema: Any) -> Iterable[Any]:
    fields = getattr(schema, "fields", None) or []
    for field in fields:
        yield field


def _simple_string(dtype: Any) -> str:
    if dtype is None:
        return ""
    if isinstance(dtype, str):
        return dtype
    if hasattr(dtype, "simpleString"):
        try:
            return str(dtype.simpleString())
        except Exception:
            pass
    return str(dtype)


def _types_equivalent(expected: str, observed: str) -> bool:
    exp = expected.lower().strip()
    obs = observed.lower().strip()
    numeric_aliases = ("number", "numeric", "decimal", "int", "integer", "bigint", "smallint", "double")
    string_aliases = ("string", "varchar", "varchar2", "text", "char")

    def classify(t: str) -> str:
        if any(t.startswith(alias) for alias in numeric_aliases):
            return "numeric"
        if any(t.startswith(alias) for alias in string_aliases):
            return "string"
        return t

    return exp == obs or classify(exp) == classify(obs)
