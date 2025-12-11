import datetime
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
METADATA_SERVICE_SRC = ROOT / "packages" / "metadata-service" / "src"
RUNTIME_COMMON_SRC = ROOT / "packages" / "runtime-common" / "src"
sys.path.insert(0, str(METADATA_SERVICE_SRC))
sys.path.insert(0, str(RUNTIME_COMMON_SRC))

from metadata_service.cdm import confluence_docs_mapper

SPACE_SAMPLE = {
    "id": "ENG",
    "key": "ENG",
    "name": "Engineering",
    "description": {"plain": {"value": "Engineering knowledge base"}},
    "status": "current",
    "_links": {"base": "https://example.atlassian.net/wiki", "webui": "/spaces/ENG"},
}

PAGE_SAMPLE = {
    "id": "12345",
    "title": "Getting started",
    "type": "page",
    "history": {
        "createdDate": "2024-01-01T10:00:00.000Z",
        "createdBy": {"accountId": "user-1"},
        "spaceKey": "ENG",
    },
    "version": {
        "id": "2",
        "number": 2,
        "when": "2024-01-02T11:00:00.000Z",
        "by": {"accountId": "user-2"},
        "message": "Updated section",
        "minorEdit": False,
    },
    "labels": [{"name": "howto"}, {"name": "internal"}],
    "_links": {"base": "https://example.atlassian.net/wiki", "tinyui": "/x/abcd"},
}

LINK_SAMPLE = {
    "id": "link-1",
    "url": "https://example.atlassian.net/wiki/spaces/ENG/pages/999",
    "type": "internal",
    "createdAt": "2024-01-03T09:00:00.000Z",
    "title": "Design Doc",
}


def test_space_mapping():
    space = confluence_docs_mapper.map_confluence_space_to_cdm(SPACE_SAMPLE)
    assert space.cdm_id == "cdm:doc:space:confluence:ENG"
    assert space.name == "Engineering"
    assert space.description.startswith("Engineering")
    assert space.url.endswith("/spaces/ENG")


def test_page_mapping_and_revision():
    space = confluence_docs_mapper.map_confluence_space_to_cdm(SPACE_SAMPLE)
    item = confluence_docs_mapper.map_confluence_page_to_cdm(
        PAGE_SAMPLE,
        space_cdm_id=space.cdm_id,
        parent_item_cdm_id=None,
    )
    assert item.cdm_id == "cdm:doc:item:confluence:12345"
    assert item.space_cdm_id == space.cdm_id
    assert item.source_id == "12345"
    assert item.source_url == "https://example.atlassian.net/wiki/x/abcd"
    assert item.tags == ["howto", "internal"]
    assert item.created_at == datetime.datetime(2024, 1, 1, 10, 0, tzinfo=datetime.timezone.utc)
    assert item.updated_by_cdm_id == "cdm:work:user:confluence:user-2"
    assert item.raw_source["version"]["number"] == 2

    revision = confluence_docs_mapper.map_confluence_page_version_to_cdm(
        PAGE_SAMPLE,
        PAGE_SAMPLE["version"],
        item_cdm_id=item.cdm_id,
    )
    assert revision.cdm_id == "cdm:doc:revision:confluence:12345:2"
    assert revision.revision_number == 2
    assert revision.created_at == datetime.datetime(2024, 1, 2, 11, 0, tzinfo=datetime.timezone.utc)


def test_confluence_link_mapping():
    item_cdm_id = "cdm:doc:item:confluence:12345"
    link = confluence_docs_mapper.map_confluence_link_to_cdm(
        LINK_SAMPLE,
        from_item_cdm_id=item_cdm_id,
        maybe_target_item_cdm_id="cdm:doc:item:confluence:999",
    )
    assert link.cdm_id == "cdm:doc:link:confluence:link-1"
    assert link.from_item_cdm_id == item_cdm_id
    assert link.to_item_cdm_id == "cdm:doc:item:confluence:999"
    assert link.created_at == datetime.datetime(2024, 1, 3, 9, 0, tzinfo=datetime.timezone.utc)
