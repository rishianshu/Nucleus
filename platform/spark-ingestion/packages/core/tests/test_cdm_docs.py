from datetime import datetime, timezone

from ingestion_models.cdm import (
    CDM_DOC_ITEM,
    CDM_DOC_LINK,
    CDM_DOC_REVISION,
    CDM_DOC_SPACE,
    CdmDocItem,
    CdmDocLink,
    CdmDocRevision,
    CdmDocSpace,
)


def test_doc_space_defaults():
    space = CdmDocSpace(
        cdm_id="cdm:doc:space:confluence:ENG",
        source_system="confluence",
        source_space_id="ENG",
        key="ENG",
        name="Engineering",
        description="Docs for eng",
        url="https://example/wiki/spaces/ENG",
        properties={"status": "current"},
    )
    assert space.cdm_id == "cdm:doc:space:confluence:ENG"
    assert space.properties["status"] == "current"


def test_doc_item_with_tags():
    now = datetime.now(timezone.utc)
    item = CdmDocItem(
        cdm_id="cdm:doc:item:confluence:123",
        source_system="confluence",
        source_id="123",
        source_item_id="123",
        space_cdm_id="cdm:doc:space:confluence:ENG",
        parent_item_cdm_id=None,
        title="Getting Started",
        doc_type="page",
        mime_type="text/html",
        source_url="https://example/wiki/spaces/ENG/pages/123",
        created_by_cdm_id="cdm:work:user:confluence:user-1",
        updated_by_cdm_id=None,
        created_at=now,
        updated_at=now,
        url="https://example/wiki/spaces/ENG/pages/123",
        tags=["how-to"],
        raw_source={"id": "123"},
        properties={"path": "/ENG/Getting Started"},
    )
    assert item.tags == ["how-to"]
    assert item.raw_source["id"] == "123"
    assert item.properties["path"].startswith("/")


def test_doc_revision_and_link():
    revision = CdmDocRevision(
        cdm_id="cdm:doc:revision:confluence:123:2",
        source_system="confluence",
        source_revision_id="2",
        item_cdm_id="cdm:doc:item:confluence:123",
        revision_number=2,
        revision_label="v2",
        author_cdm_id="cdm:work:user:confluence:user-1",
        created_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
        summary="Minor edits",
        properties={"size": 1024},
    )
    assert revision.revision_number == 2
    assert revision.properties["size"] == 1024

    link = CdmDocLink(
        cdm_id="cdm:doc:link:confluence:123:456",
        source_system="confluence",
        source_link_id="456",
        from_item_cdm_id="cdm:doc:item:confluence:123",
        to_item_cdm_id=None,
        url="https://example.com",
        link_type="external",
        created_at=None,
        properties={"label": "Spec"},
    )
    assert link.link_type == "external"
    assert link.properties["label"] == "Spec"


def test_doc_constants_exposed():
    assert CDM_DOC_SPACE == "cdm.doc.space"
    assert CDM_DOC_ITEM == "cdm.doc.item"
    assert CDM_DOC_REVISION == "cdm.doc.revision"
    assert CDM_DOC_LINK == "cdm.doc.link"
