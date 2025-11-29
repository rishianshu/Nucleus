import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_TOKEN_FILE = "/tmp/metadata_token.txt";
const TEMPLATE_ID = "http.confluence";
const ARTIFACT_ROOT = path.resolve(process.cwd(), ".artifacts");

function readEnv() {
  const graphqlEndpoint =
    process.env.METADATA_GRAPHQL_ENDPOINT ||
    process.env.VITE_METADATA_GRAPHQL_ENDPOINT ||
    "http://localhost:4010/graphql";
  let authToken = process.env.METADATA_AUTH_TOKEN || "";
  if (!authToken) {
    try {
      authToken = readFileSync(DEFAULT_TOKEN_FILE, "utf8").trim();
    } catch {
      /* noop */
    }
  }
  if (!authToken) {
    throw new Error(
      "Missing auth token. Set METADATA_AUTH_TOKEN or place a bearer token in /tmp/metadata_token.txt.",
    );
  }
  const preferredEndpointId = process.env.METADATA_CONFLUENCE_ENDPOINT_ID || null;
  return { graphqlEndpoint, authToken, preferredEndpointId };
}

async function graphqlRequest(env, query, variables) {
  const response = await fetch(env.graphqlEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.authToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GraphQL request failed (${response.status} ${response.statusText}): ${text}`,
    );
  }
  const payload = await response.json();
  if (payload.errors && payload.errors.length) {
    const message = payload.errors.map((err) => err.message).join(", ");
    throw new Error(`GraphQL responded with errors: ${message}`);
  }
  return payload.data;
}

async function resolveEndpoint(env) {
  if (env.preferredEndpointId) {
    const query = `
      query LookupEndpoint($id: ID!) {
        metadataEndpoint(id: $id) {
          id
          name
          config
        }
      }
    `;
    const data = await graphqlRequest(env, query, { id: env.preferredEndpointId });
    if (!data?.metadataEndpoint) {
      throw new Error(`Endpoint ${env.preferredEndpointId} not found or inaccessible.`);
    }
    return data.metadataEndpoint;
  }
  const data = await graphqlRequest(
    env,
    `
      query ListEndpoints {
        metadataEndpoints {
          id
          name
          config
          capabilities
        }
      }
    `,
  );
  const endpoints = data?.metadataEndpoints ?? [];
  const confluence = endpoints.find((endpoint) => {
    const templateId =
      endpoint?.config?.templateId || endpoint?.config?.parameters?.templateId;
    return templateId === TEMPLATE_ID;
  });
  if (!confluence) {
    throw new Error(
      `No endpoint registered with templateId=${TEMPLATE_ID}. Set METADATA_CONFLUENCE_ENDPOINT_ID to override.`,
    );
  }
  return confluence;
}

async function triggerCollection(env, endpointId) {
  const data = await graphqlRequest(
    env,
    `
      mutation TriggerCollection($endpointId: ID!) {
        triggerEndpointCollection(endpointId: $endpointId) {
          id
          endpointId
          status
          requestedAt
          startedAt
          completedAt
          error
        }
      }
    `,
    { endpointId },
  );
  return data.triggerEndpointCollection;
}

async function waitForRun(env, runId, endpointId, timeoutMs = 5 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const data = await graphqlRequest(
      env,
      `
        query PollRuns($endpointId: ID!) {
          metadataCollectionRuns(filter: { endpointId: $endpointId }, limit: 10) {
            id
            status
            requestedAt
            startedAt
            completedAt
            error
          }
        }
      `,
      { endpointId },
    );
    const run = (data?.metadataCollectionRuns ?? []).find((entry) => entry.id === runId);
    if (run) {
      if (["SUCCEEDED", "FAILED", "SKIPPED"].includes(run.status)) {
        return run;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Run ${runId} did not finish within ${timeoutMs / 1000}s.`);
}

async function fetchCatalogSnapshot(env, endpointId) {
  const data = await graphqlRequest(
    env,
    `
      query CatalogForEndpoint($endpointId: ID!) {
        catalogDatasetConnection(first: 100, endpointId: $endpointId) {
          totalCount
          nodes {
            id
            displayName
            description
            schema
            entity
            sourceEndpointId
            labels
            collectedAt
            sampleRows
          }
        }
      }
    `,
    { endpointId },
  );
  return data?.catalogDatasetConnection ?? null;
}

async function ensureArtifactsDir(stamp) {
  const dir = path.join(ARTIFACT_ROOT, `confluence-${stamp}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function main() {
  const env = readEnv();
  console.log("[confluence-harness] GraphQL:", env.graphqlEndpoint);
  const endpoint = await resolveEndpoint(env);
  console.log("[confluence-harness] Using endpoint:", endpoint.name, endpoint.id);
  const run = await triggerCollection(env, endpoint.id);
  console.log(
    "[confluence-harness] Triggered collection run:",
    run.id,
    "status",
    run.status,
  );
  const finalRun = await waitForRun(env, run.id, endpoint.id);
  console.log(
    "[confluence-harness] Run completed:",
    finalRun.status,
    finalRun.error ? `error=${finalRun.error}` : "",
  );
  if (finalRun.status !== "SUCCEEDED") {
    throw new Error(`Collection run ${run.id} finished with status ${finalRun.status}.`);
  }
  const catalog = await fetchCatalogSnapshot(env, endpoint.id);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactsDir = await ensureArtifactsDir(stamp);
  await fs.writeFile(path.join(artifactsDir, "run.json"), JSON.stringify(finalRun, null, 2));
  await fs.writeFile(
    path.join(artifactsDir, "catalog.json"),
    JSON.stringify(catalog ?? {}, null, 2),
  );
  console.log(
    `[confluence-harness] Wrote artifacts to ${artifactsDir} (datasets: ${
      catalog?.totalCount ?? 0
    }).`,
  );
}

main().catch((error) => {
  console.error("[confluence-harness] failed:", error);
  process.exitCode = 1;
});
