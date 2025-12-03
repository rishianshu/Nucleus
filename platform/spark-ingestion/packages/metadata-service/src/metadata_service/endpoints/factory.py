from __future__ import annotations

from typing import Any, Dict, Tuple

from endpoint_service.query.plan import QueryPlan, QueryResult, SelectItem

from ingestion_models.endpoints import SinkEndpoint, SourceEndpoint, SupportsQueryExecution
from metadata_service.endpoints.registry import build_endpoint
from endpoint_service.endpoints.hdfs import HdfsParquetEndpoint


class HiveQueryEndpoint(SupportsQueryExecution):
    def __init__(self, spark, table_name: str) -> None:
        self.spark = spark
        self.table_name = table_name

    def execute_query_plan(self, plan: QueryPlan) -> QueryResult:
        selects = plan.selects or (SelectItem(expression="*"),)
        select_clause = ", ".join(sel.render() for sel in selects)
        where_clause = ""
        if plan.filters:
            where_clause = " WHERE " + " AND ".join(f"({expr})" for expr in plan.filters)
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
        sql = f"SELECT {select_clause} FROM {self.table_name}{where_clause}{group_clause}{having_clause}{order_clause}{limit_clause}"
        rows = [row.asDict(recursive=True) for row in self.spark.sql(sql).collect()]
        return QueryResult.from_records(rows)


class EndpointFactory:
    """Construct source/sink endpoints based on table configuration."""

    @staticmethod
    def build_source(
        cfg: Dict[str, Any],
        table_cfg: Dict[str, Any],
        tool,
        metadata=None,
        emitter=None,
    ) -> SourceEndpoint:
        if tool is None:
            raise ValueError("Execution tool required for source endpoint")
        jdbc_cfg = cfg.get("jdbc", {})
        dialect = (jdbc_cfg.get("dialect") or table_cfg.get("dialect") or "generic").lower()
        template_id = f"jdbc.{dialect}"
        endpoint_cfg = jdbc_cfg if isinstance(jdbc_cfg, dict) else {}
        endpoint = build_endpoint(template_id, tool=tool, endpoint_cfg=endpoint_cfg, table_cfg=table_cfg)
        if metadata is not None:
            setattr(endpoint, "metadata_access", metadata)
        if emitter is not None:
            setattr(endpoint, "emitter", emitter)
        return endpoint

    @staticmethod
    def build_sink(
        tool,
        cfg: Dict[str, Any],
        table_cfg: Dict[str, Any],
    ) -> SinkEndpoint:
        spark = getattr(tool, "spark", None)
        if spark is None:
            raise ValueError("Execution tool must expose a Spark session for HDFS sinks")
        endpoint_cfg = cfg.get("hdfs", {}) if isinstance(cfg, dict) else {}
        table_cfg = dict(table_cfg)
        table_cfg.setdefault("runtime", cfg.get("runtime") if isinstance(cfg, dict) else None)
        return build_endpoint("hdfs.parquet", tool=spark, endpoint_cfg=endpoint_cfg, table_cfg=table_cfg)

    @staticmethod
    def build_query_endpoint(
        tool,
        cfg: Dict[str, Any],
        table_cfg: Dict[str, Any],
        metadata=None,
        emitter=None,
        prefer_sink: bool = True,
    ) -> SupportsQueryExecution | None:
        mode = table_cfg.get("mode", "scd1").lower()
        spark = getattr(tool, "spark", None)
        if spark is not None:
            if mode == "full":
                hive_cfg = cfg.get("runtime", {}).get("hive", {})
                if hive_cfg.get("enabled", False):
                    db = hive_cfg.get("db")
                    tbl = f"{table_cfg['schema']}__{table_cfg['table']}"
                    table_name = f"{db}.{tbl}" if db else tbl
                    return HiveQueryEndpoint(spark, table_name)
            if prefer_sink:
                endpoint = EndpointFactory.build_sink(tool, cfg, table_cfg)
                if isinstance(endpoint, SupportsQueryExecution):
                    return endpoint
        try:
            endpoint = EndpointFactory.build_source(cfg, table_cfg, tool, metadata=metadata, emitter=emitter)
        except Exception:
            return None
        return endpoint if isinstance(endpoint, SupportsQueryExecution) else None

    @staticmethod
    def build_endpoints(
        tool,
        cfg: Dict[str, Any],
        table_cfg: Dict[str, Any],
        metadata=None,
        emitter=None,
    ) -> Tuple[SourceEndpoint, SinkEndpoint]:
        return (
            EndpointFactory.build_source(cfg, table_cfg, tool, metadata=metadata, emitter=emitter),
            EndpointFactory.build_sink(tool, cfg, table_cfg),
        )
