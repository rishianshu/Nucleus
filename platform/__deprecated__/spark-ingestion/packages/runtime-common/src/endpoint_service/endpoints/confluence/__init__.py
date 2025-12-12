"""Confluence endpoint bundle (endpoint, metadata, normalizer, CDM mappers)."""

from endpoint_service.endpoints.confluence.confluence_http import ConfluenceEndpoint
from endpoint_service.endpoints.confluence.confluence_catalog import CONFLUENCE_DATASET_DEFINITIONS
from endpoint_service.endpoints.confluence.metadata import ConfluenceMetadataSubsystem
from endpoint_service.endpoints.confluence.normalizer import ConfluenceMetadataNormalizer
import endpoint_service.endpoints.confluence.confluence_docs_mapper as confluence_docs_mapper

__all__ = [
    "ConfluenceEndpoint",
    "ConfluenceMetadataSubsystem",
    "CONFLUENCE_DATASET_DEFINITIONS",
    "ConfluenceMetadataNormalizer",
    "confluence_docs_mapper",
]
