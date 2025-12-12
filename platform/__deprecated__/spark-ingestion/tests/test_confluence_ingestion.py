from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ROOT / "packages"
for rel in ("runtime-common/src", "core/src", "metadata-service/src"):
    sys.path.insert(0, str(PACKAGES / rel))

from metadata_service.cdm_registry import apply_cdm  # noqa: E402


def test_apply_confluence_cdm_mapping_emits_items_and_revisions():
    page_record = {
        "entityType": "doc.page",
        "logicalId": "confluence::example::page::p-1",
        "payload": {
            "id": "p-1",
            "title": "Incident Runbook",
            "spaceKey": "ENG",
            "space": {"id": "100", "key": "ENG", "name": "Engineering"},
            "history": {"createdDate": datetime.now().isoformat(), "createdBy": {"accountId": "user-1"}},
            "version": {"id": "2", "number": 2, "when": datetime.now().isoformat(), "by": {"accountId": "user-2"}},
        },
    }
    mapped_items = apply_cdm("confluence", "confluence.page", "cdm.doc.item", [page_record], dataset_id="confluence.page")
    mapped_revisions = apply_cdm(
        "confluence",
        "confluence.page.version",
        "cdm.doc.revision",
        [page_record],
        dataset_id="confluence.page",
    )
    mapped = mapped_items + mapped_revisions
    models = [record.get("cdmModelId") for record in mapped]
    assert "cdm.doc.item" in models
    assert "cdm.doc.revision" in models
    item_record = next(record for record in mapped if record.get("cdmModelId") == "cdm.doc.item")
    assert item_record["payload"]["space_cdm_id"].startswith("cdm:doc:space:confluence:")


def test_apply_confluence_cdm_mapping_for_spaces_and_links():
    space_record = {
        "entityType": "doc.space",
        "payload": {"id": "space-1", "key": "OPS", "name": "Operations"},
    }
    attachment_record = {
        "entityType": "doc.attachment",
        "payload": {
            "id": "att-1",
            "title": "runbook.pdf",
            "downloadLink": "https://example/wiki/download/att-1",
            "mediaType": "application/pdf",
            "container": {"id": "p-1"},
        },
    }
    mapped_spaces = apply_cdm("confluence", "confluence.space", "cdm.doc.space", [space_record], dataset_id="confluence.space")
    assert mapped_spaces[0]["cdmModelId"] == "cdm.doc.space"
    mapped_links = apply_cdm("confluence", "confluence.attachment", "cdm.doc.link", [attachment_record], dataset_id="confluence.attachment")
    assert mapped_links[0]["cdmModelId"] == "cdm.doc.link"
    assert mapped_links[0]["payload"]["from_item_cdm_id"].endswith("p-1")
