"""Metadata subsystem adapters."""

from metadata_service.adapters.oracle import OracleMetadataSubsystem
from metadata_service.adapters.postgres import PostgresMetadataSubsystem
from metadata_service.adapters.jira import JiraMetadataSubsystem
from metadata_service.adapters.confluence import ConfluenceMetadataSubsystem

__all__ = [
    "OracleMetadataSubsystem",
    "PostgresMetadataSubsystem",
    "JiraMetadataSubsystem",
    "ConfluenceMetadataSubsystem",
]
