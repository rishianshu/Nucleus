"""Metadata subsystem adapters."""

from metadata_service.adapters.oracle import OracleMetadataSubsystem
from metadata_service.adapters.postgres import PostgresMetadataSubsystem

__all__ = ["OracleMetadataSubsystem", "PostgresMetadataSubsystem"]
