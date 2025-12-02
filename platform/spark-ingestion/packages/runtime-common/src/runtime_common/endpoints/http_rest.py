from __future__ import annotations

from typing import Any, Dict
from urllib.parse import urlparse

from .base import (
    ConfigurableEndpoint,
    EndpointCapabilities,
    EndpointCapabilityDescriptor,
    EndpointConnectionResult,
    EndpointConnectionTemplate,
    EndpointDescriptor,
    EndpointFieldDescriptor,
    EndpointFieldOption,
    EndpointProbingMethod,
    EndpointProbingPlan,
    EndpointTestResult,
)


class HttpApiEndpoint(ConfigurableEndpoint):
    """Descriptor-only HTTP API endpoint template."""

    TEMPLATE_ID = "http.rest"
    DISPLAY_NAME = "HTTP API"
    VENDOR = "Generic"
    DESCRIPTION = "Connect to REST/GraphQL APIs over HTTP(S)."
    DOMAIN = "service.http"
    DEFAULT_LABELS = ("http", "api")
    DESCRIPTOR_VERSION = "2.0"
    PROBING_PLAN = EndpointProbingPlan(
        methods=(
            EndpointProbingMethod(
                key="http_options",
                label="HTTP OPTIONS",
                strategy="HTTP",
                statement="OPTIONS {base_url}",
                description="Invoke the base URL with an OPTIONS request to inspect allowed methods and CORS headers.",
                requires=("base_url",),
            ),
            EndpointProbingMethod(
                key="http_health",
                label="GET /health",
                strategy="HTTP",
                statement="GET {base_url}/health",
                description="Optional health probe if the API exposes a health endpoint.",
                requires=("base_url",),
            ),
        ),
        fallback_message="Provide the API version manually if automated probes are unavailable.",
    )

    @classmethod
    def descriptor(cls) -> EndpointDescriptor:
        return EndpointDescriptor(
            id=cls.TEMPLATE_ID,
            family="HTTP",
            title=cls.DISPLAY_NAME,
            vendor=cls.VENDOR,
            description=cls.DESCRIPTION,
            domain=cls.DOMAIN,
            categories=("saas", "api"),
            protocols=("http", "https"),
            docs_url="https://developer.mozilla.org/docs/Web/HTTP",
            agent_prompt="Collect the base URL, authentication method (API key or token), and any custom headers required to reach the API.",
            default_labels=cls.DEFAULT_LABELS,
            fields=cls.descriptor_fields(),
            capabilities=cls.descriptor_capabilities(),
            connection=EndpointConnectionTemplate(url_template="{base_url}", default_verb="GET"),
            descriptor_version=cls.DESCRIPTOR_VERSION,
            probing=cls.PROBING_PLAN,
        )

    @classmethod
    def descriptor_fields(cls):
        return (
            EndpointFieldDescriptor(
                key="base_url",
                label="Base URL",
                value_type="URL",
                placeholder="https://api.example.com",
                description="Root URL for the API, without a trailing slash.",
            ),
            EndpointFieldDescriptor(
                key="http_method",
                label="Default method",
                value_type="ENUM",
                default_value="GET",
                options=(
                    EndpointFieldOption("GET", "GET"),
                    EndpointFieldOption("POST", "POST"),
                    EndpointFieldOption("PUT", "PUT"),
                    EndpointFieldOption("PATCH", "PATCH"),
                    EndpointFieldOption("DELETE", "DELETE"),
                ),
            ),
            EndpointFieldDescriptor(
                key="auth_type",
                label="Authentication",
                value_type="ENUM",
                default_value="NONE",
                options=(
                    EndpointFieldOption("None", "NONE"),
                    EndpointFieldOption("API key", "API_KEY"),
                    EndpointFieldOption("Bearer token", "BEARER"),
                ),
            ),
            EndpointFieldDescriptor(
                key="api_key",
                label="API key",
                value_type="PASSWORD",
                required=False,
                sensitive=True,
                visible_when={"auth_type": ("API_KEY",)},
                description="Static API key issued by the provider.",
            ),
            EndpointFieldDescriptor(
                key="api_key_header",
                label="API key header",
                value_type="STRING",
                required=False,
                visible_when={"auth_type": ("API_KEY",)},
                description="Header name used to send the API key.",
            ),
            EndpointFieldDescriptor(
                key="bearer_token",
                label="Bearer token",
                value_type="PASSWORD",
                required=False,
                sensitive=True,
                visible_when={"auth_type": ("BEARER",)},
                description="Bearer token supplied via Authorization header.",
            ),
            EndpointFieldDescriptor(
                key="custom_headers",
                label="Custom headers",
                value_type="JSON",
                required=False,
                advanced=True,
                description="JSON map of additional headers to include with every request.",
            ),
            EndpointFieldDescriptor(
                key="pagination",
                label="Pagination strategy",
                value_type="ENUM",
                required=False,
                default_value="NONE",
                options=(
                    EndpointFieldOption("None", "NONE"),
                    EndpointFieldOption("Page + size", "PAGE"),
                    EndpointFieldOption("Cursor", "CURSOR"),
                ),
            ),
            EndpointFieldDescriptor(
                key="page_param",
                label="Page parameter",
                value_type="STRING",
                required=False,
                advanced=True,
                visible_when={"pagination": ("PAGE",)},
                description="Query parameter name for the page number (e.g., page).",
            ),
            EndpointFieldDescriptor(
                key="page_size_param",
                label="Page size parameter",
                value_type="STRING",
                required=False,
                advanced=True,
                visible_when={"pagination": ("PAGE",)},
                description="Query parameter for page size/limit.",
            ),
            EndpointFieldDescriptor(
                key="cursor_param",
                label="Cursor parameter",
                value_type="STRING",
                required=False,
                advanced=True,
                visible_when={"pagination": ("CURSOR",)},
                description="Parameter carrying the cursor token.",
            ),
            EndpointFieldDescriptor(
                key="version_hint",
                label="Version hint",
                value_type="STRING",
                required=False,
                advanced=True,
                description="API version identifier if not detectable automatically (e.g., v2).",
            ),
        )

    @classmethod
    def descriptor_capabilities(cls):
        return (
            EndpointCapabilityDescriptor(
                key="metadata",
                label="Schema introspection",
                description="Supports fetching schema or collection metadata from the API.",
            ),
            EndpointCapabilityDescriptor(
                key="preview",
                label="Sample data",
                description="Supports paginated preview requests for quick inspection.",
            ),
            EndpointCapabilityDescriptor(
                key="webhook",
                label="Webhook sourcing",
                description="Can register webhooks for incremental updates if provided by the API.",
            ),
        )

    @classmethod
    def build_connection(cls, parameters: Dict[str, Any]) -> EndpointConnectionResult:
        normalized = cls._normalize(parameters)
        validation = cls.test_connection(normalized)
        if not validation.success:
            raise ValueError(validation.message or "Invalid parameters")
        descriptor = cls.descriptor()
        connection = descriptor.connection
        if not connection:
            raise ValueError(f"Endpoint {descriptor.id} is missing a connection template.")
        url = connection.url_template.format(**normalized)
        verb = normalized.get("http_method") or connection.default_verb
        return EndpointConnectionResult(
            url=url,
            config={"templateId": cls.TEMPLATE_ID, "parameters": normalized},
            labels=descriptor.default_labels,
            domain=descriptor.domain,
            verb=verb,
        )

    @classmethod
    def test_connection(cls, parameters: Dict[str, Any]) -> EndpointTestResult:
        normalized = cls._normalize(parameters)
        base_url = normalized.get("base_url")
        if not base_url:
            return EndpointTestResult(False, "Base URL is required.")
        parsed = urlparse(base_url)
        if parsed.scheme not in {"http", "https"}:
            return EndpointTestResult(False, "Base URL must start with http or https.")
        auth_type = normalized.get("auth_type", "NONE")
        if auth_type == "API_KEY" and not normalized.get("api_key"):
            return EndpointTestResult(False, "API key is required when auth type is API key.")
        if auth_type == "API_KEY" and not normalized.get("api_key_header"):
            return EndpointTestResult(False, "API key header is required when auth type is API key.")
        if auth_type == "BEARER" and not normalized.get("bearer_token"):
            return EndpointTestResult(False, "Bearer token is required when auth type is Bearer.")
        return EndpointTestResult(True, "Connection parameters validated.")

    @staticmethod
    def _normalize(parameters: Dict[str, Any]) -> Dict[str, str]:
        return {key: "" if value is None else str(value).strip() for key, value in parameters.items()}

    # --- BaseEndpoint protocol -------------------------------------------------
    def __init__(self, tool, endpoint_cfg: Dict[str, Any], table_cfg: Dict[str, Any], metadata_access=None, emitter=None) -> None:
        self.tool = tool
        self.endpoint_cfg = dict(endpoint_cfg)
        self.table_cfg = dict(table_cfg)
        self.emitter = emitter
        self._caps = EndpointCapabilities()

    def configure(self, table_cfg: Dict[str, Any]) -> None:  # pragma: no cover
        self.table_cfg.update(table_cfg)

    def capabilities(self) -> EndpointCapabilities:
        return self._caps

    def describe(self) -> Dict[str, Any]:
        return {
            "base_url": self.endpoint_cfg.get("base_url"),
            "http_method": self.endpoint_cfg.get("http_method"),
            "auth_type": self.endpoint_cfg.get("auth_type"),
        }
