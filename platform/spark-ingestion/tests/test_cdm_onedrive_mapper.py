import datetime
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
METADATA_SERVICE_SRC = ROOT / "packages" / "metadata-service" / "src"
RUNTIME_COMMON_SRC = ROOT / "packages" / "runtime-common" / "src"
sys.path.insert(0, str(METADATA_SERVICE_SRC))
sys.path.insert(0, str(RUNTIME_COMMON_SRC))

from metadata_service.cdm import onedrive_docs_mapper

DRIVE_SAMPLE = {
    "id": "drive-1",
    "name": "Team Drive",
    "description": "Docs drive",
    "driveType": "business",
    "webUrl": "https://contoso.sharepoint.com/sites/docs",
    "owner": {"user": {"id": "owner-1"}},
}

ITEM_SAMPLE = {
    "id": "item-1",
    "name": "README.docx",
    "file": {"mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    "size": 2048,
    "createdDateTime": "2024-01-01T12:00:00.000Z",
    "lastModifiedDateTime": "2024-01-02T13:00:00.000Z",
    "createdBy": {"user": {"id": "user-a"}},
    "lastModifiedBy": {"user": {"id": "user-b"}},
    "parentReference": {"driveId": "drive-1", "id": "root"},
    "webUrl": "https://contoso.sharepoint.com/sites/docs/README.docx",
    "tags": ["Spec"],
}

VERSION_SAMPLE = {
    "id": "1.0",
    "sequenceNumber": 1,
    "label": "v1",
    "lastModifiedBy": {"user": {"id": "user-b"}},
    "lastModifiedDateTime": "2024-01-02T13:00:00.000Z",
    "size": 2048,
}

LINK_SAMPLE = {
    "id": "link-abc",
    "type": "view",
    "scope": "organization",
    "webUrl": "https://1drv.ms/x!link-abc",
    "createdDateTime": "2024-01-03T08:00:00.000Z",
    "grantedTo": {"user": {"id": "user-c"}},
}


def test_drive_mapping():
    drive = onedrive_docs_mapper.map_onedrive_drive_to_cdm(DRIVE_SAMPLE)
    assert drive.cdm_id == "cdm:doc:space:onedrive:drive-1"
    assert drive.name == "Team Drive"
    assert drive.properties["driveType"] == "business"


def test_item_and_version_mapping():
    drive = onedrive_docs_mapper.map_onedrive_drive_to_cdm(DRIVE_SAMPLE)
    item = onedrive_docs_mapper.map_onedrive_item_to_cdm(
        ITEM_SAMPLE,
        space_cdm_id=drive.cdm_id,
        parent_item_cdm_id=None,
    )
    assert item.cdm_id == "cdm:doc:item:onedrive:drive-1:item-1"
    assert item.tags == ["Spec"]
    assert item.created_by_cdm_id == "cdm:identity:user:onedrive:user-a"
    assert item.updated_at == datetime.datetime(2024, 1, 2, 13, 0, tzinfo=datetime.timezone.utc)

    revision = onedrive_docs_mapper.map_onedrive_item_version_to_cdm(
        ITEM_SAMPLE,
        VERSION_SAMPLE,
        item_cdm_id=item.cdm_id,
    )
    assert revision.cdm_id == "cdm:doc:revision:onedrive:item-1:1.0"
    assert revision.revision_number == 1
    assert revision.author_cdm_id == "cdm:identity:user:onedrive:user-b"


def test_onedrive_link_mapping():
    item_cdm_id = "cdm:doc:item:onedrive:drive-1:item-1"
    link = onedrive_docs_mapper.map_onedrive_link_to_cdm(
        LINK_SAMPLE,
        from_item_cdm_id=item_cdm_id,
        maybe_target_item_cdm_id=None,
    )
    assert link.cdm_id == "cdm:doc:link:onedrive:link-abc"
    assert link.url.endswith("link-abc")
    assert link.created_at == datetime.datetime(2024, 1, 3, 8, 0, tzinfo=datetime.timezone.utc)
