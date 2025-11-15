# Nucleus Brief

Nucleus is our opinionated platform for unifying metadata, AI-assisted reporting, and operational automations across the Jira++ ecosystem. It is designed for product teams that need a single control plane to ingest data from SaaS and warehouse sources, model those entities, and build assistive experiences without stitching together one-off tools.

## Product pillars

- **Metadata Intelligence** – A graph-aware metadata store (Postgres + Prisma + MinIO) that captures datasets, endpoints, semantic tags, and collection runs. Every connector registers capabilities (metadata, preview, profiles) so the platform can reason about which workflows are valid.
- **Secure Access & Auth Loop** – The designer SPA and metadata API sit behind Keycloak. Our new Keycloak wrapper handles PKCE, silent-check-sso, and guarded auto-login so the UI never enters redirect loops and login errors are surfaced with context.
- **AI-Driven Reporting Designer** – A React/Vite console where builders manage report definitions, dashboards, and agent-assisted query generation. The UI coexists with the metadata workspace so teams can jump between schema curation and dashboard design.
- **Workflow Orchestration** – Temporal workflows power metadata ingestion, preview jobs, and harvester-style activities. Each workflow is capability-aware and writes back run state (QUEUED/RUNNING/SUCCEEDED/FAILED/SKIPPED) for transparent replay.
- **Semantic KV Store & Contracts** – Spec-driven contracts (Agent.md, kv-checkpoints, metadata endpoints, etc.) keep producers and consumers aligned. The KV store provides checkpointing and semantic filters so orchestration and apps can persist lightweight state without inventing new services.

## Key features

1. **Endpoint Catalogue & Testing**
   - Template-driven onboarding for JDBC, HTTP, and streaming sources with rich field descriptors and capability flags.
   - One-click “Test connection” executes Temporal test workflows and blocks writes when capabilities or scopes are missing.
   - Automatic project creation/slug resolution ensures every endpoint is scoped to the correct tenant.
2. **Metadata Collections & Preview**
   - Run history with Temporal workflow IDs, filters, and error payloads exposed directly in the UI.
   - Preview support validates that only endpoints exposing the `preview` capability can run heavy queries.
3. **Reporting & Agent Ops**
   - GraphQL registry client feeds report definitions, versions, dashboards, and run telemetry to the designer.
   - Agent personas can suggest queries, generate drafts, and explain schema context using the metadata macros.
4. **Operational Guardrails**
   - Specs in `docs/specs/platform/2025-10` define capabilities, kv semantics, orchestration rules, and login expectations.
   - `Agent.md` plus the acceptance specs drive automated Playwright smoke tests (metadata auth/connection, etc.) and CLI verification scripts.

## Where to start

- **Quick tour:** Launch the designer (`pnpm dev:designer:bg`) and sign in via Keycloak. The sidebar lets you toggle between the designer canvas and the metadata workspace.
- **Add a connector:** Use the “Endpoints” tab → “Register” flow, pick a template, test the connection, then register. The platform will auto-create project rows if needed and expose the new endpoint immediately.
- **Trigger collections:** From the endpoint card, provide optional schema overrides and run a collection. Temporal progress + logs show up on the Collections tab.
- **Design a report:** Create a definition, draft a version, and leverage the agent suggestions to generate SQL/templates. Publish when ready and reference the registry from downstream clients.

# Project Operations (Consolidated Migration)

This repository separates planning (ChatGPT) from execution (Codex) and syncs via shared artifacts.
See docs/meta/* for contracts and schemas. Place feature contracts in intents/<slug>.

Folders:
- docs/meta/      : agent contracts, schemas, governance
- epics/          : coordination only
- intents/<slug>/ : SPEC + INTENT + ACCEPTANCE (source of truth for WHAT)
- runs/<slug>/    : PLAN + LOG + QUESTIONS + DECISIONS + TODO (Codex writes)
- stories/<slug>/ : STORY timeline
- sync/STATE.md   : shared portfolio roll-up

Workflow:
1) ChatGPT produces intents/<slug>/* (status: ready)
2) make promote slug=<slug>
3) Run Card → Codex executes autonomously (2–6h)
4) Codex updates sync/STATE.md and stories/*

Guardrails: fail-closed on ambiguity; log minor decisions; fast ci-check (<8m); never touch @custom blocks.
