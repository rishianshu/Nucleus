import { APIRequestContext, expect } from "@playwright/test";

const keycloakBase = process.env.KEYCLOAK_BASE_URL ?? "http://localhost:8081";
const keycloakRealm = process.env.KEYCLOAK_REALM ?? "nucleus";
const keycloakClientId = process.env.KEYCLOAK_CLIENT_ID ?? "jira-plus-plus";
const keycloakClientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
const keycloakUsername = process.env.KEYCLOAK_TEST_USERNAME ?? "dev-writer";
const keycloakPassword = process.env.KEYCLOAK_TEST_PASSWORD ?? "password";
const metadataGraphqlEndpoint = process.env.METADATA_GRAPHQL_ENDPOINT ?? "http://localhost:4010/graphql";
const metadataDefaultProject = process.env.METADATA_DEFAULT_PROJECT ?? "global";
const metadataCatalogDomain = process.env.METADATA_CATALOG_DOMAIN ?? "catalog.dataset";

let catalogSeedPromise: Promise<void> | null = null;

export async function fetchKeycloakToken(request: APIRequestContext): Promise<string> {
  const tokenResponse = await request.post(
    `${keycloakBase}/realms/${keycloakRealm}/protocol/openid-connect/token`,
    {
      form: {
        client_id: keycloakClientId,
        grant_type: "password",
        username: keycloakUsername,
        password: keycloakPassword,
        ...(keycloakClientSecret ? { client_secret: keycloakClientSecret } : {}),
      },
    },
  );
  const rawBody = await tokenResponse.text();
  if (!tokenResponse.ok()) {
    throw new Error(`Keycloak token request failed (${tokenResponse.status()}): ${rawBody}`);
  }
  const body = JSON.parse(rawBody);
  const token = body.access_token as string | undefined;
  expect(token, "Keycloak token present").toBeTruthy();
  return token!;
}

export async function graphql<T>(
  request: APIRequestContext,
  token: string,
  query: string,
  variables?: Record<string, unknown>,
  options?: { bypassWrites?: boolean },
): Promise<T> {
  const response = await request.post(metadataGraphqlEndpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.bypassWrites ? { "X-Metadata-Test-Write": "1" } : {}),
    },
    data: { query, variables },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const payload = await response.json();
  if (payload.errors) {
    throw new Error(JSON.stringify(payload.errors));
  }
  return payload.data as T;
}

export function ensureCatalogSeed(request: APIRequestContext): Promise<void> {
  if (!catalogSeedPromise) {
    catalogSeedPromise = seedCatalogDataset(request);
  }
  return catalogSeedPromise;
}

async function seedCatalogDataset(request: APIRequestContext): Promise<void> {
  const token = await fetchKeycloakToken(request);
  const existing = await graphql<{ catalogDatasetConnection: { totalCount: number } }>(
    request,
    token,
    `
      query CatalogSeedCheck {
        catalogDatasetConnection(first: 1) {
          totalCount
        }
      }
    `,
    undefined,
    { bypassWrites: true },
  );
  if ((existing.catalogDatasetConnection.totalCount ?? 0) > 0) {
    return;
  }

  const endpointId = await registerTestEndpoint(request, token);
  await upsertCatalogRecord(request, token, endpointId);
}

async function registerTestEndpoint(request: APIRequestContext, token: string): Promise<string> {
  const suffix = Date.now().toString(36);
  const registerResult = await graphql<{ registerEndpoint: { id: string } }>(
    request,
    token,
    `
      mutation SeedRegisterEndpoint($input: EndpointInput!) {
        registerEndpoint(input: $input) {
          id
        }
      }
    `,
    {
      input: {
        projectSlug: metadataDefaultProject,
        name: `Seed Endpoint ${suffix}`,
        verb: "POST",
        url: `https://metadata-seed-${suffix}.example.com/api`,
        description: "Seeded endpoint for metadata smoke tests",
        labels: ["seed", "smoke"],
        config: null,
      },
    },
    { bypassWrites: true },
  );
  return registerResult.registerEndpoint.id;
}

async function upsertCatalogRecord(request: APIRequestContext, token: string, endpointId: string): Promise<void> {
  const now = new Date().toISOString();
  const datasetId = `seed_dataset_${Date.now().toString(36)}`;
  await graphql(
    request,
    token,
    `
      mutation SeedDataset($input: MetadataRecordInput!) {
        upsertMetadataRecord(input: $input) {
          id
        }
      }
    `,
    {
      input: {
        id: datasetId,
        projectId: metadataDefaultProject,
        domain: metadataCatalogDomain,
        labels: ["seed", "smoke"],
        payload: {
          dataset: {
            id: datasetId,
            displayName: "Seeded Sample Dataset",
            description: "Synthetic dataset inserted by metadata smoke tests.",
            fields: [
              { name: "record_id", type: "STRING", description: "Primary identifier" },
              { name: "metric_value", type: "NUMBER", description: "Sample numeric field" },
              { name: "updated_at", type: "TIMESTAMP", description: "Last update timestamp" },
            ],
          },
          schema: "PUBLIC",
          name: `seed_table_${datasetId}`,
          description: "Synthetic metadata catalog dataset generated for smoke tests.",
          labels: ["seed", "smoke", `endpoint:${endpointId}`],
          metadata_endpoint_id: endpointId,
          _metadata: {
            source_endpoint_id: endpointId,
            source_id: endpointId,
            collected_at: now,
          },
        },
      },
    },
    { bypassWrites: true },
  );
}
