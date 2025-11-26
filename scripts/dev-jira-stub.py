#!/usr/bin/env python3
"""Simple Jira REST stub for local ingestion runs."""

from __future__ import annotations

import argparse
import json
import logging
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, List
from urllib.parse import urlparse, parse_qs

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

COMMENTS = {
    "ENG-1": [
        {
            "id": "c-100",
            "body": "First comment on ENG-1",
            "created": "2025-01-01T08:00:00.000+0000",
            "updated": "2025-01-01T08:15:00.000+0000",
            "author": {
                "accountId": "user-ada",
                "displayName": "Ada Lovelace",
            },
        }
    ]
}

WORKLOGS = {
    "ENG-1": [
        {
            "id": "w-100",
            "timeSpentSeconds": 1800,
            "started": "2025-01-01T09:00:00.000+0000",
            "updated": "2025-01-01T09:05:00.000+0000",
            "author": {
                "accountId": "user-ada",
                "displayName": "Ada Lovelace",
            },
        }
    ]
}


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
        if parsed.path == "/rest/api/3/search/jql":
            self._handle_issue_search(parsed)
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
        if parsed.path.startswith("/rest/api/3/issue/"):
            if parsed.path.endswith("/comment"):
                issue_key = self._issue_key_from_path(parsed.path)
                self._handle_issue_comments(issue_key)
                return
            if parsed.path.endswith("/worklog"):
                issue_key = self._issue_key_from_path(parsed.path)
                self._handle_issue_worklogs(issue_key)
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

    def _handle_issue_search(self, parsed) -> None:
        params = parse_qs(parsed.query)
        max_results = max(1, int(params.get("maxResults", ["50"])[0]))
        page_token = params.get("pageToken", [None])[0]
        start_index = int(page_token) if page_token and page_token.isdigit() else 0
        subset = ISSUES[start_index : start_index + max_results]
        next_index = start_index + len(subset)
        payload = {
            "issues": subset,
            "isLast": next_index >= len(ISSUES),
        }
        if next_index < len(ISSUES):
            payload["nextPageToken"] = str(next_index)
        self._write_json(payload)

    def _handle_user_search(self) -> None:
        self._write_json(USERS)

    def _handle_issue_comments(self, issue_key: str | None) -> None:
        comments = COMMENTS.get(issue_key or "", [])
        payload = {"comments": comments, "total": len(comments), "isLast": True}
        self._write_json(payload)

    def _handle_issue_worklogs(self, issue_key: str | None) -> None:
        worklogs = WORKLOGS.get(issue_key or "", [])
        payload = {"worklogs": worklogs, "total": len(worklogs)}
        self._write_json(payload)

    @staticmethod
    def _issue_key_from_path(path: str) -> str | None:
        segments = path.strip("/").split("/")
        if len(segments) >= 6 and segments[0:4] == ["rest", "api", "3", "issue"]:
            return segments[4]
        return None


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
