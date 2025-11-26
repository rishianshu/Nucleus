#!/usr/bin/env python3
"""Simple Jira REST stub for local ingestion runs."""

from __future__ import annotations

import argparse
import json
import logging
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, List
from urllib.parse import urlparse

LOGGER = logging.getLogger("jira_stub")

PROJECTS = [
    {
        "id": "10010",
        "key": "ENG",
        "name": "Engineering",
        "projectTypeKey": "software",
        "lead": {
            "accountId": "user-ada",
            "displayName": "Ada Lovelace",
            "emailAddress": "ada@example.com",
        },
    },
    {
        "id": "10011",
        "key": "OPS",
        "name": "Operations",
        "projectTypeKey": "service_desk",
        "lead": {
            "accountId": "user-bruno",
            "displayName": "Bruno",
            "emailAddress": "bruno@example.com",
        },
    },
]

ISSUES = [
    {
        "id": "20001",
        "key": "ENG-1",
        "fields": {
            "summary": "Stub issue one",
            "status": {
                "name": "In Progress",
                "statusCategory": {"key": "in-progress"},
            },
            "project": {"key": "ENG", "name": "Engineering"},
            "updated": "2025-01-01T00:00:00.000+0000",
            "assignee": {
                "accountId": "user-ada",
                "displayName": "Ada Lovelace",
                "emailAddress": "ada@example.com",
            },
            "reporter": {
                "accountId": "user-grace",
                "displayName": "Grace Hopper",
                "emailAddress": "grace@example.com",
            },
        },
    },
    {
        "id": "20002",
        "key": "OPS-7",
        "fields": {
            "summary": "Stub issue two",
            "status": {
                "name": "Done",
                "statusCategory": {"key": "done"},
            },
            "project": {"key": "OPS", "name": "Operations"},
            "updated": "2025-01-02T12:34:00.000+0000",
            "assignee": {
                "accountId": "user-bruno",
                "displayName": "Bruno",
                "emailAddress": "bruno@example.com",
            },
            "reporter": {
                "accountId": "user-ada",
                "displayName": "Ada Lovelace",
                "emailAddress": "ada@example.com",
            },
        },
    },
]

USERS = [
    {
        "accountId": "user-ada",
        "displayName": "Ada Lovelace",
        "emailAddress": "ada@example.com",
        "timeZone": "UTC",
        "active": True,
        "avatarUrls": {"48x48": "https://example.com/avatars/ada.png"},
    },
    {
        "accountId": "user-bruno",
        "displayName": "Bruno",
        "emailAddress": "bruno@example.com",
        "timeZone": "UTC",
        "active": True,
        "avatarUrls": {"48x48": "https://example.com/avatars/bruno.png"},
    },
]


class JiraStubHandler(BaseHTTPRequestHandler):
    server_version = "JiraStub/1.0"

    def _set_headers(self, status: int = 200, *, content_type: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.end_headers()

    def _write_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self._set_headers(status)
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: D401
        LOGGER.info("%s - %s", self.address_string(), fmt % args)

    def do_GET(self) -> None:  # noqa: D401
        parsed = urlparse(self.path)
        LOGGER.debug("GET %s", parsed.path)
        if parsed.path == "/rest/api/3/project/search":
            self._handle_project_search()
            return
        if parsed.path == "/rest/api/3/search":
            self._handle_issue_search()
            return
        if parsed.path in ("/rest/api/3/user/search", "/rest/api/3/users/search"):
            self._handle_user_search()
            return
        if parsed.path == "/rest/api/3/serverInfo":
            self._write_json({"deploymentType": "Cloud", "version": "9.9.9"})
            return
        if parsed.path == "/rest/api/3/myself":
            self._write_json({"accountId": "stub-account", "displayName": "Jira Stub"})
            return
        self._write_json({"message": "Not found", "path": parsed.path}, status=404)

    def _handle_project_search(self) -> None:
        payload = {
            "values": PROJECTS,
            "isLast": True,
            "maxResults": 50,
            "total": len(PROJECTS),
        }
        self._write_json(payload)

    def _handle_issue_search(self) -> None:
        payload = {
            "issues": ISSUES,
            "startAt": 0,
            "maxResults": len(ISSUES),
            "total": len(ISSUES),
        }
        self._write_json(payload)

    def _handle_user_search(self) -> None:
        self._write_json(USERS)


def main() -> None:
    parser = argparse.ArgumentParser(description="Start a simple Jira REST stub server")
    parser.add_argument("--host", default="127.0.0.1", help="Interface to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8800, help="Port to bind (default: 8800)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
    server = HTTPServer((args.host, args.port), JiraStubHandler)
    LOGGER.info("Jira stub listening at http://%s:%s", args.host, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("Jira stub shutting down")
        server.server_close()


if __name__ == "__main__":
    main()
