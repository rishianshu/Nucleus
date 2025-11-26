#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, is_dataclass
from typing import Any, Dict, List, Optional

from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SPARK_ROOT = SCRIPT_DIR.parent
RUNTIME_COMMON_SRC = SPARK_ROOT / "packages" / "runtime-common" / "src"
sys.path.insert(0, str(RUNTIME_COMMON_SRC))

from runtime_common.endpoints.registry import collect_endpoint_descriptors, get_endpoint_class  # type: ignore  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Endpoint registry CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="List endpoint templates")
    list_parser.add_argument("--family", dest="family", help="Filter by family")

    build_parser = subparsers.add_parser("build", help="Build endpoint config")
    build_parser.add_argument("--template", required=True, help="Template identifier")
    build_parser.add_argument("--parameters", required=True, help="JSON string of parameters")

    test_parser = subparsers.add_parser("test", help="Test endpoint configuration")
    test_parser.add_argument("--template", required=True, help="Template identifier")
    test_parser.add_argument("--parameters", required=True, help="JSON string of parameters")

    args = parser.parse_args()

    if args.command == "list":
        descriptors = collect_endpoint_descriptors()
        if args.family:
            descriptors = [descriptor for descriptor in descriptors if descriptor.family == args.family]
        print(json.dumps([serialize_descriptor(descriptor) for descriptor in descriptors]))
        return

    parameters = parse_json_arg(args.parameters)
    endpoint_class = get_endpoint_class(args.template)
    if not endpoint_class:
        raise SystemExit(f"Unknown endpoint template: {args.template}")

    if args.command == "build":
        result = endpoint_class.build_connection(parameters)
        print(json.dumps(serialize_connection_result(result)))
        return

    if args.command == "test":
        result = endpoint_class.test_connection(parameters)
        print(json.dumps(serialize_test_result(result)))
        return

    raise SystemExit(f"Unsupported command: {args.command}")


def parse_json_arg(payload: str) -> Dict[str, Any]:
    try:
        parsed = json.loads(payload) if payload else {}
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive
        raise SystemExit(f"Invalid JSON payload: {exc}") from exc
    if not isinstance(parsed, dict):
        raise SystemExit("Parameters JSON must be an object")
    return {str(key): "" if value is None else str(value) for key, value in parsed.items()}


def serialize_descriptor(descriptor) -> Dict[str, Any]:
    return {
        "id": descriptor.id,
        "family": descriptor.family,
        "title": descriptor.title,
        "vendor": descriptor.vendor,
        "description": descriptor.description,
        "domain": descriptor.domain,
        "categories": list(descriptor.categories or ()),
        "protocols": list(descriptor.protocols or ()),
        "versions": list(descriptor.versions or ()),
        "defaultPort": descriptor.default_port,
        "driver": descriptor.driver,
        "docsUrl": descriptor.docs_url,
        "agentPrompt": descriptor.agent_prompt,
        "defaultLabels": list(descriptor.default_labels or ()),
        "fields": [serialize_field(field) for field in getattr(descriptor, "fields", [])],
        "capabilities": [serialize_capability(capability) for capability in getattr(descriptor, "capabilities", [])],
        "sampleConfig": descriptor.sample_config,
        "connection": serialize_connection(getattr(descriptor, "connection", None)),
        "descriptorVersion": getattr(descriptor, "descriptor_version", None),
        "minVersion": getattr(descriptor, "min_version", None),
        "maxVersion": getattr(descriptor, "max_version", None),
        "probing": serialize_probing_plan(getattr(descriptor, "probing", None)),
        "extras": getattr(descriptor, "extras", None),
    }


def serialize_field(field) -> Dict[str, Any]:
    return {
        "key": field.key,
        "label": field.label,
        "valueType": field.value_type,
        "required": field.required,
        "semantic": field.semantic,
        "description": field.description,
        "placeholder": field.placeholder,
        "helpText": field.help_text,
        "options": [serialize_field_option(option) for option in getattr(field, "options", [])],
        "regex": field.regex,
        "min": field.min_value,
        "max": field.max_value,
        "defaultValue": getattr(field, "default_value", None),
        "advanced": getattr(field, "advanced", False),
        "sensitive": getattr(field, "sensitive", False),
        "dependsOn": getattr(field, "depends_on", None),
        "dependsValue": getattr(field, "depends_value", None),
        "visibleWhen": serialize_visible_when(getattr(field, "visible_when", None)),
    }


def serialize_field_option(option) -> Dict[str, Any]:
    return {
        "label": option.label,
        "value": option.value,
        "description": option.description,
    }


def serialize_capability(capability) -> Dict[str, Any]:
    return {
        "key": capability.key,
        "label": capability.label,
        "description": capability.description,
    }


def serialize_connection(connection) -> Optional[Dict[str, Any]]:
    if not connection:
        return None
    if is_dataclass(connection):
        data = asdict(connection)
    elif isinstance(connection, dict):
        data = connection
    else:
        data = {
            "url_template": getattr(connection, "url_template", None),
            "default_verb": getattr(connection, "default_verb", None),
        }
    return {
        "urlTemplate": data.get("url_template"),
        "defaultVerb": data.get("default_verb"),
    }


def serialize_connection_result(result) -> Dict[str, Any]:
    data = asdict(result)
    data["labels"] = list(data.get("labels") or [])
    return data


def serialize_visible_when(rules: Optional[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
    if not rules:
        return None
    serialized = []
    for field, values in rules.items():
        serialized.append(
            {
                "field": field,
                "values": list(values or []),
            }
        )
    return serialized


def serialize_probing_plan(plan) -> Optional[Dict[str, Any]]:
    if not plan:
        return None
    methods = []
    for method in getattr(plan, "methods", []) or []:
        methods.append(
            {
                "key": method.key,
                "label": method.label,
                "strategy": method.strategy,
                "statement": getattr(method, "statement", None),
                "description": getattr(method, "description", None),
                "requires": list(getattr(method, "requires", ()) or ()),
                "returnsVersion": getattr(method, "returns_version", True),
                "returnsCapabilities": list(getattr(method, "returns_capabilities", ()) or ()),
            }
        )
    return {
        "methods": methods,
        "fallbackMessage": getattr(plan, "fallback_message", None),
    }


def serialize_test_result(result) -> Dict[str, Any]:
    data = asdict(result)
    return {
        "success": data.get("success"),
        "message": data.get("message"),
        "detectedVersion": data.get("detected_version"),
        "capabilities": data.get("capabilities") or [],
        "details": data.get("details"),
    }


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # pragma: no cover - provide JSON error payload
        payload = {"error": str(error)}
        print(json.dumps(payload), file=sys.stderr)
        raise
