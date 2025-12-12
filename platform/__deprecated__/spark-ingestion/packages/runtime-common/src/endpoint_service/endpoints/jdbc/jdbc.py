from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
from urllib.parse import urlparse
import re
from typing import Any, Dict, List, Optional, Tuple, cast

from endpoint_service.tools.base import ExecutionTool, QueryRequest
from endpoint_service.tools.sqlalchemy import SQLAlchemyTool
from ingestion_models.endpoints import (
    EndpointCapabilities,
    EndpointCapabilityDescriptor,
    EndpointConnectionResult,
    EndpointConnectionTemplate,
    EndpointDescriptor,
    EndpointFieldDescriptor,
    EndpointFieldOption,
    EndpointProbingMethod,
    EndpointProbingPlan,
    EndpointTestResult,
    MetadataCapableEndpoint,
    SourceEndpoint,
    SupportsPreview,
    SupportsQueryExecution,
    IngestionCapableEndpoint,
    EndpointUnitDescriptor,
    IngestionPlan,
    IngestionSlice,
    SupportsIncrementalPlanning,
    QueryPlan as QueryPlanContract,
    QueryResult as QueryResultContract,
)
from endpoint_service.query.plan import QueryPlan as QueryPlanModel, QueryResult as QueryResultModel, SelectItem
from ingestion_models.metadata import MetadataTarget


class JdbcEndpoint(
    MetadataCapableEndpoint,
    SupportsQueryExecution,
    SupportsPreview,
    SupportsIncrementalPlanning,
    IngestionCapableEndpoint,
):
    """Generic JDBC endpoint with dialect-specific subclasses."""

    DIALECT = "generic"
    DISPLAY_NAME = "JDBC source"
    VENDOR = "JDBC"
    DESCRIPTION = "Generic JDBC source"
    DOMAIN: Optional[str] = None
    DEFAULT_LABELS: Tuple[str, ...] = ("jdbc",)
    DEFAULT_PORT: Optional[int] = None
    DOCS_URL: Optional[str] = None
    AGENT_PROMPT: Optional[str] = None
    CATEGORIES: Tuple[str, ...] = ("warehouse", "lakehouse")
    PROTOCOLS: Tuple[str, ...] = ("jdbc",)
    SAMPLE_CONFIG: Optional[Dict[str, Any]] = None
    SUPPORTED_VERSIONS: Tuple[str, ...] = ()
    MIN_VERSION: Optional[str] = None
    MAX_VERSION: Optional[str] = None
    DESCRIPTOR_VERSION: str = "2.0"
    PROBING_METHODS: Tuple[EndpointProbingMethod, ...] = ()
    PROBING_FALLBACK_MESSAGE: Optional[str] = None

    def __init__(
        self,
        tool: Optional[ExecutionTool],
        jdbc_cfg: Dict[str, Any],
        table_cfg: Dict[str, Any],
        metadata_access=None,
        emitter=None,
    ) -> None:
        self.jdbc_cfg = self._hydrate_jdbc_cfg(dict(jdbc_cfg))
        self.table_cfg = dict(table_cfg)
        self.schema = table_cfg["schema"]
        self.table = table_cfg["table"]
        self.incremental_column = table_cfg.get("incremental_column")
        self.base_from_sql = self._build_from_sql()
        self.metadata_access = metadata_access
        self.emitter = emitter
        self.tool = tool or self._build_tool_from_cfg(self.jdbc_cfg)
        guardrail_cfg = (self.table_cfg.get("metadata_guardrails") or {}).get("precision")
        if not guardrail_cfg and metadata_access is not None:
            defaults = getattr(metadata_access, "guardrail_defaults", {}) or {}
            guardrail_cfg = defaults.get("precision")
        guardrail_cfg = guardrail_cfg or {}
        self._precision_guardrail_enabled = bool(guardrail_cfg.get("enabled", True))
        max_precision_cfg = guardrail_cfg.get("max_precision")
        try:
            self._precision_guardrail_max = int(max_precision_cfg) if max_precision_cfg is not None else None
        except (TypeError, ValueError):
            self._precision_guardrail_max = None
        violation_action = str(guardrail_cfg.get("violation_action", "downcast")).lower()
        self._precision_guardrail_violation_action = violation_action if violation_action in {"downcast", "fail"} else "downcast"
        open_action = str(guardrail_cfg.get("open_precision_action", self._precision_guardrail_violation_action)).lower()
        self._precision_guardrail_open_action = open_action if open_action in {"downcast", "fail"} else self._precision_guardrail_violation_action
        fallback_scale_cfg = guardrail_cfg.get("fallback_scale")
        try:
            self._precision_guardrail_fallback_scale = int(fallback_scale_cfg) if fallback_scale_cfg is not None else None
        except (TypeError, ValueError):
            self._precision_guardrail_fallback_scale = None
        fallback_precision_cfg = guardrail_cfg.get("fallback_precision")
        try:
            self._precision_guardrail_fallback_precision = int(fallback_precision_cfg) if fallback_precision_cfg is not None else None
        except (TypeError, ValueError):
            self._precision_guardrail_fallback_precision = None
        self._caps = EndpointCapabilities(
            supports_full=True,
            supports_incremental=bool(self.incremental_column),
            supports_count_probe=True,
            supports_preview=True,
            incremental_literal=(table_cfg.get("incr_col_type") or "timestamp").lower(),
            default_fetchsize=int(jdbc_cfg.get("fetchsize", 10000)),
        )

    # --- SourceEndpoint protocol -------------------------------------------------
    def configure(self, table_cfg: Dict[str, Any]) -> None:  # pragma: no cover
        self.table_cfg.update(table_cfg)
        self.base_from_sql = self._build_from_sql()

    def capabilities(self) -> EndpointCapabilities:
        return self._caps

    def describe(self) -> Dict[str, Any]:
        return {
            "dialect": self.jdbc_cfg.get("dialect", self.DIALECT),
            "schema": self.schema,
            "table": self.table,
            "incremental_column": self.incremental_column,
            "caps": self._caps,
        }

    def read_full(self) -> Any:
        projection = self._projection_sql()
        predicates = self._source_filters()
        dbtable = self._select_from_base(projection, predicates)
        options = self._jdbc_options(dbtable=dbtable)
        partition = self._partition_options()
        request = QueryRequest(format="jdbc", options=options, partition_options=partition)
        return self.tool.query(request)

    def read_slice(self, *, lower: Optional[str], upper: Optional[str]) -> Any:
        if lower is None:
            raise ValueError("lower bound is required for incremental reads")
        dbtable = self._dbtable_for_range(lower, upper)
        options = self._jdbc_options(dbtable=dbtable)
        partition = self._partition_options()
        request = QueryRequest(format="jdbc", options=options, partition_options=partition)
        return self.tool.query(request)

    def count_between(self, *, lower: str, upper: Optional[str]) -> int:
        query = self._count_query(lower, upper)
        options = self._jdbc_options(dbtable=query)
        options["fetchsize"] = 1
        request = QueryRequest(format="jdbc", options=options, partition_options=None)
        return int(self.tool.query_scalar(request))

    def execute_query_plan(self, plan: QueryPlanContract, *, fetchsize_override: Optional[int] = None) -> QueryResultContract:
        selects = plan.selects or (SelectItem(expression="*"),)
        select_clause = ", ".join(sel.render() for sel in selects)
        source_sql = plan.source or self.base_from_sql
        predicates = list(self._source_filters())
        predicates.extend(plan.filters)
        where_clause = ""
        if predicates:
            where_clause = " WHERE " + " AND ".join(f"({expr})" for expr in predicates)
        group_clause = ""
        if plan.group_by:
            group_clause = " GROUP BY " + ", ".join(plan.group_by)
        having_clause = ""
        if plan.having:
            having_clause = " HAVING " + " AND ".join(f"({expr})" for expr in plan.having)
        order_clause = ""
        if plan.order_by:
            order_clause = " ORDER BY " + ", ".join(order.render() for order in plan.order_by)
        limit_clause = ""
        if plan.limit is not None:
            limit_clause = f" LIMIT {int(plan.limit)}"
        sql_core = f"SELECT {select_clause} FROM {source_sql}{where_clause}{group_clause}{having_clause}{order_clause}{limit_clause}"
        execute_sql = getattr(self.tool, "execute_sql", None)
        if callable(execute_sql):
            records = execute_sql(sql_core)
            return QueryResultModel.from_records(records)
        wrapped = f"({sql_core}) q"
        options = self._jdbc_options(dbtable=wrapped)
        if fetchsize_override is not None:
            try:
                options["fetchsize"] = int(fetchsize_override)
            except (TypeError, ValueError):
                pass
        options["fetchsize"] = max(1, int(options.get("fetchsize", self._caps.default_fetchsize)))
        request = QueryRequest(format="jdbc", options=options, partition_options=None)
        df = self.tool.query(request)
        rows = [row.asDict(recursive=True) for row in df.collect()]
        return QueryResultModel.from_records(rows)

    # --- Descriptor & testing --------------------------------------------------

    @classmethod
    def descriptor(cls) -> EndpointDescriptor:
        return EndpointDescriptor(
            id=f"jdbc.{cls.DIALECT}",
            family="JDBC",
            title=cls.DISPLAY_NAME or cls.DIALECT.upper(),
            vendor=cls.VENDOR or "JDBC",
            description=cls.DESCRIPTION,
            domain=cls.DOMAIN,
            categories=cls.CATEGORIES,
            protocols=cls.PROTOCOLS,
            versions=cls.SUPPORTED_VERSIONS,
            min_version=cls.MIN_VERSION,
            max_version=cls.MAX_VERSION,
            default_port=cls.DEFAULT_PORT,
            driver=cls.jdbc_driver_name(),
            docs_url=cls.DOCS_URL,
            agent_prompt=cls.AGENT_PROMPT,
            default_labels=cls.DEFAULT_LABELS,
            fields=cls.descriptor_fields(),
            capabilities=cls.descriptor_capabilities(),
            sample_config=cls.SAMPLE_CONFIG,
            connection=EndpointConnectionTemplate(
                url_template=cls.connection_template(),
                default_verb="POST",
            ),
            descriptor_version=cls.DESCRIPTOR_VERSION,
            probing=cls.probing_plan(),
        )

    @classmethod
    def descriptor_fields(cls) -> Tuple[EndpointFieldDescriptor, ...]:
        return (
            EndpointFieldDescriptor(key="host", label="Host", value_type="HOSTNAME", semantic="HOST", placeholder="db.example.com"),
            EndpointFieldDescriptor(key="port", label="Port", value_type="PORT", semantic="PORT", placeholder=str(cls.DEFAULT_PORT or 5432)),
            EndpointFieldDescriptor(key="database", label="Database", value_type="STRING", semantic="DATABASE", placeholder="analytics"),
            EndpointFieldDescriptor(key="username", label="Username", value_type="STRING", semantic="USERNAME"),
            EndpointFieldDescriptor(key="password", label="Password", value_type="PASSWORD", semantic="PASSWORD"),
            EndpointFieldDescriptor(
                key="schemas",
                label="Schemas",
                value_type="LIST",
                required=False,
                semantic="SCHEMA",
                description="Comma-separated list of schemas to crawl. Leave blank to include all.",
                placeholder="public",
            ),
            EndpointFieldDescriptor(
                key="version_hint",
                label="Version hint",
                value_type="STRING",
                required=False,
                advanced=True,
                description="Provide the known server version (e.g., 15.3, 19c) if automatic detection is unavailable.",
            ),
        )

    @classmethod
    def descriptor_capabilities(cls) -> Tuple[EndpointCapabilityDescriptor, ...]:
        return (
            EndpointCapabilityDescriptor(key="tables", label="Tables & views", description="Discovers table/view names, owners, storage stats."),
            EndpointCapabilityDescriptor(key="columns", label="Column metadata", description="Data types, nullability, default expressions."),
            EndpointCapabilityDescriptor(key="dependencies", label="Foreign keys", description="Extracts FK relationships for lineage overlays."),
            EndpointCapabilityDescriptor(key="preview", label="Live preview", description="Supports sampling queries via read-only sessions."),
        )

    @classmethod
    def jdbc_driver_name(cls) -> Optional[str]:
        return None

    @classmethod
    def connection_template(cls) -> str:
        return f"jdbc:{cls.DIALECT}://{{host}}:{{port}}/{{database}}"

    @classmethod
    def probing_plan(cls) -> Optional[EndpointProbingPlan]:
        if not cls.PROBING_METHODS:
            return None
        return EndpointProbingPlan(methods=cls.PROBING_METHODS, fallback_message=cls.PROBING_FALLBACK_MESSAGE)

    @classmethod
    def build_connection(cls, parameters: Dict[str, str]) -> EndpointConnectionResult:
        normalized = cls._normalize_parameters(parameters)
        validation = cls.test_connection(normalized)
        if not validation.success:
            raise ValueError(validation.message or "Invalid parameters")
        descriptor = cls.descriptor()
        connection = descriptor.connection
        if not connection or not connection.url_template:
            raise ValueError(f"Endpoint {descriptor.id} is missing a connection template.")
        try:
            url = connection.url_template.format(**normalized)
        except KeyError as exc:
            raise ValueError(f"Missing field '{exc.args[0]}' for template {descriptor.id}") from exc
        config = {
            "templateId": descriptor.id,
            "parameters": normalized,
        }
        return EndpointConnectionResult(
            url=url,
            config=config,
            labels=descriptor.default_labels,
            domain=descriptor.domain,
            verb=connection.default_verb,
        )

    @classmethod
    def test_connection(cls, parameters: Dict[str, str]) -> EndpointTestResult:
        normalized = cls._normalize_parameters(parameters)
        missing = [field.key for field in cls.descriptor_fields() if field.required and not normalized.get(field.key)]
        if missing:
            return EndpointTestResult(False, f"Missing required fields: {', '.join(missing)}")
        return EndpointTestResult(True, "Connection parameters validated.")

    @classmethod
    def _normalize_parameters(cls, parameters: Dict[str, Any]) -> Dict[str, str]:
        return {key: "" if value is None else str(value).strip() for key, value in parameters.items()}

    # --- Helpers -----------------------------------------------------------------
    def _hydrate_jdbc_cfg(self, cfg: Dict[str, Any]) -> Dict[str, Any]:
        # Normalize user key
        if "user" not in cfg and "username" in cfg:
            cfg["user"] = cfg["username"]
        # Fill driver defaults by dialect
        if "driver" not in cfg or not cfg.get("driver"):
            driver_map = {
                "postgres": "org.postgresql.Driver",
                "postgresql": "org.postgresql.Driver",
                "mysql": "com.mysql.cj.jdbc.Driver",
                "mssql": "com.microsoft.sqlserver.jdbc.SQLServerDriver",
                "sqlserver": "com.microsoft.sqlserver.jdbc.SQLServerDriver",
                "oracle": "oracle.jdbc.OracleDriver",
            }
            dialect = (cfg.get("dialect") or self.DIALECT or "").lower()
            default_driver = driver_map.get(dialect)
            if default_driver:
                cfg["driver"] = default_driver
        # Build URL if missing
        if not cfg.get("url"):
            host = cfg.get("host")
            database = cfg.get("database")
            port = cfg.get("port") or self.DEFAULT_PORT or ""
            dialect = cfg.get("dialect") or self.DIALECT
            if host and database and dialect:
                cfg["url"] = f"jdbc:{dialect}://{host}:{port}/{database}"
        return cfg

    def _jdbc_options(self, *, dbtable: str) -> Dict[str, Any]:
        cfg = self.jdbc_cfg
        options = {
            "url": cfg["url"],
            "dbtable": dbtable,
            "user": cfg["user"],
            "password": cfg["password"],
            "driver": cfg["driver"],
            "fetchsize": int(cfg.get("fetchsize", self._caps.default_fetchsize)),
        }
        if cfg.get("trustServerCertificate"):
            options["trustServerCertificate"] = cfg["trustServerCertificate"]
        return options

    def _build_tool_from_cfg(self, cfg: Dict[str, Any]) -> ExecutionTool:
        url = cfg.get("url")
        if not url:
            raise ValueError("JDBC configuration is missing url")
        sa_url = str(url)
        if sa_url.startswith("jdbc:"):
            sa_url = sa_url[len("jdbc:") :]
            if sa_url.startswith("postgres:"):
                sa_url = "postgresql:" + sa_url[len("postgres:") :]
        # Ensure credentials are carried into the SQLAlchemy URL even when the JDBC URL omits them.
        user = cfg.get("user") or cfg.get("username")
        password = cfg.get("password")
        try:
            parsed = urlparse(sa_url)
        except Exception:
            parsed = None
        if parsed and user and not parsed.username:
            netloc = user
            if password:
                netloc = f"{netloc}:{password}"
            host = parsed.hostname or ""
            if host:
                netloc = f"{netloc}@{host}"
            port = parsed.port
            if port:
                netloc = f"{netloc}:{port}"
            sa_url = parsed._replace(netloc=netloc).geturl()
        runtime_cfg = {"runtime": {"sqlalchemy": {"url": sa_url}}}
        return SQLAlchemyTool.from_config(runtime_cfg)

    def _partition_options(self) -> Optional[Dict[str, Any]]:
        partition_cfg = self.table_cfg.get("partition_read")
        if not partition_cfg:
            return None
        return {
            "partitionColumn": partition_cfg["partitionColumn"],
            "lowerBound": str(partition_cfg["lowerBound"]),
            "upperBound": str(partition_cfg["upperBound"]),
            "numPartitions": str(partition_cfg.get("numPartitions", self.jdbc_cfg.get("default_num_partitions", 8))),
        }

    def _source_filters(self) -> List[str]:
        filt = self.table_cfg.get("source_filter")
        if filt is None:
            return []
        if isinstance(filt, str):
            return [filt] if filt.strip() else []
        if isinstance(filt, (list, tuple)):
            return [str(item) for item in filt if isinstance(item, str) and item.strip()]
        return []

    def _select_from_base(self, projection: str, predicates: List[str]) -> str:
        select_list = projection or "*"
        where_clause = ""
        if predicates:
            joined = " AND ".join(f"({entry})" for entry in predicates)
            where_clause = f" WHERE {joined}"
        return f"(SELECT {select_list} FROM {self.base_from_sql}{where_clause}) t"


    def _build_from_sql(self) -> str:
        query = self.table_cfg.get("query_sql")
        if query and query.strip():
            return f"({query}) q"
        return f"{self._quote_ident(self.schema)}.{self._quote_ident(self.table)}"

    def _quote_ident(self, ident: Optional[str]) -> str:
        if ident is None:
            return ""
        # Safe unquoted if purely lowercase alnum + underscore starting with letter/underscore
        if re.fullmatch(r"[a-z_][a-z0-9_]*", ident):
            return ident
        escaped = ident.replace('"', '""')
        return f'"{escaped}"'

    def _count_query(self, lower: str, upper: Optional[str]) -> str:
        col = self.incremental_column
        base = self.base_from_sql
        col_identifier = self._column_identifier(col) if col else None
        if not col_identifier:
            raise ValueError("incremental column required for count query")
        predicates = [f"{col_identifier} > {self._literal(lower)}"]
        if upper is not None:
            predicates.append(f"{col_identifier} <= {self._literal(upper)}")
        predicates.extend(self._source_filters())
        where_clause = " AND ".join(f"({entry})" for entry in predicates)
        return f"(SELECT COUNT(1) AS CNT FROM {base} WHERE {where_clause}) c"

    def _dbtable_for_range(self, lower: str, upper: Optional[str]) -> str:
        col = self.incremental_column
        col_identifier = self._column_identifier(col) if col else None
        if not col_identifier:
            raise ValueError("incremental column required for range query")
        predicates = [f"{col_identifier} > {self._literal(lower)}"]
        if upper is not None:
            predicates.append(f"{col_identifier} <= {self._literal(upper)}")
        predicates.extend(self._source_filters())
        projection = self._projection_sql()
        return self._select_from_base(projection, predicates)

    def _projection_sql(self) -> str:
        guardrail_projection = self._precision_guardrail_projection()
        if guardrail_projection:
            return guardrail_projection
        return self._default_projection()

    def _default_projection(self) -> str:
        cols = self.table_cfg.get("cols", "*")
        if isinstance(cols, list):
            return ", ".join(cols)
        if isinstance(cols, str):
            return cols
        return "*"

    def _precision_guardrail_projection(self) -> Optional[str]:
        if not self._precision_guardrail_enabled:
            return None
        access = getattr(self, "metadata_access", None)
        guardrail = getattr(access, "precision_guardrail", None) if access else None
        if guardrail is None:
            return None
        source_id = self.table_cfg.get("endpoint_id") or self.table_cfg.get("source_id") or "jdbc_endpoint"
        target = MetadataTarget(source_id=source_id, namespace=self.schema.upper(), entity=self.table.upper())
        result = guardrail.evaluate(
            target,
            max_precision=self._precision_guardrail_max,
            violation_action=self._precision_guardrail_violation_action,
            open_precision_action=self._precision_guardrail_open_action,
            fallback_precision=self._precision_guardrail_fallback_precision,
            fallback_scale=self._precision_guardrail_fallback_scale,
        )
        if result.status in {"metadata_missing", "metadata_unusable"}:
            return None
        if self.emitter and result.status in {"adjusted", "fatal"}:
            from ..events.types import Event, EventCategory, EventType

            details = {
                "schema": self.schema,
                "table": self.table,
                "status": result.status,
                "issues": [asdict(issue) for issue in result.issues],
                "cast_specs": {name: asdict(spec) for name, spec in result.cast_specs.items()},
                "config": {
                    "max_precision": self._precision_guardrail_max,
                    "violation_action": self._precision_guardrail_violation_action,
                    "open_precision_action": self._precision_guardrail_open_action,
                },
            }
            self.emitter.emit(Event(category=EventCategory.GUARDRAIL, type=EventType.GUARDRAIL_PRECISION, payload=details))
        if result.status == "fatal":
            issues = "; ".join(f"{issue.column}: {issue.reason}" for issue in result.issues if not issue.handled)
            raise ValueError(
                f"precision_guardrail_violations for {self.schema}.{self.table}: {issues}"
            )
        cast_specs = result.cast_specs
        if not cast_specs:
            return None
        columns = self._guardrail_column_list(result)
        if not columns:
            return None
        rendered = [self._render_guardrail_column(col, cast_specs) for col in columns]
        if not rendered:
            return None
        return ", ".join(rendered)

    def _guardrail_column_list(self, result) -> Optional[List[str]]:
        cols_cfg = self.table_cfg.get("cols", "*")
        if isinstance(cols_cfg, list) and cols_cfg:
            return cols_cfg
        if isinstance(cols_cfg, str) and cols_cfg.strip() and cols_cfg.strip() != "*":
            return [name.strip() for name in cols_cfg.split(",") if name.strip()]
        snapshot = result.snapshot or {}
        fields = snapshot.get("schema_fields") if isinstance(snapshot, dict) else None
        if not isinstance(fields, list):
            return None
        names = []
        for field in fields:
            if isinstance(field, dict):
                name = field.get("name")
            else:
                name = getattr(field, "name", None)
            if name:
                names.append(name)
        return names or None

    def _render_guardrail_column(self, column: str, cast_specs: Dict[str, Any]) -> str:
        key = column.upper()
        spec = cast_specs.get(key)
        identifier = self._column_identifier(column)
        if spec:
            target_type = getattr(spec, "target_type", None)
            if target_type is None and isinstance(spec, dict):
                target_type = spec.get("target_type")
            if target_type and str(target_type).lower() == "string":
                return self._cast_to_string(identifier, column, spec)
            precision_value = getattr(spec, "precision", None)
            if precision_value is None and isinstance(spec, dict):
                precision_value = spec.get("precision")
            if precision_value is not None:
                return self._cast_expression(identifier, column, spec)
        return identifier

    def _column_identifier(self, column: str) -> str:
        return column

    def _column_alias(self, column: str) -> str:
        return self._column_identifier(column)

    def _cast_expression(self, identifier: str, column: str, spec) -> str:
        precision = getattr(spec, "precision", None)
        scale = getattr(spec, "scale", None)
        if precision is None and isinstance(spec, dict):
            precision = spec.get("precision")
        if scale is None and isinstance(spec, dict):
            scale = spec.get("scale")
        if precision is None:
            return identifier
        type_keyword = self._cast_type_keyword()
        scale_value = scale if scale is not None else 0
        alias = self._column_alias(column)
        return f"CAST({identifier} AS {type_keyword}({precision},{scale_value})) AS {alias}"

    def _cast_type_keyword(self) -> str:
        return "DECIMAL"

    def _cast_to_string(self, identifier: str, column: str, spec) -> str:
        alias = self._column_alias(column)
        return f"CAST({identifier} AS {self._string_cast_type()}) AS {alias}"

    def _string_cast_type(self) -> str:
        return "VARCHAR(4000)"

    def _literal(self, value: str) -> str:
        return f"'{value}'"

    # --- Preview support -------------------------------------------------------
    def preview(
        self,
        *,
        unit_id: Optional[str] = None,
        limit: int = 50,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        plan_filters = list(self._source_filters())
        extra_filters = []
        if isinstance(filters, dict):
            custom = filters.get("where") or filters.get("filter")
            if isinstance(custom, str) and custom.strip():
                extra_filters.append(custom.strip())
            if isinstance(filters.get("predicates"), (list, tuple)):
                extra_filters.extend(str(f).strip() for f in filters["predicates"] if str(f).strip())
        plan_filters.extend(extra_filters)
        plan = QueryPlanModel(
            selects=(SelectItem(expression="*"),),
            source=self.base_from_sql,
            filters=tuple(plan_filters),
            limit=max(1, min(int(limit), 500)),
        )
        result = self.execute_query_plan(cast(QueryPlanContract, plan))
        return result.to_dicts()

    # --- IngestionCapableEndpoint --------------------------------------------
    def list_units(
        self,
        *,
        checkpoint: Optional[Dict[str, Any]] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[EndpointUnitDescriptor]:
        return [
            EndpointUnitDescriptor(
                unit_id=f"{self.schema}.{self.table}",
                display_name=f"{self.schema}.{self.table}",
                supports_incremental=bool(self.incremental_column),
                ingestion_strategy="scd1" if self.incremental_column else "full",
                incremental_column=self.incremental_column,
                incremental_literal=self._caps.incremental_literal,
            )
        ]

    def plan_incremental_slices(
        self,
        *,
        unit: EndpointUnitDescriptor,
        checkpoint: Optional[Dict[str, Any]],
        policy: Optional[Dict[str, Any]] = None,
        target_slice_size: Optional[int] = None,
    ) -> IngestionPlan:
        last_wm = None
        if isinstance(checkpoint, dict):
            last_wm = checkpoint.get("watermark") or checkpoint.get("last_watermark") or checkpoint.get("cursor")
            if isinstance(last_wm, dict):
                last_wm = last_wm.get("watermark") or last_wm.get("last_watermark")
        literal = self._caps.incremental_literal or "timestamp"
        now = datetime.now(timezone.utc)
        now_lit = str(int(now.timestamp())) if literal in {"epoch", "epoch_seconds", "numeric"} else now.strftime("%Y-%m-%d %H:%M:%S")
        lower = str(last_wm) if last_wm is not None else None
        slices = [
            IngestionSlice(
                key=f"{unit.unit_id}:range:0",
                sequence=0,
                params={k: v for k, v in {"lower": lower, "upper": now_lit}.items() if v is not None},
                lower=lower,
                upper=now_lit,
            )
        ]
        statistics = {
            "incremental_column": self.incremental_column,
            "last_watermark": last_wm,
            "target_slice_size": target_slice_size,
        }
        return IngestionPlan(
            endpoint_id=self.table_cfg.get("endpoint_id") or "",
            unit_id=unit.unit_id,
            slices=slices,
            statistics=statistics,
            strategy="jdbc-range",
        )

    def run_ingestion_unit(
        self,
        unit_id: str,
        *,
        endpoint_id: str,
        policy: Dict[str, Any],
        checkpoint: Optional[Dict[str, Any]] = None,
        mode: Optional[str] = None,
        filter: Optional[Dict[str, Any]] = None,
        transient_state: Optional[Dict[str, Any]] = None,
    ) -> Any:
        slice_bounds = policy.get("slice") if isinstance(policy, dict) else None
        lower = None
        upper = None
        if isinstance(slice_bounds, dict):
            lower = slice_bounds.get("lower")
            upper = slice_bounds.get("upper")
        if lower is None and checkpoint and isinstance(checkpoint, dict):
            lower = checkpoint.get("watermark") or checkpoint.get("last_watermark")
        lower = lower or "0000-00-00 00:00:00"
        predicates: List[str] = []
        if self.incremental_column:
            col_identifier = self._column_identifier(self.incremental_column)
            predicates.append(f"{col_identifier} > {self._literal(lower)}")
            if upper is not None:
                predicates.append(f"{col_identifier} <= {self._literal(upper)}")
        extra_filters = []
        if isinstance(policy, dict):
            custom = policy.get("where") or policy.get("filter")
            if isinstance(custom, str) and custom.strip():
                extra_filters.append(custom.strip())
            if isinstance(policy.get("predicates"), (list, tuple)):
                extra_filters.extend(str(p).strip() for p in policy["predicates"] if str(p).strip())
        if isinstance(filter, dict):
            custom = filter.get("where") or filter.get("filter")
            if isinstance(custom, str) and custom.strip():
                extra_filters.append(custom.strip())
            if isinstance(filter.get("predicates"), (list, tuple)):
                extra_filters.extend(str(p).strip() for p in filter["predicates"] if str(p).strip())
        predicates.extend(extra_filters)

        order_by: List[Any] = []
        order_policy = None
        if isinstance(policy, dict):
            order_policy = policy.get("order_by") or policy.get("orderBy")
        if not order_policy and self.incremental_column:
            order_policy = [self.incremental_column]
        if isinstance(order_policy, str):
            order_policy = [order_policy]
        if isinstance(order_policy, (list, tuple)):
            from endpoint_service.query.plan import OrderItem

            for entry in order_policy:
                expr = str(entry)
                desc = False
                if expr.lower().endswith(" desc"):
                    desc = True
                    expr = expr[:-5].strip()
                order_by.append(OrderItem(expression=expr, descending=desc))

        limit_value: Optional[int] = None
        if isinstance(policy, dict) and policy.get("limit") is not None:
            raw_limit = policy.get("limit")
            try:
                limit_value = int(str(raw_limit))
            except (TypeError, ValueError):
                limit_value = None

        plan = QueryPlanModel(
            selects=(SelectItem(expression="*"),),
            source=self.base_from_sql,
            filters=tuple(predicates),
            order_by=tuple(order_by),
            limit=limit_value,
        )
        fetchsize_override: Optional[int] = None
        if isinstance(policy, dict) and policy.get("fetchsize") is not None:
            raw_fetch = policy.get("fetchsize")
            try:
                fetchsize_override = int(str(raw_fetch))
            except (TypeError, ValueError):
                fetchsize_override = None
        if mode and str(mode).upper() == "PREVIEW":
            # Enforce a small limit for preview if not explicitly set
            if limit_value is None:
                limit_value = 50

        result = self.execute_query_plan(cast(QueryPlanContract, plan), fetchsize_override=fetchsize_override)
        records = result.to_dicts()
        stats: Dict[str, Any] = {
            "unitId": unit_id,
            "endpointId": endpoint_id,
            "rows": len(records),
            "incremental": bool(self.incremental_column),
            "slice": slice_bounds,
        }
        watermark = upper or lower
        if watermark:
            stats["watermark"] = watermark
        return type(
            "JdbcIngestionResult",
            (),
            {
                "records": records,
                "stats": stats,
                "__dict__": {"records": records, "stats": stats},
            },
        )()
