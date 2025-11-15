import { test, expect } from "@playwright/test";
import { ensureCatalogSeed, fetchKeycloakToken, graphql } from "./helpers/metadata";

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
});
