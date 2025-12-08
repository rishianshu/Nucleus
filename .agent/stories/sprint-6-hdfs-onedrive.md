# Sprint 6: OneDrive + HDFS Connectors

## Goal
Implement cloud storage connectors for OneDrive and HDFS using pure REST APIs (no Spark dependencies).

## Acceptance Criteria

### OneDrive Connector
- [x] OAuth 2.0 token refresh implementation
- [x] Config: clientId, clientSecret, tenantId, refreshToken, driveId, rootPath
- [x] Datasets: onedrive.file, onedrive.folder
- [x] Implements SourceEndpoint interface
- [x] Unit tests (6 tests)
- [ ] Integration tests (require Azure credentials)

### HDFS Connector (WebHDFS)
- [x] Pure REST API (no Spark/protobuf)
- [x] Config: namenodeUrl, user, basePath
- [x] Datasets: hdfs.file, hdfs.directory
- [x] Implements SourceEndpoint interface
- [x] Unit tests (4 tests)
- [ ] Integration tests (require HDFS cluster)

### Codex Review Points
1. All SupportsIncremental flags must be false (not implemented)
2. Family ID pattern: {family}.{endpoint}
3. Descriptor consistency with other connectors
4. Error handling for API failures

## Related Commits
```
feat(ucl): Add HDFS and OneDrive connectors
fix(ucl): Address Codex review findings
fix(ucl): Set all SupportsIncremental flags to false
```

## Files Changed
- `internal/connector/hdfs/*` (6 files)
- `internal/connector/onedrive/*` (6 files)
