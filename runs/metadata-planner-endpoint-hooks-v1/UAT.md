# UAT Checklist — metadata-planner-endpoint-hooks-v1

## 1. Endpoint registration (GraphQL)

Use a Keycloak access token (client `jira-plus-plus`) and call `registerEndpoint` twice:

```bash
# Jira
curl -s -X POST http://localhost:4010/graphql \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "query": "mutation Register($input: EndpointInput!) { registerEndpoint(input: $input) { id name } }",
    "variables": {
      "input": {
        "projectSlug": "global",
        "name": "Customer Success Jira",
        "verb": "GET",
        "url": "https://whiteklay-tech.atlassian.net",
        "capabilities": ["metadata","ingest"],
        "config": {
          "templateId": "jira.http",
          "parameters": {
            "base_url": "https://whiteklay-tech.atlassian.net",
            "username": "rishikesh.kumar@whiteklay.in",
            "api_token": "<token>",
            "project_keys": ["CUS"]
          }
        }
      }
    }
  }'

# Postgres
curl -s -X POST http://localhost:4010/graphql \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "query": "mutation Register($input: EndpointInput!) { registerEndpoint(input: $input) { id name } }",
    "variables": {
      "input": {
        "projectSlug": "global",
        "name": "Local Postgres",
        "verb": "POST",
        "url": "postgresql://postgres:postgres@localhost:5432/jira_plus_plus",
        "capabilities": ["metadata"],
        "config": {
          "templateId": "jdbc.postgres",
          "parameters": {
            "host": "localhost",
            "port": "5432",
            "database": "jira_plus_plus",
            "username": "postgres",
            "password": "postgres"
          },
          "schemas": ["public"]
        }
      }
    }
  }'
```

## 2. Metadata collection runs

Trigger collections via the admin token:

```bash
curl -s -X POST http://localhost:4010/graphql \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"mutation Trigger($endpointId: ID!){ triggerEndpointCollection(endpointId: $endpointId){ id status }}","variables":{"endpointId":"<ENDPOINT_ID>"}}'
```

Poll run status:

```bash
curl -s -X POST http://localhost:4010/graphql \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"query Runs($endpointId: ID!){ collectionRuns(filter:{endpointId:$endpointId}){ id status startedAt completedAt }}","variables":{"endpointId":"<ENDPOINT_ID>"}}'
```

Verify latest run reports `SUCCEEDED` for both Jira and Postgres.

## 3. UI verification (automated)

Run the new Playwright smoke covering endpoints, catalog, and ingestion console:

```bash
npx playwright test tests/metadata-real-connectors.spec.ts --project=chromium
```

This logs in as `dev-admin`, confirms both endpoints appear with healthy status, exercises catalog preview/detail, and checks the ingestion console lists Jira units.

## 4. Temporal UI spot-check (manual)

Navigate to `http://localhost:8080/namespaces/default/workflows` and search for the latest `collectionRuns` IDs to confirm they are recorded as completed.

## 5. Cleanup (optional)

Use GraphQL `deleteEndpoint(id: ID!)` or the Metadata UI to remove the test endpoints if you need a clean slate.
