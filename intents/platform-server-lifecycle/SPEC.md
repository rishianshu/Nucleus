---
title: "Dev Server Lifecycle Policy"
status: draft
owners:
  - platform-tooling
lastUpdated: 2025-11-11
---

## Goal
Ensure local servers (Jira++, metadata designer, APIs, workers) start, stop, and verify deterministically so agents never block on long‐running commands.

## Required Pattern
1. **Wrapper script per server**
   - `start-*.sh` spawns the command with `nohup`, writes stdout/stderr to `/tmp/<name>.log`, and stores the PID in `/tmp/<name>.pid`.
   - `stop-*.sh` reads that PID, sends `kill`, waits, cleans the pidfile, and prints the log path.
2. **Idempotent start**
   - Before spawning, check if the pidfile exists and the process is alive (`ps -p $PID`). If so, print “already running” and exit.
3. **Verification hook**
   - After fork, poll the log for the “ready” string or use `curl health` with timeout ≤ 30 s. On failure, surface the log tail and exit non-zero.
4. **Operator guidance**
   - `tail -f /tmp/<name>.log` for live debugging.
   - `scripts/status-*.sh` (optional) prints PID + listening ports via `lsof`.

## Example Contract
```bash
./scripts/start-web-bg.sh          # → PID 14553, log /tmp/jpp-dev.log
./scripts/stop-web-bg.sh           # → kills PID, removes pidfile
./scripts/start-designer-bg.sh     # binds 127.0.0.1:5176, log /tmp/designer-dev.log
```

This spec applies to any new server (API, workers, tooling). Do **not** run foreground `pnpm dev` from automation; always rely on the scripts plus PID/log verification.***
