"""Compatibility shims for legacy cdm mappers."""

import endpoint_service.endpoints.jira.jira_work_mapper as jira_work_mapper  # type: ignore  # noqa: F401
import endpoint_service.endpoints.confluence.confluence_docs_mapper as confluence_docs_mapper  # type: ignore  # noqa: F401

__all__ = ["jira_work_mapper", "confluence_docs_mapper"]
