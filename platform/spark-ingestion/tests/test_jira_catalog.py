import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_COMMON_SRC = ROOT / "packages" / "runtime-common" / "src"
RUNTIME_CORE_SRC = ROOT / "packages" / "core" / "src"
sys.path.insert(0, str(RUNTIME_COMMON_SRC))
sys.path.insert(0, str(RUNTIME_CORE_SRC))

from runtime_common.endpoints.jira_catalog import JIRA_DATASET_DEFINITIONS
from runtime_common.endpoints.jira_http import JIRA_INGESTION_HANDLERS


def test_all_catalog_units_have_handlers():
    """Every dataset with ingestion enabled must have a registered handler."""
    missing = []
    for dataset_id, definition in JIRA_DATASET_DEFINITIONS.items():
        ingestion = definition.get("ingestion") or {}
        if not ingestion.get("enabled"):
            continue
        handler_key = ingestion.get("handler") or ingestion.get("unit_id") or dataset_id
        if handler_key not in JIRA_INGESTION_HANDLERS:
            missing.append(handler_key)
    assert not missing, f"Ingestion handlers missing for: {missing}"


def test_handler_map_only_contains_known_units():
    """Ensure there are no stray handlers referencing unknown datasets."""
    valid_keys = {
        (definition.get("ingestion") or {}).get("handler") or (definition.get("ingestion") or {}).get("unit_id") or dataset_id
        for dataset_id, definition in JIRA_DATASET_DEFINITIONS.items()
        if (definition.get("ingestion") or {}).get("enabled")
    }
    for handler_key in JIRA_INGESTION_HANDLERS.keys():
        assert handler_key in valid_keys, f"Unexpected Jira ingestion handler registered: {handler_key}"


def test_ingestion_units_expose_cdm_model_id():
    """Projects/issues/users/comments/worklogs must declare their CDM targets."""
    required = {"jira.projects", "jira.issues", "jira.users", "jira.comments", "jira.worklogs"}
    missing = []
    for dataset_id in required:
        definition = JIRA_DATASET_DEFINITIONS.get(dataset_id) or {}
        ingestion = definition.get("ingestion") or {}
        if not ingestion.get("cdm_model_id"):
            missing.append(dataset_id)
    assert not missing, f"Expected cdm_model_id for Jira datasets: {missing}"
