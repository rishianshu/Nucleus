"""JDBC endpoint bundle (base endpoint, dialects, metadata, normalizers)."""

from endpoint_service.endpoints.jdbc.jdbc import JdbcEndpoint
from endpoint_service.endpoints.jdbc.jdbc_mssql import MSSQLEndpoint
from endpoint_service.endpoints.jdbc.jdbc_planner import plan_jdbc_metadata_jobs
from endpoint_service.endpoints.postgres.jdbc_postgres import PostgresEndpoint
from endpoint_service.endpoints.oracle.jdbc_oracle import OracleEndpoint
from endpoint_service.endpoints.postgres.metadata import PostgresMetadataSubsystem
from endpoint_service.endpoints.oracle.metadata import OracleMetadataSubsystem
from endpoint_service.endpoints.postgres.normalizer import PostgresMetadataNormalizer
from endpoint_service.endpoints.oracle.normalizer import OracleMetadataNormalizer

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
