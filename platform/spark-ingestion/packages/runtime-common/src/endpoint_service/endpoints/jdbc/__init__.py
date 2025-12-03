"""JDBC endpoint bundle (base endpoint, dialects, metadata, normalizers)."""

from endpoint_service.endpoints.jdbc.jdbc import JdbcEndpoint  # type: ignore
from endpoint_service.endpoints.jdbc.jdbc_mssql import MSSQLEndpoint  # type: ignore
from endpoint_service.endpoints.jdbc.jdbc_planner import plan_jdbc_metadata_jobs  # type: ignore
from endpoint_service.endpoints.postgres.jdbc_postgres import PostgresEndpoint  # type: ignore
from endpoint_service.endpoints.oracle.jdbc_oracle import OracleEndpoint  # type: ignore
from endpoint_service.endpoints.postgres.metadata import PostgresMetadataSubsystem  # type: ignore
from endpoint_service.endpoints.oracle.metadata import OracleMetadataSubsystem  # type: ignore
from endpoint_service.endpoints.postgres.normalizer import PostgresMetadataNormalizer  # type: ignore
from endpoint_service.endpoints.oracle.normalizer import OracleMetadataNormalizer  # type: ignore

__all__ = [
    "JdbcEndpoint",
    "PostgresEndpoint",
    "MSSQLEndpoint",
    "OracleEndpoint",
    "plan_jdbc_metadata_jobs",
    "PostgresMetadataSubsystem",
    "OracleMetadataSubsystem",
    "PostgresMetadataNormalizer",
    "OracleMetadataNormalizer",
]
