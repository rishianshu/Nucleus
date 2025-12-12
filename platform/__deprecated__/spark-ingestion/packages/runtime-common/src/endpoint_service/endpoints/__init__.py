"""Endpoint family convenience imports for the endpoint_service alias."""

from endpoint_service.endpoints import jira, confluence, jdbc, postgres, oracle, http, kafka, onedrive  # noqa: F401

__all__ = ["jira", "confluence", "jdbc", "postgres", "oracle", "http", "kafka", "onedrive"]
