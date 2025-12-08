# Sprint Stories

This directory contains sprint requirements that Codex uses to validate PRs.

## Structure

Each sprint has a story file with:
- **Goal**: High-level objective
- **Acceptance Criteria**: Checkboxes for completion
- **Codex Review Points**: Specific items for code review
- **Related Commits**: Git commits implementing the story

## Usage

### In Commits
Reference the story in commit messages:
```
feat(hdfs): Add WebHDFS connector

Story: .agent/stories/sprint-6-hdfs-onedrive.md
```

### In PRs
Link the story in PR descriptions for Codex to validate against.

## Sprints

| Sprint | Story | Status |
|--------|-------|--------|
| 6 | [HDFS + OneDrive](sprint-6-hdfs-onedrive.md) | ✅ Complete |
| 7 | Kafka + Orchestration | 📋 Planned |
| 8 | Shadow Mode | 📋 Planned |
