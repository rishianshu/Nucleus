# STATE SYNC (auto-updated)

## Focus Feature
cdm-core-model-and-semantic-binding-v1 (success @ 2025-11-27T06:05Z)

## Last Run
- slug: metadata-planner-endpoint-hooks-v1
- status: success
- duration: ~3h (planner hook refactor + Jira/JDBC subs + docs/tests/ci)
- tests: pytest platform/spark-ingestion/tests/test_metadata_planning.py platform/spark-ingestion/tests/test_metadata_preview.py; pnpm ci-check
- commits: not yet
- decisions: 0
- next_step: none (slug closed)

## Global Queue
TODAY:
- 
NEXT:
- 
LATER:
- 

## Events
- 2025-11-27T06:05Z run success (cdm-core-model-and-semantic-binding-v1, CDM models + Jira bindings + docs/tests)
- 2025-11-27T02:20Z run success (metadata-planner-endpoint-hooks-v1, planner hooks + Jira/JDBC subs + ci-check)
- 2025-11-26T19:40Z run success (metadata-worker-capabilities-and-preview-v1, planner refactor + Jira preview + ci-check green)
- 2025-11-26T19:44Z run started (metadata-planner-endpoint-hooks-v1, boot + artifact sync)
- 2025-11-26T19:35Z run success (ingestion-config-and-jira-units-v1, Jira issue ingestion via /search/jql + ingestion config UI + ci-check green)
- 2025-11-26T19:14Z run started (metadata-worker-capabilities-and-preview-v1, boot + artifact sync)
- 2025-11-26T09:53Z run started (ingestion-config-and-jira-units-v1, boot + context sync)
- 2025-11-25T22:07Z run success (semantic-jira-source-v1, pnpm ci-check green after Jira ingestion verification)
- 2025-11-24T12:16Z run heartbeat (semantic-jira-source-v1, startIngestion resolver covered in bypass mode w/ mocked state store + Jira units)
- 2025-11-24T12:02Z run heartbeat (semantic-jira-source-v1, ingestionUnits resolver now tested with Jira template extras)
- 2025-11-24T11:53Z run heartbeat (semantic-jira-source-v1, queued next steps: GraphQL/Playwright integration + KB verification)
- 2025-11-24T11:50Z run heartbeat (semantic-jira-source-v1, ingestion workflow now receives endpoint config policy fallback + TS/Py tests added)
- 2025-11-24T10:05Z run heartbeat (semantic-jira-source-v1, catalog-driven ingestion now covered by Python tests + handler map)
- 2025-11-24T09:30Z run heartbeat (semantic-jira-source-v1, static driver + Python handlers now consume shared catalog-driven units)
- 2025-11-24T08:27Z run heartbeat (semantic-jira-source-v1, specs/docs updated to match shared dataset→unit/extra design)
- 2025-11-24T08:24Z run heartbeat (semantic-jira-source-v1, shared Jira API catalog surfaced via descriptor extras + templates)
- 2025-11-24T08:01Z run heartbeat (semantic-jira-source-v1, Jira units now derived from dataset catalog; shared spec lives in runtime_common)
- 2025-11-24T06:59Z run heartbeat (semantic-jira-source-v1, endpoints expose unit planning + metadata capabilities per new HLD/LLD)
- 2025-11-24T05:26Z run heartbeat (semantic-jira-source-v1, endpoint docs now cover normalizers + CatalogSnapshot/NormalizedRecord contract)
- 2025-11-24T05:22Z run heartbeat (semantic-jira-source-v1, generic endpoint HLD/LLD documented + Jira comments/worklogs schema added)
- 2025-11-24T05:12Z run heartbeat (semantic-jira-source-v1, dynamic custom-fields + API catalog recorded in new HLD/LLD + ENDPOINTS docs)
- 2025-11-24T04:46Z run heartbeat (semantic-jira-source-v1, Jira metadata subsystem emitting catalog snapshots via new normalizer)
- 2025-11-23T19:31Z run resumed (semantic-jira-source-v1, endpoint design aligned + KB contract clarified)
- 2025-11-23T19:05Z run blocked (semantic-jira-source-v1, need KB persistence guidance for Python worker)
- 2025-11-23T18:53Z run started (semantic-jira-source-v1, semantic Jira source bring-up)
- 2025-11-23T04:27Z run started (ingestion-source-staging-sink-v1, ingestion staging sink work)
- 2025-11-23T07:58Z run blocked (ingestion-source-staging-sink-v1, metadata-auth catalog filter spec still failing under ci-check)
- 2025-11-23T15:22Z run success (ingestion-source-staging-sink-v1, Graph tables added + KB fallback + ci-check green)
- 2025-11-23T17:55Z run blocked (ingestion-source-staging-sink-v1, manual browser verification requires GUI access clarification)
- 2025-11-23T18:04Z run success (ingestion-source-staging-sink-v1, headless Playwright KB scenario accepted as manual verification)
- 2025-11-22T19:26Z run started (nucleus-architecture-survey-v1, architecture mapping)
- 2025-11-22T16:22Z run success (ingestion-core-v1, ingestion workflow/UI/tests green)
- 2025-11-21T11:20Z run success (kb-admin-console-polish-v1, KB explorers polished + Playwright green)
- 2025-11-20T18:30Z run success (kb-admin-console-v1, KB console UI/tests green)
- 2025-11-19T14:25Z run success (semantic-sources-trio-story-v1, contracts drafted)
- 2025-11-18T14:38Z run success (catalog-view-and-ux-v1, metadata-auth Playwright green)
- 2025-11-16T17:45Z run blocked (metadata-identity-hardening, metadata-auth needs reporting `/api/graphql`)
- 2025-11-16T17:25Z run success (collection-lifecycle, canonical dataset identity + collection UI/tests complete)
