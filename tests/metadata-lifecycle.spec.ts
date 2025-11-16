import { test, expect } from "@playwright/test";
import { ensureCatalogSeed, fetchKeycloakToken, graphql } from "./helpers/metadata";

const METADATA_GRAPHQL_ENDPOINT = process.env.METADATA_GRAPHQL_ENDPOINT ?? "http://localhost:4010/graphql";
const METADATA_DEFAULT_PROJECT = process.env.METADATA_DEFAULT_PROJECT ?? "global";

test.beforeAll(async ({ request }) => {
  await ensureCatalogSeed(request);
});

test.describe("Metadata catalog & endpoint lifecycle", () => {
  test("catalog datasets are available (seeded)", async ({ request }) => {
    const token = await fetchKeycloakToken(request);
    const data = await graphql<{ catalogDatasets: Array<{ id: string }> }>(
      request,
      token,
      `
        query CatalogSmoke {
          catalogDatasets {
            id
          }
        }
      `,
    );
    expect(data.catalogDatasets.length, "catalog datasets present").toBeGreaterThan(0);
  });

  test("register, update, and soft-delete an endpoint", async ({ request }) => {
    const token = await fetchKeycloakToken(request);
    const endpointName = `Smoke Endpoint ${Date.now()}`;
    const registerInput = {
      name: endpointName,
      verb: "GET",
      url: "https://metadata-smoke.example.com/api",
      description: "Smoke test endpoint",
      labels: ["smoke", "test"],
    };

    const registerResult = await graphql<{ registerEndpoint: { id: string } }>(
      request,
      token,
      `
        mutation Register($input: EndpointInput!) {
          registerEndpoint(input: $input) {
            id
          }
        }
      `,
      { input: registerInput },
    );

    const endpointId = registerResult.registerEndpoint.id;
    expect(endpointId).toBeTruthy();

    // Update description to verify edit lifecycle.
    await graphql(
      request,
      token,
      `
        mutation Update($id: ID!, $patch: EndpointPatch!) {
          updateEndpoint(id: $id, patch: $patch) {
            id
            description
          }
        }
      `,
      {
        id: endpointId,
        patch: {
          description: "Updated via lifecycle test",
        },
      },
    );

    // Soft-delete the endpoint.
    const deleteResult = await graphql<{ deleteEndpoint: boolean }>(
      request,
      token,
      `
        mutation Delete($id: ID!) {
          deleteEndpoint(id: $id)
        }
      `,
      { id: endpointId },
    );
    expect(deleteResult.deleteEndpoint).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 200));

    const activeEndpoints = await graphql<{ metadataEndpoints: Array<{ id: string }> }>(
      request,
      token,
      `
        query ActiveEndpoints {
          metadataEndpoints(includeDeleted: false) {
            id
          }
        }
      `,
    );
    expect(activeEndpoints.metadataEndpoints.find((endpoint) => endpoint.id === endpointId)).toBeFalsy();
  });

  test("endpoint templates expose probing metadata", async ({ request }) => {
    const token = await fetchKeycloakToken(request);
    const data = await graphql<{
      endpointTemplates: Array<{
        id: string;
        probing?: { methods?: Array<{ key: string }> } | null;
        capabilities: Array<{ key: string }>;
      }>;
    }>(
      request,
      token,
      `
        query Templates {
          endpointTemplates {
            id
            probing {
              methods {
                key
              }
            }
            capabilities {
              key
            }
          }
        }
      `,
    );
    expect(data.endpointTemplates.length).toBeGreaterThan(0);
    const templateWithProbe = data.endpointTemplates.find((template) => template.probing?.methods?.length);
    expect(templateWithProbe?.probing?.methods?.length).toBeGreaterThan(0);
  });

  test("collections GraphQL lifecycle + error codes", async ({ request }) => {
    const token = await fetchKeycloakToken(request);
    const endpointName = `Collection GraphQL ${Date.now()}`;
    const registerResult = await graphql<{ registerEndpoint: { id: string } }>(
      request,
      token,
      `
        mutation RegisterEndpoint($input: EndpointInput!) {
          registerEndpoint(input: $input) {
            id
          }
        }
      `,
      {
        input: {
          projectSlug: METADATA_DEFAULT_PROJECT,
          name: endpointName,
          verb: "POST",
          url: `https://metadata-collection-${Date.now()}.example.com/graphql`,
          description: "Collection GraphQL test endpoint",
          labels: ["collection-test"],
          capabilities: ["metadata"],
        },
      },
    );
    const endpointId = registerResult.registerEndpoint.id;
    const existingCollections = await graphql<{ collections: Array<{ id: string }> }>(
      request,
      token,
      `
        query Collections($endpointId: ID!) {
          collections(endpointId: $endpointId) {
            id
          }
        }
      `,
      { endpointId },
    );
    expect(existingCollections.collections.length).toBeGreaterThan(0);
    const initialCollectionId = existingCollections.collections[0]?.id;
    expect(initialCollectionId).toBeTruthy();
    await waitForCollectionIdle(request, token, initialCollectionId!);
    await graphql<{ deleteCollection: boolean }>(
      request,
      token,
      `
        mutation DeleteCollection($id: ID!) {
          deleteCollection(id: $id)
        }
      `,
      { id: initialCollectionId },
    );
    const createResult = await graphql<{ createCollection: { id: string; isEnabled: boolean } }>(
      request,
      token,
      `
        mutation CreateCollection($input: CollectionCreateInput!) {
          createCollection(input: $input) {
            id
            endpointId
            isEnabled
          }
        }
      `,
      {
        input: {
          endpointId,
        },
      },
    );
    const collectionId = createResult.createCollection.id;
    expect(createResult.createCollection.isEnabled).toBe(true);

    await graphql<{ updateCollection: { id: string; isEnabled: boolean } }>(
      request,
      token,
      `
        mutation DisableCollection($id: ID!) {
          updateCollection(id: $id, input: { isEnabled: false }) {
            id
            isEnabled
          }
        }
      `,
      { id: collectionId },
    );

    const disabledResponse = await request.post(METADATA_GRAPHQL_ENDPOINT, {
      data: {
        query: `
          mutation Trigger($collectionId: ID!) {
            triggerCollection(collectionId: $collectionId) {
              id
            }
          }
        `,
        variables: { collectionId },
      },
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Metadata-Test-Write": "1",
      },
    });
    const disabledPayload = (await disabledResponse.json()) as {
      data?: unknown;
      errors?: Array<{ extensions?: { code?: string } }>;
    };
    expect(disabledPayload.errors?.[0]?.extensions?.code).toBe("E_COLLECTION_DISABLED");

    await graphql<{ updateCollection: { id: string; isEnabled: boolean; scheduleCron: string | null } }>(
      request,
      token,
      `
        mutation EnableCollection($id: ID!) {
          updateCollection(id: $id, input: { isEnabled: true, scheduleCron: null }) {
            id
            isEnabled
            scheduleCron
          }
        }
      `,
      { id: collectionId },
    );

    const triggerResult = await graphql<{ triggerCollection: { id: string; status: string } }>(
      request,
      token,
      `
        mutation Trigger($collectionId: ID!) {
          triggerCollection(collectionId: $collectionId) {
            id
            status
          }
        }
      `,
      { collectionId },
    );
    expect(
      ["QUEUED", "RUNNING", "SUCCEEDED", "SKIPPED"].includes(triggerResult.triggerCollection.status),
    ).toBeTruthy();

    const runsResult = await graphql<{
      collectionRuns: Array<{ id: string; collectionId?: string | null; endpoint?: { id: string } | null }>;
    }>(
      request,
      token,
      `
        query CollectionRuns($collectionId: ID!) {
          collectionRuns(filter: { collectionId: $collectionId }, first: 5) {
            id
            collectionId
            endpoint {
              id
            }
          }
        }
      `,
      { collectionId },
    );
    expect(
      runsResult.collectionRuns.some(
        (run) => run.collectionId === collectionId && run.endpoint?.id === endpointId,
      ),
    ).toBe(true);

    const deleteResult = await graphql<{ deleteCollection: boolean }>(
      request,
      token,
      `
        mutation DeleteCollection($id: ID!) {
          deleteCollection(id: $id)
        }
      `,
      { id: collectionId },
    );
    expect(deleteResult.deleteCollection).toBe(true);
    const emptyResult = await graphql<{ collections: Array<{ id: string }> }>(
      request,
      token,
      `
        query Collections($endpointId: ID!) {
          collections(endpointId: $endpointId) {
            id
          }
        }
      `,
      { endpointId },
    );
    expect(emptyResult.collections).toHaveLength(0);
  });
});

async function waitForCollectionIdle(request: any, token: string, collectionId: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const runs = await graphql<{
      collectionRuns: Array<{ status: string }>;
    }>(
      request,
      token,
      `
        query CollectionRuns($collectionId: ID!) {
          collectionRuns(filter: { collectionId: $collectionId }, first: 5) {
            status
          }
        }
      `,
      { collectionId },
    );
    const hasRunning = runs.collectionRuns.some((run) => run.status === "RUNNING");
    if (!hasRunning) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for collection ${collectionId} to become idle`);
}
