# KB Mapping — Nodes & Edges

Every node/edge upsert includes:
- `scope`: { orgId, domainId?, projectId?, teamId? }
- `provenance`: { endpointId, sourceId, runId }
- `phase`: defaults to `normalized`, upgrades to `enriched` when downstream signals run.

## Nodes
| Node Type | Source Entity | Key Fields |
| --- | --- | --- |
| `WorkItem` | work.item | title, status, priority, assignee, timestamps |
| `WorkUser` | work.user | display_name, email?, active |
| `WorkComment` | work.comment | body, author, created_at |
| `DocPage` | doc.page | title, url, body_text |
| `DocComment` | doc.comment | body, parent page |
| `DocSpace` | doc.space | name, url |
| `FileItem` | file.item | name, path, mime, size |
| `FileFolder` | file.folder | name, path |

## Edges
| Edge | From → To | Notes |
| --- | --- | --- |
| `RELATES_TO` | WorkItem ↔ WorkItem | from Jira issue links |
| `ASSIGNED_TO` | WorkItem → WorkUser | assignee |
| `REPORTED_BY` | WorkItem → WorkUser | reporter |
| `COMMENTED_ON` | WorkComment → WorkItem | comment relation |
| `DOCUMENTED_BY` | WorkItem → DocPage | extracted from smart links |
| `MENTIONS` | DocPage → WorkItem/FileItem | mention detection |
| `ATTACHED_TO` | FileItem → WorkItem / DocPage | attachments |
| `BELONGS_TO` | DocPage → DocSpace; FileItem → FileFolder/Drive |
| `CONTAINS` | FileFolder/DocSpace → children | hierarchical |

Edges carry `valid_from`/`valid_to` (default `valid_from = now`, `valid_to = null`). When a relation disappears, driver sends tombstone that sets `valid_to`.
