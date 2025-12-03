from __future__ import annotations

from typing import Any, Dict, List, Optional

from ingestion_models.endpoints import (
    EndpointCapabilityDescriptor,
    EndpointFieldDescriptor,
    EndpointFieldOption,
    EndpointProbingMethod,
    EndpointUnitDescriptor,
    IngestionCapableEndpoint,
    MetadataSubsystem,
)

from endpoint_service.endpoints.jdbc.jdbc import JdbcEndpoint
from endpoint_service.endpoints.postgres.metadata import PostgresMetadataSubsystem


class PostgresEndpoint(JdbcEndpoint, IngestionCapableEndpoint):
    """Postgres-specific JDBC source with metadata capabilities."""

    DIALECT = "postgres"
    DISPLAY_NAME = "PostgreSQL"
    VENDOR = "Postgres"
    DESCRIPTION = "Collect metadata from a PostgreSQL cluster via read-only credentials."
    DOMAIN = "database.postgres"
    DEFAULT_LABELS = ("postgres", "jdbc")
    DEFAULT_PORT = 5432
    DOCS_URL = "https://www.postgresql.org/docs/current/jdbc.html"
    AGENT_PROMPT = "Guide the user through connecting to PostgreSQL. Required fields: host, port, database, username, password. Offer help generating read-only roles."
    PROTOCOLS = ("jdbc", "postgresql")
    SAMPLE_CONFIG = {
        "driver": "postgresql",
        "sslMode": "prefer",
        "connectionTimeoutMs": 10000,
    }
    SUPPORTED_VERSIONS = ("11", "12", "13", "14", "15", "16")
    MIN_VERSION = "9.6"
    PROBING_METHODS = (
        EndpointProbingMethod(
            key="pg_setting_server_version",
            label="current_setting('server_version')",
            strategy="SQL",
            statement="SELECT current_setting('server_version') AS version",
            description="Queries server_version GUC via read-only SHOW privileges.",
        ),
        EndpointProbingMethod(
            key="pg_version_function",
            label="SELECT version()",
            strategy="SQL",
            statement="SELECT version() AS version",
            description="Fallback probe that parses the PostgreSQL banner.",
        ),
    )
    PROBING_FALLBACK_MESSAGE = "If both probes fail, capture SELECT version() output manually or provide the server_version parameter."

    def __init__(
        self,
        tool,
        jdbc_cfg: Dict[str, Any],
        table_cfg: Dict[str, Any],
        metadata_access=None,
        emitter=None,
    ) -> None:
        super().__init__(tool, jdbc_cfg, table_cfg, metadata_access=metadata_access, emitter=emitter)
        self._caps.supports_metadata = True
        self._metadata = PostgresMetadataSubsystem(self)  # type: ignore[call-arg]

    def _literal(self, value: str) -> str:
        safe = value.replace("'", "''")
        return f"'{safe}'"

    def _count_query(self, lower: str, upper: Optional[str]) -> str:
        col = self.incremental_column
        base = self.base_from_sql
        col_identifier = self._column_identifier(col) if col else None
        if not col_identifier:
            raise ValueError("incremental column required for count query")
        predicates = [f"{col_identifier} > {self._literal(lower)}"]
        if upper is not None:
            predicates.append(f"{col_identifier} <= {self._literal(upper)}")
        predicate_sql = " AND ".join(predicates)
        return f"(SELECT COUNT(1) AS CNT FROM {base} WHERE {predicate_sql}) c"

    def metadata_subsystem(self) -> MetadataSubsystem:
        return self._metadata

    def list_units(
        self,
        *,
        checkpoint: Optional[Dict[str, Any]] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[EndpointUnitDescriptor]:
        # Keep schema/table sourced from a single config to avoid mixed identifiers.
        if self.table_cfg.get("schema") or self.table_cfg.get("table"):
            schema = (self.table_cfg.get("schema") or "")
            table = (self.table_cfg.get("table") or "unknown")
        else:
            schema = (self.jdbc_cfg.get("schema") or "public")
            table = (self.jdbc_cfg.get("table") or "unknown")
        unit_id = f"{schema}.{table}"
        descriptor = EndpointUnitDescriptor(
            unit_id=unit_id,
            kind="dataset",
            display_name=f"{schema}.{table}",
            description=f"{self.DISPLAY_NAME} dataset {schema}.{table}",
            scope={"schema": schema, "table": table},
            supports_incremental=bool(self.capabilities().supports_incremental),
        )
        return [descriptor]

    @classmethod
    def descriptor_fields(cls):
        fields = list(super().descriptor_fields())
        fields.extend(
            [
                EndpointFieldDescriptor(
                    key="role",
                    label="Role",
                    value_type="STRING",
                    required=False,
                    advanced=True,
                    description="Optional role to SET ROLE after connecting.",
                ),
                EndpointFieldDescriptor(
                    key="ssl_mode",
                    label="SSL mode",
                    value_type="ENUM",
                    required=False,
                    default_value="prefer",
                    description="Matches libpq sslmode. Use verify-full for strict hostname validation.",
                    options=(
                        EndpointFieldOption("disable", "disable"),
                        EndpointFieldOption("allow", "allow"),
                        EndpointFieldOption("prefer", "prefer"),
                        EndpointFieldOption("require", "require"),
                        EndpointFieldOption("verify-ca", "verify-ca"),
                        EndpointFieldOption("verify-full", "verify-full"),
                    ),
                ),
                EndpointFieldDescriptor(
                    key="ssl_root_cert",
                    label="SSL root certificate",
                    value_type="STRING",
                    required=False,
                    semantic="FILE_PATH",
                    advanced=True,
                    visible_when={"ssl_mode": ("verify-ca", "verify-full")},
                    description="Absolute path to the CA certificate when using verify-ca or verify-full.",
                ),
                EndpointFieldDescriptor(
                    key="ssl_client_cert",
                    label="Client certificate",
                    value_type="STRING",
                    required=False,
                    semantic="FILE_PATH",
                    advanced=True,
                    visible_when={"ssl_mode": ("require", "verify-ca", "verify-full")},
                    description="Path to client certificate when mutual TLS is required.",
                ),
                EndpointFieldDescriptor(
                    key="ssl_client_key",
                    label="Client private key",
                    value_type="STRING",
                    required=False,
                    semantic="FILE_PATH",
                    sensitive=True,
                    advanced=True,
                    visible_when={"ssl_mode": ("require", "verify-ca", "verify-full")},
                    description="Path to the private key that pairs with the client certificate.",
                ),
                EndpointFieldDescriptor(
                    key="application_name",
                    label="Application name",
                    value_type="STRING",
                    required=False,
                    advanced=True,
                    description="Sets application_name for audit visibility.",
                ),
                EndpointFieldDescriptor(
                    key="connect_timeout_ms",
                    label="Connect timeout (ms)",
                    value_type="NUMBER",
                    required=False,
                    advanced=True,
                    description="Overrides the default JDBC connectTimeout in milliseconds.",
                ),
                EndpointFieldDescriptor(
                    key="statement_timeout_ms",
                    label="Statement timeout (ms)",
                    value_type="NUMBER",
                    required=False,
                    advanced=True,
                    description="Optional timeout enforced via SET statement_timeout after connect.",
                ),
                EndpointFieldDescriptor(
                    key="additional_parameters",
                    label="Additional JDBC parameters",
                    value_type="JSON",
                    required=False,
                    advanced=True,
                    description="JSON map of extra driver parameters (e.g., \"targetServerType\":\"primary\").",
                ),
            ],
        )
        return tuple(fields)

    @classmethod
    def jdbc_driver_name(cls) -> Optional[str]:
        return "org.postgresql.Driver"

    @classmethod
    def connection_template(cls) -> str:
        return "postgresql://{username}:{password}@{host}:{port}/{database}"

    @classmethod
    def descriptor_capabilities(cls):
        base_caps = list(super().descriptor_capabilities())
        base_caps.append(
            EndpointCapabilityDescriptor(
                key="metadata",
                label="Catalog metadata",
                description="Supports metadata harvesting via Postgres adapters.",
            ),
        )
        base_caps.append(
            EndpointCapabilityDescriptor(
                key="preview",
                label="Live preview",
                description="Supports limited SELECT ... LIMIT queries for previewing datasets.",
            )
        )
        base_caps.append(
            EndpointCapabilityDescriptor(
                key="profiles",
                label="Column profiles",
                description="Computes column statistics via Postgres aggregate queries.",
            )
        )
        return tuple(base_caps)
