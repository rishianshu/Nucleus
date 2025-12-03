"""Endpoint family convenience imports for the endpoint_service alias."""

from endpoint_service.endpoints import jira, confluence, jdbc, postgres, oracle, http, kafka  # noqa: F401

__all__ = ["jira", "confluence", "jdbc", "postgres", "oracle", "http", "kafka"]
