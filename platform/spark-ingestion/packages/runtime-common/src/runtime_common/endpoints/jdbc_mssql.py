from __future__ import annotations

from urllib.parse import quote_plus
from typing import Any, Dict, Optional

from .base import (
    EndpointCapabilityDescriptor,
    EndpointConnectionResult,
    EndpointFieldDescriptor,
    EndpointFieldOption,
    EndpointProbingMethod,
)
from .jdbc import JdbcEndpoint


class MSSQLEndpoint(JdbcEndpoint):
    """Microsoft SQL Server JDBC source."""

    DIALECT = "mssql"
    DISPLAY_NAME = "SQL Server"
    VENDOR = "Microsoft"
    DESCRIPTION = "Ingest data from Microsoft SQL Server via JDBC."
    DOMAIN = "database.mssql"
    DEFAULT_LABELS = ("mssql", "jdbc")
    DEFAULT_PORT = 1433
    DOCS_URL = "https://learn.microsoft.com/sql/connect/jdbc/"
    AGENT_PROMPT = "Collect host, port, database, username, and password for the SQL Server instance. Ensure the login has read permissions."
    SUPPORTED_VERSIONS = ("2012", "2014", "2016", "2017", "2019", "2022")
    MIN_VERSION = "2012"
    PROBING_METHODS = (
        EndpointProbingMethod(
            key="sqlserver_product_version",
            label="SERVERPROPERTY('ProductVersion')",
            strategy="SQL",
            statement="SELECT CONVERT(NVARCHAR(50), SERVERPROPERTY('ProductVersion')) AS version",
            description="Retrieves the semantic version for SQL Server.",
        ),
        EndpointProbingMethod(
            key="sqlserver_at_version",
            label="SELECT @@VERSION",
            strategy="SQL",
            statement="SELECT @@VERSION AS banner",
            description="Fallback banner probe.",
            returns_capabilities=("preview",),
        ),
    )
    PROBING_FALLBACK_MESSAGE = "If SERVERPROPERTY access is denied, request SELECT @@VERSION output from the DBA."

    def _literal(self, value: str) -> str:
        incr_type = (self.table_cfg.get("incr_col_type") or "").lower()
        if incr_type in {"epoch_seconds", "epoch_millis", "int", "integer", "bigint"}:
            return str(int(float(value)))
        safe = value.replace(" ", "T")
        return f"CONVERT(DATETIME2,'{safe}',126)"

    def _build_from_sql(self) -> str:
        query = self.table_cfg.get("query_sql")
        if query and query.strip():
            return f"({query}) q"
        return f"[{self.schema}].[{self.table}]"

    def _count_query(self, lower: str, upper: Optional[str]) -> str:
        col = self.incremental_column
        base = self.base_from_sql
        col_identifier = self._column_identifier(col) if col else None
        if not col_identifier:
            raise ValueError("incremental column required for count query")
        predicate = f"{col_identifier} > {self._literal(lower)}"
        if upper is not None:
            predicate += f" AND {col_identifier} <= {self._literal(upper)}"
        return f"(SELECT COUNT_BIG(1) AS CNT FROM {base} WHERE {predicate}) c"

    def _column_identifier(self, name: str) -> str:
        return self._column(name)

    def _column_alias(self, column: str) -> str:
        return self._column(column)

    @staticmethod
    def _column(name: str) -> str:
        return f"[{name}]"

    @classmethod
    def descriptor_fields(cls):
        fields = list(super().descriptor_fields())
        fields.insert(
            2,
            EndpointFieldDescriptor(
                key="instance_name",
                label="Instance name",
                value_type="STRING",
                required=False,
                description="If connecting to a named instance, provide it here (e.g., MSSQLSERVER, ANALYTICS).",
            ),
        )
        fields.extend(
            [
                EndpointFieldDescriptor(
                    key="authentication",
                    label="Authentication mode",
                    value_type="ENUM",
                    required=False,
                    default_value="SQL_LOGIN",
                    options=(
                        EndpointFieldOption("SQL login", "SQL_LOGIN"),
                        EndpointFieldOption("Active Directory password", "AD_PASSWORD"),
                    ),
                    description="Choose Active Directory auth when using AAD credentials.",
                ),
                EndpointFieldDescriptor(
                    key="domain",
                    label="Domain",
                    value_type="STRING",
                    required=False,
                    advanced=True,
                    visible_when={"authentication": ("AD_PASSWORD",)},
                    description="NetBIOS or FQDN domain for Active Directory authentication.",
                ),
                EndpointFieldDescriptor(
                    key="encrypt",
                    label="Encrypt",
                    value_type="ENUM",
                    required=False,
                    default_value="optional",
                    options=(
                        EndpointFieldOption("Optional", "optional"),
                        EndpointFieldOption("Mandatory", "mandatory"),
                        EndpointFieldOption("Strict", "strict"),
                    ),
                    description="Controls the Encrypt driver parameter.",
                ),
                EndpointFieldDescriptor(
                    key="trust_server_certificate",
                    label="Trust server certificate",
                    value_type="BOOLEAN",
                    required=False,
                    advanced=True,
                    description="Set true to bypass certificate validation (testing only).",
                ),
                EndpointFieldDescriptor(
                    key="application_intent",
                    label="Application intent",
                    value_type="ENUM",
                    required=False,
                    options=(
                        EndpointFieldOption("ReadWrite", "ReadWrite"),
                        EndpointFieldOption("ReadOnly", "ReadOnly"),
                    ),
                    advanced=True,
                    description="Set ReadOnly when targeting secondary replicas.",
                ),
                EndpointFieldDescriptor(
                    key="multi_subnet_failover",
                    label="Multi subnet failover",
                    value_type="BOOLEAN",
                    required=False,
                    advanced=True,
                    description="Enable when using Always On availability groups.",
                ),
                EndpointFieldDescriptor(
                    key="transparent_network_ip_resolution",
                    label="Transparent network IP resolution",
                    value_type="BOOLEAN",
                    required=False,
                    advanced=True,
                    description="Disable when using legacy DNS behavior by setting false.",
                ),
            ],
        )
        return tuple(fields)

    @classmethod
    def jdbc_driver_name(cls) -> Optional[str]:
        return "com.microsoft.sqlserver.jdbc.SQLServerDriver"

    @classmethod
    def connection_template(cls) -> str:
        return "mssql+pyodbc://{username}:{password}@{host}:{port}/{database}?driver=ODBC+Driver+17+for+SQL+Server"

    @classmethod
    def build_connection(cls, parameters: Dict[str, Any]) -> EndpointConnectionResult:
        normalized = cls._normalize_parameters(parameters)
        validation = cls.test_connection(normalized)
        if not validation.success:
            raise ValueError(validation.message or "Invalid parameters")
        descriptor = cls.descriptor()
        username = normalized["username"]
        password = normalized["password"]
        host = normalized["host"]
        instance = normalized.get("instance_name")
        if instance:
            host = f"{host}\\{instance}"
        port = normalized.get("port")
        host_segment = host
        if port:
            host_segment = f"{host}:{port}"
        database = normalized["database"]
        query_params = {
            "driver": "ODBC Driver 17 for SQL Server",
        }
        if normalized.get("encrypt"):
            query_params["Encrypt"] = normalized["encrypt"]
        if normalized.get("trust_server_certificate"):
            query_params["TrustServerCertificate"] = str(normalized["trust_server_certificate"]).lower()
        if normalized.get("application_intent"):
            query_params["ApplicationIntent"] = normalized["application_intent"]
        if normalized.get("multi_subnet_failover"):
            query_params["MultiSubnetFailover"] = str(normalized["multi_subnet_failover"]).lower()
        if normalized.get("transparent_network_ip_resolution"):
            query_params["TransparentNetworkIPResolution"] = str(normalized["transparent_network_ip_resolution"]).lower()
        query = "&".join(f"{key}={quote_plus(value)}" for key, value in query_params.items())
        url = f"mssql+pyodbc://{username}:{password}@{host_segment}/{database}?{query}"
        config = {
            "templateId": descriptor.id,
            "parameters": normalized,
        }
        return EndpointConnectionResult(
            url=url,
            config=config,
            labels=descriptor.default_labels,
            domain=descriptor.domain,
            verb=descriptor.connection.default_verb if descriptor.connection else None,
        )

    @classmethod
    def descriptor_capabilities(cls):
        base_caps = list(super().descriptor_capabilities())
        base_caps.append(
            EndpointCapabilityDescriptor(
                key="procedures",
                label="Stored procedure support",
                description="Supports execution of stored procedures for metadata probes.",
            ),
        )
        base_caps.append(
            EndpointCapabilityDescriptor(
                key="preview",
                label="Live preview",
                description="Supports TOP clauses for sampling datasets.",
            ),
        )
        return tuple(base_caps)
