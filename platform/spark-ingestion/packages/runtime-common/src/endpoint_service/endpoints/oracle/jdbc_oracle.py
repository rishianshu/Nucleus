from __future__ import annotations

from urllib.parse import quote_plus
from typing import Any, Dict, List, Optional

from ingestion_models.endpoints import (
    EndpointCapabilityDescriptor,
    EndpointConnectionResult,
    EndpointFieldDescriptor,
    EndpointFieldOption,
    EndpointProbingMethod,
    EndpointTestResult,
    EndpointUnitDescriptor,
    IngestionCapableEndpoint,
    MetadataSubsystem,
)

from endpoint_service.endpoints.jdbc.jdbc import JdbcEndpoint
from endpoint_service.endpoints.oracle.metadata import OracleMetadataSubsystem


class OracleEndpoint(JdbcEndpoint, IngestionCapableEndpoint):
    """Oracle-specific JDBC source."""

    DIALECT = "oracle"
    DISPLAY_NAME = "Oracle"
    VENDOR = "Oracle"
    DESCRIPTION = "Connect to Oracle databases via JDBC."
    DOMAIN = "database.oracle"
    DEFAULT_LABELS = ("oracle", "jdbc")
    DEFAULT_PORT = 1521
    DOCS_URL = "https://docs.oracle.com/en/database/oracle/oracle-database/"
    AGENT_PROMPT = "Collect host, port, service name (database), username, and password for the Oracle instance. Ensure the account has read-only access."
    SUPPORTED_VERSIONS = ("11g", "12c", "18c", "19c", "21c")
    MIN_VERSION = "11g"
    PROBING_METHODS = (
        EndpointProbingMethod(
            key="oracle_v_instance",
            label="SELECT version FROM v$instance",
            strategy="SQL",
            statement="SELECT version FROM v$instance",
            description="Requires SELECT on v$instance; returns precise Oracle version.",
        ),
        EndpointProbingMethod(
            key="oracle_v_version",
            label="SELECT banner FROM v$version",
            strategy="SQL",
            statement="SELECT banner FROM v$version WHERE ROWNUM = 1",
            description="Fallback banner probe when v$instance access is restricted.",
        ),
    )
    PROBING_FALLBACK_MESSAGE = "If v$ views are unavailable, request the exact Oracle version from the DBA."

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
        self._metadata = OracleMetadataSubsystem(self)

    def _literal(self, value: str) -> str:
        incr_type = (self.table_cfg.get("incr_col_type") or "").lower()
        if incr_type in {"epoch_seconds", "epoch_millis", "int", "integer", "bigint"}:
            return str(int(float(value)))
        return f"TO_TIMESTAMP('{value}','YYYY-MM-DD HH24:MI:SS')"

    def _count_query(self, lower: str, upper: Optional[str]) -> str:
        col = self.incremental_column
        base = self.base_from_sql
        predicate = f"{col} > {self._literal(lower)}"
        if upper is not None:
            predicate += f" AND {col} <= {self._literal(upper)}"
        return f"(SELECT COUNT(1) AS CNT FROM {base} WHERE {predicate}) c"

    def metadata_subsystem(self) -> MetadataSubsystem:
        return self._metadata

    def list_units(
        self,
        *,
        checkpoint: Optional[Dict[str, Any]] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[EndpointUnitDescriptor]:
        schema = (self.table_cfg.get("schema") or self.jdbc_cfg.get("schema") or "PUBLIC").upper()
        table = (self.table_cfg.get("table") or self.jdbc_cfg.get("table") or "UNKNOWN").upper()
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

    # --- Metadata collection ----------------------------------------------------

    def _cast_type_keyword(self) -> str:
        return "NUMBER"

    def _string_cast_type(self) -> str:
        return "VARCHAR2(4000)"

    @classmethod
    def jdbc_driver_name(cls) -> Optional[str]:
        return "oracle.jdbc.OracleDriver"

    @classmethod
    def connection_template(cls) -> str:
        return "oracle+cx_oracle://{username}:{password}@{host}:{port}/?service_name={service_name}"

    @classmethod
    def descriptor_fields(cls):
        return (
            EndpointFieldDescriptor(
                key="host",
                label="Host / SCAN address",
                value_type="HOSTNAME",
                semantic="HOST",
                placeholder="db01.mycorp.net",
            ),
            EndpointFieldDescriptor(
                key="port",
                label="Listener port",
                value_type="PORT",
                semantic="PORT",
                placeholder=str(cls.DEFAULT_PORT),
            ),
            EndpointFieldDescriptor(
                key="connection_type",
                label="Connection mode",
                value_type="ENUM",
                default_value="SERVICE_NAME",
                description="Oracle supports service names (recommended), SID, or Oracle Net descriptors.",
                options=(
                    EndpointFieldOption("Service name", "SERVICE_NAME"),
                    EndpointFieldOption("SID", "SID"),
                    EndpointFieldOption("TNS descriptor / alias", "TNS_DESCRIPTOR"),
                ),
            ),
            EndpointFieldDescriptor(
                key="service_name",
                label="Service name",
                value_type="STRING",
                required=False,
                visible_when={"connection_type": ("SERVICE_NAME",)},
                description="PDB or service (e.g., orclpdb1.mycorp.net).",
            ),
            EndpointFieldDescriptor(
                key="sid",
                label="SID",
                value_type="STRING",
                required=False,
                visible_when={"connection_type": ("SID",)},
                description="Legacy SID (e.g., ORCL).",
            ),
            EndpointFieldDescriptor(
                key="tns_alias",
                label="TNS alias",
                value_type="STRING",
                required=False,
                advanced=True,
                visible_when={"connection_type": ("TNS_DESCRIPTOR",)},
                description="Alias defined inside tnsnames.ora.",
            ),
            EndpointFieldDescriptor(
                key="tns_descriptor",
                label="TNS descriptor",
                value_type="TEXT",
                required=False,
                advanced=True,
                visible_when={"connection_type": ("TNS_DESCRIPTOR",)},
                description="Inline descriptor when aliases are not available.",
            ),
            EndpointFieldDescriptor(
                key="username",
                label="Username",
                value_type="STRING",
                semantic="USERNAME",
            ),
            EndpointFieldDescriptor(
                key="password",
                label="Password",
                value_type="PASSWORD",
                semantic="PASSWORD",
                sensitive=True,
            ),
            EndpointFieldDescriptor(
                key="wallet_path",
                label="Wallet directory",
                value_type="STRING",
                required=False,
                semantic="FILE_PATH",
                advanced=True,
                description="Absolute path to the wallet (zip or extracted directory) for TCPS/Autonomous DB.",
            ),
            EndpointFieldDescriptor(
                key="wallet_password",
                label="Wallet password",
                value_type="PASSWORD",
                required=False,
                sensitive=True,
                advanced=True,
                description="Password for the wallet if encryption is enabled.",
            ),
            EndpointFieldDescriptor(
                key="ssl_server_dn_match",
                label="Server DN match",
                value_type="BOOLEAN",
                required=False,
                advanced=True,
                description="Set to true to enforce server DN matching (recommended for TCPS).",
            ),
            EndpointFieldDescriptor(
                key="schemas",
                label="Schemas",
                value_type="LIST",
                required=False,
                semantic="SCHEMA",
                description="Comma-separated schema whitelist (e.g., HR, FINANCE).",
            ),
            EndpointFieldDescriptor(
                key="version_hint",
                label="Version hint",
                value_type="STRING",
                required=False,
                advanced=True,
                description="Provide the Oracle version (e.g., 19c) if probes cannot run.",
            ),
        )

    @classmethod
    def _normalize_parameters(cls, parameters: Dict[str, Any]) -> Dict[str, str]:
        normalized = super()._normalize_parameters(parameters)
        connection_type = (normalized.get("connection_type") or "SERVICE_NAME").upper()
        normalized["connection_type"] = connection_type
        return normalized

    @classmethod
    def test_connection(cls, parameters: Dict[str, Any]) -> EndpointTestResult:
        normalized = cls._normalize_parameters(parameters)
        errors = []
        connection_type = normalized.get("connection_type", "SERVICE_NAME")
        if connection_type == "SERVICE_NAME" and not normalized.get("service_name"):
            errors.append("service_name is required for Service name connections.")
        if connection_type == "SID" and not normalized.get("sid"):
            errors.append("sid is required when connection_type is SID.")
        if connection_type == "TNS_DESCRIPTOR" and not (normalized.get("tns_descriptor") or normalized.get("tns_alias")):
            errors.append("Provide either tns_descriptor or tns_alias for TNS connections.")
        if connection_type in {"SERVICE_NAME", "SID"}:
            for field in ("host", "port"):
                if not normalized.get(field):
                    errors.append(f"{field} is required for host-based connections.")
        for field in ("username", "password"):
            if not normalized.get(field):
                errors.append(f"{field} is required.")
        if errors:
            return EndpointTestResult(False, "; ".join(errors))
        return EndpointTestResult(True, "Connection parameters validated.")

    @classmethod
    def build_connection(cls, parameters: Dict[str, Any]) -> EndpointConnectionResult:
        normalized = cls._normalize_parameters(parameters)
        validation = cls.test_connection(normalized)
        if not validation.success:
            raise ValueError(validation.message or "Invalid parameters")
        descriptor = cls.descriptor()
        username = normalized["username"]
        password = normalized["password"]
        connection_type = normalized.get("connection_type", "SERVICE_NAME")
        wallet_path = normalized.get("wallet_path")
        wallet_password = normalized.get("wallet_password")
        ssl_server_dn_match = normalized.get("ssl_server_dn_match")
        query_params = []
        if wallet_path:
            query_params.append(f"wallet_location={quote_plus(wallet_path)}")
        if wallet_password:
            query_params.append(f"wallet_password={quote_plus(wallet_password)}")
        if ssl_server_dn_match:
            query_params.append(f"ssl_server_dn_match={str(ssl_server_dn_match).lower()}")
        if connection_type == "SID":
            sid = normalized.get("sid")
            url = f"oracle+cx_oracle://{username}:{password}@{normalized['host']}:{normalized['port']}/?sid={sid}"
        elif connection_type == "TNS_DESCRIPTOR":
            target = normalized.get("tns_descriptor") or normalized.get("tns_alias")
            url = f"oracle+cx_oracle://{username}:{password}@{target}"
        else:
            service = normalized.get("service_name")
            url = f"oracle+cx_oracle://{username}:{password}@{normalized['host']}:{normalized['port']}/?service_name={service}"
        if query_params:
            glue = "&" if "?" in url else "?"
            url = f"{url}{glue}{'&'.join(query_params)}"
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
                key="metadata",
                label="Catalog metadata",
                description="Supports Oracle-specific metadata harvesting.",
            ),
        )
        base_caps.append(
            EndpointCapabilityDescriptor(
                key="preview",
                label="Live preview",
                description="Supports sampling queries via read-only sessions.",
            ),
        )
        return tuple(base_caps)
