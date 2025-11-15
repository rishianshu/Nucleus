from __future__ import annotations

from typing import Any, Dict

from .base import (
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


class KafkaStreamEndpoint:
    """Descriptor-only template for Apache Kafka/Confluent streaming sources."""

    TEMPLATE_ID = "stream.kafka"
    DISPLAY_NAME = "Kafka / Confluent"
    VENDOR = "Apache Kafka"
    DESCRIPTION = "Subscribe to Kafka topics via consumer groups for metadata collection or CDC."
    DOMAIN = "stream.kafka"
    DEFAULT_LABELS = ("stream", "kafka")
    DESCRIPTOR_VERSION = "2.0"
    PROBING_PLAN = EndpointProbingPlan(
        methods=(
            EndpointProbingMethod(
                key="kafka_metadata",
                label="Broker metadata",
                strategy="KAFKA",
                statement="Describe cluster metadata via AdminClient",
                description="Uses the Kafka Admin client to fetch broker metadata and supported features.",
                requires=("bootstrap_servers",),
            ),
        ),
        fallback_message="Provide the Kafka cluster version manually if admin APIs are unavailable.",
    )

    @classmethod
    def descriptor(cls) -> EndpointDescriptor:
        return EndpointDescriptor(
            id=cls.TEMPLATE_ID,
            family="STREAM",
            title=cls.DISPLAY_NAME,
            vendor=cls.VENDOR,
            description=cls.DESCRIPTION,
            domain=cls.DOMAIN,
            categories=("streaming", "cdc"),
            protocols=("kafka", "ssl", "sasl"),
            docs_url="https://kafka.apache.org/documentation/",
            agent_prompt="Collect bootstrap servers, security protocol (PLAINTEXT/SSL/SASL), authentication material, and target topics.",
            default_labels=cls.DEFAULT_LABELS,
            fields=cls.descriptor_fields(),
            capabilities=cls.descriptor_capabilities(),
            connection=EndpointConnectionTemplate(url_template="kafka://{bootstrap_servers}", default_verb="POST"),
            descriptor_version=cls.DESCRIPTOR_VERSION,
            probing=cls.PROBING_PLAN,
        )

    @classmethod
    def descriptor_fields(cls):
        return (
            EndpointFieldDescriptor(
                key="bootstrap_servers",
                label="Bootstrap servers",
                value_type="STRING",
                placeholder="broker01:9092,broker02:9092",
                description="Comma-separated host:port pairs for the Kafka cluster.",
            ),
            EndpointFieldDescriptor(
                key="security_protocol",
                label="Security protocol",
                value_type="ENUM",
                default_value="PLAINTEXT",
                options=(
                    EndpointFieldOption("PLAINTEXT", "PLAINTEXT"),
                    EndpointFieldOption("SSL", "SSL"),
                    EndpointFieldOption("SASL_SSL", "SASL_SSL"),
                    EndpointFieldOption("SASL_PLAINTEXT", "SASL_PLAINTEXT"),
                ),
            ),
            EndpointFieldDescriptor(
                key="sasl_mechanism",
                label="SASL mechanism",
                value_type="ENUM",
                required=False,
                visible_when={"security_protocol": ("SASL_SSL", "SASL_PLAINTEXT")},
                options=(
                    EndpointFieldOption("PLAIN", "PLAIN"),
                    EndpointFieldOption("SCRAM-SHA-256", "SCRAM-SHA-256"),
                    EndpointFieldOption("SCRAM-SHA-512", "SCRAM-SHA-512"),
                ),
            ),
            EndpointFieldDescriptor(
                key="sasl_username",
                label="SASL username",
                value_type="STRING",
                required=False,
                visible_when={"security_protocol": ("SASL_SSL", "SASL_PLAINTEXT")},
            ),
            EndpointFieldDescriptor(
                key="sasl_password",
                label="SASL password",
                value_type="PASSWORD",
                required=False,
                sensitive=True,
                visible_when={"security_protocol": ("SASL_SSL", "SASL_PLAINTEXT")},
            ),
            EndpointFieldDescriptor(
                key="ssl_ca",
                label="CA certificate path",
                value_type="STRING",
                required=False,
                advanced=True,
                visible_when={"security_protocol": ("SSL", "SASL_SSL")},
                description="Filesystem path to the trusted CA certificate.",
            ),
            EndpointFieldDescriptor(
                key="ssl_cert",
                label="Client certificate path",
                value_type="STRING",
                required=False,
                advanced=True,
                visible_when={"security_protocol": ("SSL", "SASL_SSL")},
            ),
            EndpointFieldDescriptor(
                key="ssl_key",
                label="Client private key path",
                value_type="STRING",
                required=False,
                advanced=True,
                sensitive=True,
                visible_when={"security_protocol": ("SSL", "SASL_SSL")},
            ),
            EndpointFieldDescriptor(
                key="topics",
                label="Topics",
                value_type="LIST",
                description="Comma-separated list of topics to scan for metadata.",
            ),
            EndpointFieldDescriptor(
                key="consumer_group",
                label="Consumer group",
                value_type="STRING",
                required=False,
                description="Consumer group ID used for offsets when streaming records.",
            ),
            EndpointFieldDescriptor(
                key="version_hint",
                label="Broker version hint",
                value_type="STRING",
                required=False,
                advanced=True,
            ),
        )

    @classmethod
    def descriptor_capabilities(cls):
        return (
            EndpointCapabilityDescriptor(
                key="metadata",
                label="Topic metadata",
                description="Fetches topic configurations, partitions, and replication metadata.",
            ),
            EndpointCapabilityDescriptor(
                key="cdc",
                label="Change streams",
                description="Supports subscribing to topics that deliver CDC events.",
            ),
            EndpointCapabilityDescriptor(
                key="preview",
                label="Sample records",
                description="Allows sampling a limited number of records for inspection.",
            ),
        )

    @classmethod
    def build_connection(cls, parameters: Dict[str, Any]) -> EndpointConnectionResult:
        normalized = cls._normalize(parameters)
        validation = cls.test_connection(normalized)
        if not validation.success:
            raise ValueError(validation.message or "Invalid parameters")
        url = f"kafka://{normalized['bootstrap_servers']}"
        return EndpointConnectionResult(
            url=url,
            config={"templateId": cls.TEMPLATE_ID, "parameters": normalized},
            labels=cls.DEFAULT_LABELS,
            domain=cls.DOMAIN,
            verb="POST",
        )

    @classmethod
    def test_connection(cls, parameters: Dict[str, Any]) -> EndpointTestResult:
        normalized = cls._normalize(parameters)
        if not normalized.get("bootstrap_servers"):
            return EndpointTestResult(False, "Bootstrap servers are required.")
        protocol = normalized.get("security_protocol", "PLAINTEXT")
        if protocol in {"SASL_SSL", "SASL_PLAINTEXT"}:
            if not normalized.get("sasl_username") or not normalized.get("sasl_password"):
                return EndpointTestResult(False, "SASL username and password are required for SASL protocols.")
            if not normalized.get("sasl_mechanism"):
                return EndpointTestResult(False, "SASL mechanism must be specified for SASL protocols.")
        if protocol in {"SSL", "SASL_SSL"} and not normalized.get("ssl_ca"):
            return EndpointTestResult(False, "CA certificate path is required for SSL-based protocols.")
        if not normalized.get("topics"):
            return EndpointTestResult(False, "At least one topic is required.")
        return EndpointTestResult(True, "Connection parameters validated.")

    @staticmethod
    def _normalize(parameters: Dict[str, Any]) -> Dict[str, str]:
        return {key: "" if value is None else str(value).strip() for key, value in parameters.items()}
