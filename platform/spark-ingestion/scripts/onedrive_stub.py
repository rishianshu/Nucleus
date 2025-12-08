#!/usr/bin/env python3
"""Lightweight OneDrive Graph stub for local/CI runs.

Endpoints served (minimal subset):
- GET /drives/{drive_id}/root/children
- GET /drives/{drive_id}/items/{item_id}
- GET /drives/{drive_id}/items/{item_id}/children

Start:
    ONEDRIVE_STUB_PORT=8805 python3 platform/spark-ingestion/scripts/onedrive_stub.py

Use in code/tests via ONEDRIVE_GRAPH_BASE_URL=http://localhost:8805
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Dict, List, Optional

PORT = int(os.environ.get("ONEDRIVE_STUB_PORT", "8805"))

# Static fixture representing a drive with a root folder, one subfolder, and a couple of files.
DRIVE_FIXTURE = {
    "id": "drive-stub",
    "root": {
        "id": "root",
        "name": "root",
        "folder": {},
        "children": [
            {
                "id": "file-1",
                "name": "README.txt",
                "size": 128,
                "file": {"mimeType": "text/plain"},
                "lastModifiedDateTime": "2025-01-01T12:00:00Z",
                "webUrl": "https://stub.local/README.txt",
            },
            {
                "id": "file-2",
                "name": "notes.md",
                "size": 256,
                "file": {"mimeType": "text/markdown"},
                "lastModifiedDateTime": "2025-01-02T09:15:00Z",
                "webUrl": "https://stub.local/notes.md",
            },
            {
                "id": "folder-1",
                "name": "Docs",
                "folder": {},
                "lastModifiedDateTime": "2025-01-03T10:00:00Z",
                "webUrl": "https://stub.local/Docs",
                "children": [
                    {
                        "id": "file-3",
                        "name": "design.docx",
                        "size": 1024,
                        "file": {"mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
                        "lastModifiedDateTime": "2025-01-03T11:00:00Z",
                        "webUrl": "https://stub.local/design.docx",
                    }
                ],
            },
        ],
    },
}


def find_item(item_id: str, items: List[Dict]) -> Optional[Dict]:
    for item in items:
        if item.get("id") == item_id:
            return item
        if "children" in item:
            found = find_item(item_id, item["children"])
            if found:
                return found
    return None


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, payload: Dict, status: int = 200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # pragma: no cover - quiet stub
        return

    def do_GET(self):  # noqa: N802
        parts = [p for p in self.path.split("/") if p]
        if len(parts) >= 3 and parts[0] == "drives":
            drive_id = parts[1]
            if drive_id != DRIVE_FIXTURE["id"]:
                self._send_json({"error": "drive not found"}, status=404)
                return
            if parts[2] == "root" and parts[3:] == ["children"]:
                self._send_json({"value": DRIVE_FIXTURE["root"]["children"]})
                return
            if parts[2] == "items" and len(parts) >= 4:
                item_id = parts[3]
                item = find_item(item_id, DRIVE_FIXTURE["root"]["children"])
                if not item:
                    self._send_json({"error": "item not found"}, status=404)
                    return
                if len(parts) == 4:
                    self._send_json(item)
                    return
                if parts[4:] == ["children"]:
                    children = item.get("children", [])
                    self._send_json({"value": children})
                    return
        self._send_json({"error": "unsupported"}, status=404)


def main() -> None:
    server = HTTPServer(("", PORT), Handler)
    print(f"[onedrive-stub] listening on http://localhost:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
