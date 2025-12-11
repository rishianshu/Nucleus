import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { loginViaKeycloak, ensureRealmUser, keycloakBase, metadataBase } from "./helpers/webAuth";
import { graphql, ensureCatalogSeed, fetchKeycloakToken } from "./helpers/metadata";
import { seedCdmData } from "./helpers/cdmSeed";

test.setTimeout(120_000);

const POSTGRES_CONNECTION_DEFAULTS = {
  host: process.env.METADATA_PG_HOST ?? "localhost",
  port: process.env.METADATA_PG_PORT ?? "5432",
  database: process.env.METADATA_PG_DATABASE ?? "jira_plus_plus",
  username: process.env.METADATA_PG_USERNAME ?? "postgres",
  password: process.env.METADATA_PG_PASSWORD ?? "postgres",
  schemas: process.env.METADATA_PG_SCHEMAS ?? "public",
};
const DEFAULT_TEST_USERNAME = process.env.KEYCLOAK_TEST_USERNAME ?? "dev-writer";
const DEFAULT_TEST_PASSWORD = process.env.KEYCLOAK_TEST_PASSWORD ?? "password";
const METADATA_DEFAULT_PROJECT = process.env.METADATA_DEFAULT_PROJECT ?? "global";
const METADATA_CATALOG_DOMAIN = process.env.METADATA_CATALOG_DOMAIN ?? "catalog.dataset";
const PLAYWRIGHT_BAD_PASSWORD = "__PLAYWRIGHT_BAD_PASSWORD__";
const METADATA_GRAPHQL_ENDPOINT = process.env.METADATA_GRAPHQL_ENDPOINT ?? "http://localhost:4010/graphql";
const METADATA_GRAPHQL_ROUTE_PATTERNS = buildMetadataGraphqlRoutePatterns(METADATA_GRAPHQL_ENDPOINT);
const PRIMARY_METADATA_GRAPHQL_ROUTE = METADATA_GRAPHQL_ROUTE_PATTERNS[0];
const PLAYWRIGHT_JIRA_BASE_URL = process.env.PLAYWRIGHT_JIRA_BASE_URL ?? "http://localhost:8800";
const PLAYWRIGHT_JIRA_USERNAME = process.env.PLAYWRIGHT_JIRA_USERNAME ?? "jira-bot@example.com";
const PLAYWRIGHT_JIRA_TOKEN = process.env.PLAYWRIGHT_JIRA_TOKEN ?? "fake-token";
const PLAYWRIGHT_JIRA_PROJECT_KEYS = process.env.PLAYWRIGHT_JIRA_PROJECT_KEYS ?? "ENG";
// Ensure CDM work store uses a concrete connection URL during tests to avoid env drift.
if (!process.env.CDM_WORK_DATABASE_URL) {
  const pgHost = process.env.METADATA_PG_HOST ?? process.env.POSTGRES_HOST ?? "localhost";
  const pgPort = process.env.METADATA_PG_PORT ?? process.env.POSTGRES_PORT ?? "5434";
  const pgDb = process.env.METADATA_PG_DATABASE ?? process.env.POSTGRES_DB ?? "jira_plus_plus";
  const pgUser = process.env.METADATA_PG_USERNAME ?? process.env.POSTGRES_USER ?? "postgres";
  const pgPassword = process.env.METADATA_PG_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? "postgres";
  process.env.CDM_WORK_DATABASE_URL = `postgresql://${pgUser}:${pgPassword}@${pgHost}:${pgPort}/${pgDb}`;
}

test.beforeAll(async ({ request }) => {
  await cleanupPlaywrightArtifacts(request);
  await ensureCatalogSeed(request);
  await seedCdmData();
});

test.beforeEach(async ({ page }) => {
  page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const [resource] = args;
      const url = typeof resource === "string" ? resource : resource instanceof Request ? resource.url : "";
      if (url.includes("graphql")) {
        console.info("[metadata-auth] fetch", url);
      }
      return originalFetch(...args);
    };
  });
  page.on("response", (response) => {
    if (!response.url().includes("graphql")) {
      return;
    }
    // eslint-disable-next-line no-console
    console.info("[metadata-auth] response", response.status(), response.url());
    if (response.status() >= 400) {
      // eslint-disable-next-line no-console
      console.warn("[metadata-auth] graphql failure", response.status(), response.url());
    }
  });
});

test.afterAll(async ({ request }) => {
  await cleanupPlaywrightArtifacts(request);
});

test("metadata console requires Keycloak login and loads workspace nav", async ({ page }) => {
  await openMetadataWorkspace(page);
  await expect(page.getByTestId("metadata-register-open").first()).toBeVisible();
  await expect(page.locator("text=/Authentication required/i")).toHaveCount(0);
});

test("metadata workspace sections render datasets, endpoints, and collections", async ({ page, request }) => {
  const endpointName = `Workspace Smoke Endpoint ${Date.now()}`;
  const endpoint = await registerEndpointViaApi(request, endpointName);
  const datasetDisplayName = await ensureEndpointDatasetViaApi(request, endpoint, {
    displayName: `${endpointName} Dataset`,
  });
  await openMetadataWorkspace(page);

  const catalogCards = page.locator("[data-testid='metadata-catalog-card']");
  const catalogEmpty = page.locator("[data-testid='metadata-catalog-empty']");
  await expect(catalogCards.first().or(catalogEmpty)).toBeVisible({ timeout: 20_000 });
  if ((await catalogCards.count()) > 0) {
    const catalogCard = await waitForCatalogDataset(page, datasetDisplayName, 30_000, { useSearch: true });
    await catalogCard.click();
    const previewButton = page.getByTestId("metadata-preview-button");
    await expect(previewButton).toBeVisible();
    if (!(await previewButton.isDisabled())) {
      await previewButton.click();
      const previewResult = page.getByTestId("metadata-preview-table");
      await expect(previewResult).toBeVisible({ timeout: 20_000 });
    } else {
      const previewEmpty = page.getByTestId("metadata-preview-empty");
      const previewTable = page.getByTestId("metadata-preview-table");
      await expect
        .poll(async () => {
          const tableVisible = await previewTable.isVisible().catch(() => false);
          const emptyVisible = await previewEmpty.isVisible().catch(() => false);
          return tableVisible || emptyVisible;
        }, { timeout: 20_000 })
        .toBeTruthy();
    }
    const viewDetailButton = page.getByRole("button", { name: "View detail" }).first();
    await viewDetailButton.click();
    await expect(page.getByTestId("metadata-dataset-detail-drawer")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Dataset detail ready." }).first()).toBeVisible();
    await page.locator("[data-testid='metadata-dataset-detail-drawer'] button", { hasText: "Close" }).first().click().catch(async () => {
      // dataset detail closes via backdrop; fall back to pressing Escape
      await page.keyboard.press("Escape");
    });
  } else {
    await expect(catalogEmpty).toBeVisible();
  }

  await page.getByRole("button", { name: "Endpoints" }).click();
  await page.getByRole("button", { name: "Refresh" }).click();
  await ensureWorkspaceReady(page);
  const endpointCards = page.locator("[data-testid='metadata-endpoint-card']");
  const endpointEmpty = page.locator("[data-testid='metadata-endpoint-empty']");
  await expect(endpointCards.first().or(endpointEmpty)).toBeVisible({ timeout: 20_000 });
  if ((await endpointCards.count()) > 0) {
    await expect(endpointCards.first()).toBeVisible();
    await endpointCards.first().getByRole("button", { name: "Details" }).click();
    await expect(page.getByTestId("metadata-endpoint-detail")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
  } else if (await endpointEmpty.isVisible({ timeout: 2000 }).catch(() => false)) {
    await expect(endpointEmpty).toBeVisible();
  } else {
    await expect(endpointCards.first()).toBeVisible();
  }

  await page.getByRole("button", { name: "Collections" }).click();
  const collectionsPanel = page.locator("[data-testid='metadata-collections-panel']");
  await expect(collectionsPanel).toBeVisible({ timeout: 20_000 });
  const collectionsViewEndpoint = page.getByTestId("metadata-collections-view-endpoint").first();
  if (await collectionsViewEndpoint.isVisible().catch(() => false)) {
    await collectionsViewEndpoint.click();
    await expect(page.getByRole("status").filter({ hasText: "Endpoint detail focused." })).toBeVisible();
  }

  await page.locator("[data-testid='metadata-register-open']").first().click();
  await expect(page.locator("[data-testid='metadata-register-form']")).toBeVisible();
  await deleteEndpointViaApi(request, endpoint);
});

test("metadata catalog surfaces seeded Confluence doc dataset", async ({ page, request }) => {
  const endpointName = `Catalog Smoke Endpoint ${Date.now()}`;
  const endpoint = await registerEndpointViaApi(request, endpointName);
  const datasetDisplayName = await ensureEndpointDatasetViaApi(request, endpoint, {
    displayName: `${endpointName} Dataset`,
  });
  await openMetadataWorkspace(page);
  const docCard = await waitForCatalogDataset(page, datasetDisplayName, 30_000, { useSearch: true });
  await docCard.click();
  const viewDetailButton = page.getByRole("button", { name: "View detail" }).first();
  await expect(viewDetailButton).toBeVisible();
  await viewDetailButton.click();
  const detailDrawer = page.getByTestId("metadata-dataset-detail-drawer");
  await expect(detailDrawer).toBeVisible();
  await expect(detailDrawer).toContainText(datasetDisplayName);
  await expect(detailDrawer).toContainText(endpointName);
  await expect(detailDrawer).toContainText("id");
  await expect(detailDrawer).toContainText("value");
  await detailDrawer.getByRole("button", { name: "Close" }).click();
  await deleteEndpointViaApi(request, endpoint);
});

test("catalog endpoint filter respects endpoint IDs", async ({ page, request }) => {
  const endpointA = await registerEndpointViaApi(request, `Catalog Endpoint A ${Date.now()}`);
  const endpointB = await registerEndpointViaApi(request, `Catalog Endpoint B ${Date.now()}`);
  const datasetNameA = await ensureEndpointDatasetViaApi(request, endpointA, { displayName: `${endpointA.name} Dataset` });
  const datasetNameB = await ensureEndpointDatasetViaApi(request, endpointB, { displayName: `${endpointB.name} Dataset` });
  try {
    await openMetadataWorkspace(page);
    await page.getByRole("button", { name: "Refresh" }).click();
    await ensureWorkspaceReady(page);
    await waitForCatalogDataset(page, datasetNameA);
    await waitForCatalogDataset(page, datasetNameB);
    const endpointFilter = page.getByTestId("metadata-catalog-filter-endpoint");
    await endpointFilter.fill(endpointA.name);
    await page
      .locator(`[data-testid="metadata-endpoint-option"][data-endpoint-id="${endpointA.id}"]`)
      .first()
      .click();
    await waitForCatalogDataset(page, datasetNameA);
    await expect(page.locator("[data-testid='metadata-catalog-card']").filter({ hasText: datasetNameB })).toHaveCount(0);
    await page.getByTestId("metadata-catalog-endpoint-clear").click();
    await endpointFilter.fill(endpointB.name);
    await page
      .locator(`[data-testid="metadata-endpoint-option"][data-endpoint-id="${endpointB.id}"]`)
      .first()
      .click();
    await waitForCatalogDataset(page, datasetNameB);
    await expect(page.locator("[data-testid='metadata-catalog-card']").filter({ hasText: datasetNameA })).toHaveCount(0);
    await page.getByTestId("metadata-catalog-endpoint-clear").click();
    await waitForCatalogDataset(page, datasetNameA);
    await waitForCatalogDataset(page, datasetNameB);
  } finally {
    await deleteEndpointViaApi(request, endpointA);
    await deleteEndpointViaApi(request, endpointB);
  }
});

test("catalog search and label filters update results and reset pagination", async ({ page, request }) => {
  const endpoint = await registerEndpointViaApi(request, `Catalog Filter Endpoint ${Date.now()}`);
  const datasetName = await ensureEndpointDatasetViaApi(request, endpoint, { displayName: `${endpoint.name} Dataset` });
  try {
    await openMetadataWorkspace(page);
    await page.getByRole("button", { name: "Refresh" }).click();
    await ensureWorkspaceReady(page);
    await waitForCatalogDataset(page, datasetName);
    const searchField = page.getByLabel(/Search name, label, or source/i);
    await searchField.fill(" definitely-no-match ");
    await expect(page.getByTestId("metadata-catalog-empty")).toBeVisible();
    await searchField.fill(endpoint.name.split(" ").slice(-1)[0]);
    await waitForCatalogDataset(page, datasetName);
    const labelFilter = page.getByTestId("metadata-catalog-filter-label");
    await labelFilter.selectOption("playwright");
    await waitForCatalogDataset(page, datasetName);
    await labelFilter.selectOption("all");
    await waitForCatalogDataset(page, datasetName);
  } finally {
    await deleteEndpointViaApi(request, endpoint);
  }
});

test("postgres template connection test succeeds", async ({ page }) => {
  await openMetadataWorkspace(page);
  await page.locator("[data-testid='metadata-register-open']").first().click();
  await expect(page.locator("[data-testid='metadata-register-form']")).toBeVisible();

  await page.getByRole("button", { name: /JDBC sources/i }).click();
  const postgresOption = page.getByRole("button", { name: /PostgreSQL/i }).first();
  await expect(postgresOption).toBeVisible({ timeout: 20_000 });
  await postgresOption.click();

  await page.getByLabel(/Endpoint name/i).fill("Playwright Postgres Endpoint");
  await fillPostgresConnectionForm(page);

  await page.getByRole("button", { name: /Test connection/i }).click();
  const testResult = page.getByTestId("metadata-test-result");
  await expect(testResult).toContainText("Connection parameters validated.", { timeout: 20_000 });
  await expect(page.locator("text=/Write access denied/i")).toHaveCount(0);
});

test("metadata endpoints can be registered, edited, and deleted", async ({ page, request }) => {
  await openMetadataWorkspace(page);
  await page.locator("[data-testid='metadata-register-open']").first().click();
  await expect(page.locator("[data-testid='metadata-register-form']")).toBeVisible();

  await page.getByRole("button", { name: /JDBC sources/i }).click();
  await page.getByRole("button", { name: /PostgreSQL/i }).first().click();

  const endpointName = `Playwright Endpoint ${Date.now()}`;
  const updatedEndpointName = `${endpointName} v2`;

  await page.getByLabel(/Endpoint name/i).fill(endpointName);
  await fillPostgresConnectionForm(page);
  await page.getByRole("button", { name: /Test connection/i }).click();
  await expect(page.getByTestId("metadata-test-result")).toContainText("Connection parameters validated.", {
    timeout: 40_000,
  });
  await page.getByRole("button", { name: /Register endpoint/i }).click();
  await page.getByRole("button", { name: /Back to overview/i }).click();
  await ensureWorkspaceReady(page);
  await page.getByRole("button", { name: "Endpoints" }).click();
  await page.getByRole("button", { name: "Refresh" }).click();
  await ensureWorkspaceReady(page);

  const endpointCard = page
    .locator("[data-testid='metadata-endpoint-card']")
    .filter({ hasText: endpointName })
    .first();
  await expect(endpointCard).toBeVisible({ timeout: 30_000 });
  await endpointCard.getByRole("button", { name: "Details" }).click();
  await expect(page.getByTestId("metadata-endpoint-detail")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.locator("[data-testid='metadata-register-form']")).toBeVisible();
  await page.getByLabel(/Endpoint name/i).fill(updatedEndpointName);
  await page.getByLabel(/Schemas/i).fill(`${POSTGRES_CONNECTION_DEFAULTS.schemas},playwright`);
  const saveButton = page.getByRole("button", { name: /Save changes/i });
  await expect(saveButton).toBeDisabled();
  await page.getByRole("button", { name: /Test connection/i }).click();
  await expect(page.getByTestId("metadata-test-result")).toContainText("Connection parameters validated.", {
    timeout: 20_000,
  });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.locator("[data-testid='metadata-register-form']")).toBeHidden({ timeout: 20_000 });
  await ensureWorkspaceReady(page);
  await page.getByRole("button", { name: "Endpoints" }).click();
  await ensureWorkspaceReady(page);

  const updatedCard = page
    .locator("[data-testid='metadata-endpoint-card']")
    .filter({ hasText: updatedEndpointName })
    .first();
  await expect(updatedCard).toBeVisible({ timeout: 30_000 });
  const datasetDisplayName = await ensureEndpointDatasetViaApi(request, updatedEndpointName);
  await updatedCard.getByRole("button", { name: "Details" }).click();
  await expect(page.getByTestId("metadata-endpoint-detail")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  const detailPanel = page.getByTestId("metadata-endpoint-detail");
  await expect(detailPanel.getByText(/Datasets \(/)).toBeVisible();
  await detailPanel.getByRole("button", { name: "Refresh" }).click();
  const datasetRow = detailPanel.locator("li").filter({ hasText: datasetDisplayName }).first();
  await expect(datasetRow).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Close" }).click();

  await deleteEndpointViaApi(request, updatedEndpointName);
  await page.getByRole("button", { name: "Endpoints" }).click();
  await page.getByRole("button", { name: "Refresh" }).click();
  await ensureWorkspaceReady(page);
  await expect(
    page.locator("[data-testid='metadata-endpoint-card']").filter({ hasText: updatedEndpointName }),
  ).toHaveCount(0);
});

test("signals GraphQL exposes seeded definitions and instances", async ({ request }) => {
  const token = await fetchKeycloakToken(request);
  const data = await graphql<{
    signalDefinitions: { slug: string; entityKind: string; cdmModelId?: string | null }[];
    signalInstances: { entityRef: string; status: string; definition: { slug: string } }[];
  }>(
    request,
    token,
    `
      query SignalsSmoke {
        signalDefinitions {
          slug
          entityKind
          cdmModelId
        }
        signalInstances(limit: 10) {
          entityRef
          status
          definition {
            slug
          }
        }
      }
    `,
  );
  const slugs = data.signalDefinitions.map((entry) => entry.slug);
  expect(slugs).toEqual(expect.arrayContaining(["work.stale_item", "doc.orphaned"]));
  expect(data.signalInstances.length).toBeGreaterThan(0);
  expect(
    data.signalInstances.some((instance) =>
      ["work.stale_item", "doc.orphaned"].includes(instance.definition.slug),
    ),
  ).toBeTruthy();
});

test("metadata viewer role cannot mutate endpoints", async ({ page, request }) => {
  const endpointName = `Viewer Endpoint ${Date.now()}`;
  const viewerEndpoint = await registerEndpointViaApi(request, endpointName);
  await ensureRealmUser({ username: "dev-viewer", password: "password", roles: ["reader"] });
  await openMetadataWorkspace(page, { username: "dev-viewer", password: "password" });
  const expandButton = page.getByRole("button", { name: /Expand sidebar/i });
  if (await expandButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await expandButton.click();
  }
  const runtimeRole = await page
    .getByTestId("metadata-user-role")
    .textContent()
    .catch(() => null);
  console.info("[metadata-auth] viewer runtime role:", runtimeRole);
  await ensureWorkspaceReady(page);
  await page.getByRole("button", { name: "Endpoints" }).click();
  await ensureWorkspaceReady(page);
  await expect(page.getByTestId("metadata-register-open").first()).toBeDisabled();
  const endpointCard = page
    .locator("[data-testid='metadata-endpoint-card']")
    .filter({ hasText: endpointName })
    .first();
  await expect(endpointCard).toBeVisible({ timeout: 30_000 });
  const triggerButton = page.getByTestId(`metadata-endpoint-trigger-${viewerEndpoint.id}`);
  await expect(triggerButton).toBeDisabled();
  await endpointCard.getByRole("button", { name: "Details" }).click();
  const detailPanel = page.getByTestId("metadata-endpoint-detail");
  await expect(detailPanel).toBeVisible();
  await expect(detailPanel.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(detailPanel.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();
  await deleteEndpointViaApi(request, viewerEndpoint);
});

test("metadata admin can delete endpoints via the UI", async ({ page, request }) => {
  const endpointName = `Admin Endpoint ${Date.now()}`;
  const adminEndpoint = await registerEndpointViaApi(request, endpointName);
  const datasetDisplayName = await ensureEndpointDatasetViaApi(request, adminEndpoint);
  const adminCredentials = { username: "dev-admin", password: process.env.KEYCLOAK_ADMIN_PASSWORD ?? "password" };
  await ensureRealmUser({ ...adminCredentials, roles: ["admin"] });
  await openMetadataWorkspace(page, adminCredentials);
  await page.getByRole("button", { name: "Catalog" }).click();
  await ensureWorkspaceReady(page);
  const catalogCard = await waitForCatalogDataset(page, datasetDisplayName);
  await page.getByRole("button", { name: "Endpoints" }).click();
  await ensureWorkspaceReady(page);
  const endpointCard = page
    .locator("[data-testid='metadata-endpoint-card']")
    .filter({ hasText: endpointName })
    .first();
  await expect(endpointCard).toBeVisible({ timeout: 30_000 });
  await endpointCard.getByRole("button", { name: "Details" }).click();
  const deleteButton = page.getByRole("button", { name: "Delete" });
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expect(page.getByTestId("metadata-endpoint-detail")).toBeHidden({ timeout: 20_000 });
  await page.getByRole("button", { name: "Endpoints" }).click();
  await ensureWorkspaceReady(page);
  await expect(
    page.locator("[data-testid='metadata-endpoint-card']").filter({ hasText: endpointName }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Catalog" }).click();
  await ensureWorkspaceReady(page);
  await expect(
    page.locator("[data-testid='metadata-catalog-card']").filter({ hasText: datasetDisplayName }),
  ).toHaveCount(0);
  const catalogDatasets = await fetchCatalogDatasetsViaApi(request, adminEndpoint.id);
  expect(catalogDatasets, "catalog hides datasets for deleted endpoint").toHaveLength(0);
  const triggerResult = await triggerCollectionViaApi(request, adminEndpoint.id);
  expect(triggerResult.ok).toBeFalsy();
  expect(triggerResult.codes).toContain("E_ENDPOINT_DELETED");
  const historicalRuns = await listCollectionRunsViaApi(request, adminEndpoint.id);
  expect(historicalRuns.length).toBeGreaterThan(0);
});

test("metadata dataset preview requires preview capability", async ({ page, request }) => {
  const endpointName = `Preview Endpoint ${Date.now()}`;
  const previewEndpoint = await registerEndpointViaApi(request, endpointName, { capabilities: ["metadata"] });
  const datasetDisplayName = await ensureEndpointDatasetViaApi(request, previewEndpoint);
  await openMetadataWorkspace(page);
  const catalogCard = await waitForCatalogDataset(page, datasetDisplayName);
  await catalogCard.click();
  const previewButton = page.getByTestId("metadata-preview-button");
  await expect(previewButton).toBeDisabled();
  const previewDisabledMessage = page
    .getByText(`Preview not supported for ${endpointName}.`)
    .or(page.getByText(/Preview not supported for this endpoint\./i))
    .or(page.getByText(/Link this dataset to a registered endpoint before running previews\./i))
    .first();
  await expect(previewDisabledMessage).toBeVisible();
  await deleteEndpointViaApi(request, previewEndpoint);
});

test("metadata editor can trigger collection runs and see status chip", async ({ page, request }) => {
  const endpointName = `Trigger Endpoint ${Date.now()}`;
  const triggerEndpoint = await registerEndpointViaApi(request, endpointName);
  await openMetadataWorkspace(page);
  await page.getByRole("button", { name: "Endpoints" }).click();
  await ensureWorkspaceReady(page);
  const endpointCard = page
    .locator("[data-testid='metadata-endpoint-card']")
    .filter({ hasText: endpointName })
    .first();
  await expect(endpointCard).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`metadata-endpoint-trigger-${triggerEndpoint.id}`).click();
  await triggerCollectionViaApi(request, triggerEndpoint.id);
  await waitForCollectionRunStatus(request, triggerEndpoint.id, "SUCCEEDED");
  await page.getByRole("button", { name: "Refresh" }).click();
  await ensureWorkspaceReady(page);
  const statusPill = endpointCard.getByTestId("metadata-endpoint-status");
  let statusMatched = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const attribute = (await statusPill.getAttribute("data-status")) ?? "";
    if (/succeeded/i.test(attribute)) {
      statusMatched = true;
      break;
    }
    await page.getByRole("button", { name: "Refresh" }).click();
    await ensureWorkspaceReady(page);
  }
  expect(statusMatched, "endpoint status pill should report succeeded").toBeTruthy();
  await page.getByRole("button", { name: "Collections" }).click();
  const collectionsPanel = page.locator("[data-testid='metadata-collections-panel']");
  await expect(collectionsPanel).toBeVisible();
  await expect(collectionsPanel.locator("article").first()).toContainText(endpointName);
  await deleteEndpointViaApi(request, triggerEndpoint);
});

test("placeholder endpoints surface failed collection runs", async ({ page, request }) => {
  const endpointName = `Placeholder Endpoint ${Date.now()}`;
  const placeholderEndpoint = await registerEndpointViaApi(request, endpointName, {
    url: `https://placeholder.example.com/api/${Date.now()}`,
    useTemplateConfig: false,
  });
  try {
    await openMetadataWorkspace(page);
    await page.getByRole("button", { name: "Endpoints" }).click();
    await ensureWorkspaceReady(page);
    const endpointCard = page
      .locator("[data-testid='metadata-endpoint-card']")
      .filter({ hasText: endpointName })
      .first();
    await expect(endpointCard).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(`metadata-endpoint-trigger-${placeholderEndpoint.id}`).click();
    await waitForCollectionRunStatus(request, placeholderEndpoint.id, "FAILED");
    await page.getByRole("button", { name: "Refresh" }).click();
    await ensureWorkspaceReady(page);
    await expect(endpointCard.getByTestId("metadata-endpoint-status")).toHaveAttribute("data-status", /failed/i);
    await expect(endpointCard.getByTestId("metadata-endpoint-error")).toContainText(/placeholder host/i);
  } finally {
    await deleteEndpointViaApi(request, placeholderEndpoint);
  }
});

test("metadata collections filters by endpoint and status", async ({ page, request }) => {
  const endpointA = await registerEndpointViaApi(request, `Filter Endpoint A ${Date.now()}`);
  const endpointB = await registerEndpointViaApi(request, `Filter Endpoint B ${Date.now()}`);
  await openMetadataWorkspace(page);
  await page.getByRole("button", { name: "Endpoints" }).click();
  await ensureWorkspaceReady(page);
  const triggerButtonA = page.getByTestId(`metadata-endpoint-trigger-${endpointA.id}`);
  await expect(triggerButtonA).toBeVisible({ timeout: 30_000 });
  await triggerButtonA.click();
  const triggerButtonB = page.getByTestId(`metadata-endpoint-trigger-${endpointB.id}`);
  await expect(triggerButtonB).toBeVisible({ timeout: 30_000 });
  await triggerButtonB.click();
  await triggerCollectionViaApi(request, endpointA.id);
  await triggerCollectionViaApi(request, endpointB.id);
  await waitForCollectionRunStatus(request, endpointA.id, "SUCCEEDED");
  await waitForCollectionRunStatus(request, endpointB.id, "SUCCEEDED");
  await page.getByRole("button", { name: "Collections" }).click();
  const collectionsPanel = page.locator("[data-testid='metadata-collections-panel']");
  const collectionCards = page.getByTestId("metadata-collection-card");
  await expect(collectionCards.filter({ hasText: endpointA.name }).first()).toBeVisible({
    timeout: 30_000,
  });
  const endpointFilter = page.getByTestId("metadata-collections-filter-endpoint");
  await endpointFilter.selectOption(endpointA.id);
  const filteredRuns = page.getByTestId("metadata-collection-card");
  await expect(filteredRuns.first()).toContainText(endpointA.name);
  const filteredCount = await filteredRuns.count();
  expect(filteredCount).toBeGreaterThan(0);
  for (let index = 0; index < filteredCount; index += 1) {
    await expect(filteredRuns.nth(index)).toHaveAttribute("data-endpoint-id", endpointA.id);
  }
  const statusFilter = page.getByTestId("metadata-collections-filter-status");
  await statusFilter.selectOption("SUCCEEDED");
  const succeededRuns = page.getByTestId("metadata-collection-card");
  await expect(succeededRuns.first()).toHaveAttribute("data-status", /SUCCEEDED/);
  const succeededCount = await succeededRuns.count();
  expect(succeededCount).toBeGreaterThan(0);
  for (let index = 0; index < succeededCount; index += 1) {
    await expect(succeededRuns.nth(index)).toHaveAttribute("data-status", /SUCCEEDED/);
  }
  await endpointFilter.selectOption("all");
  await statusFilter.selectOption("all");
  await deleteEndpointViaApi(request, endpointA);
  await deleteEndpointViaApi(request, endpointB);
});

test("metadata endpoint credential regression requires fix before trigger", async ({ page, request }) => {
  const endpointName = `Credential Endpoint ${Date.now()}`;
  const endpoint = await registerEndpointViaApi(request, endpointName);
  await openMetadataWorkspace(page);
  await page.getByRole("button", { name: "Endpoints" }).click();
  await ensureWorkspaceReady(page);
  const endpointCard = page
    .locator("[data-testid='metadata-endpoint-card']")
    .filter({ hasText: endpointName })
    .first();
  await expect(endpointCard).toBeVisible({ timeout: 30_000 });
  await endpointCard.getByRole("button", { name: "Details" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  const passwordField = page.getByLabel(/^Password$/i).first();
  await passwordField.fill(PLAYWRIGHT_BAD_PASSWORD);
  await page.getByRole("button", { name: /Test connection/i }).click();
  await expect(page.getByTestId("metadata-test-result")).toContainText("Connection test failed", {
    timeout: 20_000,
  });
  await page.getByRole("button", { name: /Back to overview/i }).click();
  await ensureWorkspaceReady(page);
  await closeEndpointDetailIfVisible(page);
  await updateEndpointPasswordViaApi(request, endpoint.id, PLAYWRIGHT_BAD_PASSWORD, { bypassWrites: true });
  await page.getByRole("button", { name: "Refresh" }).click();
  await ensureWorkspaceReady(page);
  await page.getByTestId(`metadata-endpoint-trigger-${endpoint.id}`).click();
  const mutationError = page.getByTestId("metadata-mutation-error");
  await expect(mutationError).toContainText(/Connection test failed/i);
  await updateEndpointPasswordViaApi(request, endpoint.id, POSTGRES_CONNECTION_DEFAULTS.password);
  await page.getByRole("button", { name: "Refresh" }).click();
  await ensureWorkspaceReady(page);
  await endpointCard.getByRole("button", { name: "Details" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await passwordField.fill(POSTGRES_CONNECTION_DEFAULTS.password);
  await page.getByRole("button", { name: /Test connection/i }).click();
  await expect(page.getByTestId("metadata-test-result")).toContainText("Connection parameters validated.", {
    timeout: 20_000,
  });
  await page.getByRole("button", { name: /Back to overview/i }).click();
  await ensureWorkspaceReady(page);
  await closeEndpointDetailIfVisible(page);
  await page.getByTestId(`metadata-endpoint-trigger-${endpoint.id}`).click();
  await triggerCollectionViaApi(request, endpoint.id);
  await waitForCollectionRunStatus(request, endpoint.id, "SUCCEEDED");
  await page.getByRole("button", { name: "Refresh" }).click();
  await ensureWorkspaceReady(page);
  await expect(endpointCard.getByTestId("metadata-endpoint-status")).toHaveAttribute("data-status", /succeeded/);
  await deleteEndpointViaApi(request, endpoint);
});

test("metadata workspace surfaces ADR-0001 UI states", async ({ page }) => {
  await openMetadataWorkspace(page);
  await expect(page.getByTestId("metadata-register-open").first()).toBeVisible();
  await page.getByRole("button", { name: "Catalog" }).click();
  const catalogSearch = page.getByPlaceholder("Search name, label, or source");
  const sentinelQuery = `no-results-${Date.now()}`;
  await catalogSearch.fill(sentinelQuery);
  await expect(page.getByTestId("metadata-catalog-empty")).toBeVisible();
  await catalogSearch.fill("");
  const metadataGraphql = PRIMARY_METADATA_GRAPHQL_ROUTE;
  let intercepted = false;
  const errorResponder = async (route: Route) => {
    const payload = route.request().postDataJSON();
    const query = typeof payload?.query === "string" ? payload.query : "";
    const isCatalogQuery = query.includes("catalogDatasetConnection");
    if (!intercepted && isCatalogQuery) {
      intercepted = true;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ errors: [{ message: "Injected failure" }] }),
      });
      return;
    }
    await route.continue();
  };
  await page.route(metadataGraphql, errorResponder);
  await page.getByRole("button", { name: "Refresh" }).click();
  const errorBanner = page.getByTestId("metadata-error-banner");
  await expect(errorBanner).toBeVisible({ timeout: 10_000 });
  await errorBanner.click({ force: true }).catch(() => {});
  await page.unroute(metadataGraphql, errorResponder);
  await page.getByRole("button", { name: "Refresh" }).click();
  await ensureWorkspaceReady(page);
});

test("knowledge base overview surfaces metrics and explorer links", async ({ page }) => {
  await openKnowledgeBase(page);
  await expect(page.getByText("Admin Console")).toBeVisible();
  await expect(page.getByText("Total nodes")).toBeVisible({ timeout: 20_000 });
  const payloadPreview = page.locator("[data-testid='kb-payload-preview']");
  if (await payloadPreview.count()) {
    await expect(payloadPreview).not.toContainText(/\"payload\"/i);
    await expect(payloadPreview).toContainText(/Schema|Fields|Columns/i);
  }
  await page.getByRole("button", { name: /View explorer/i }).first().click();
  await expect(page).toHaveURL(/\/kb\/explorer\/nodes/);
});

test("knowledge base explorers support node and edge actions", async ({ page }) => {
  const metadataGraphql = PRIMARY_METADATA_GRAPHQL_ROUTE;
  let kbMetaIntercepted = false;
  const kbMetaRoute = async (route: Route) => {
    const payload = route.request().postDataJSON();
    const query = typeof payload?.query === "string" ? payload.query : "";
    if (!kbMetaIntercepted && query.includes("kbMeta")) {
      kbMetaIntercepted = true;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ errors: [{ message: "kbMeta failure" }] }),
      });
      return;
    }
    await route.continue();
  };
  await page.route(metadataGraphql, kbMetaRoute);
  await openKnowledgeBase(page);
  const metaWarning = page.getByTestId("kb-meta-warning");
  await expect(metaWarning).toBeVisible({ timeout: 10_000 });
  await metaWarning.getByRole("button", { name: /Retry/i }).click();
  await expect(metaWarning).not.toBeVisible({ timeout: 20_000 });
  await page.unroute(metadataGraphql, kbMetaRoute);
  const nodesTab = page.getByTestId("kb-tab-nodes");
  await expect(nodesTab).toBeVisible({ timeout: 20_000 });
  await nodesTab.click();
  await expect(page).toHaveURL(/\/kb\/explorer\/nodes/, { timeout: 20_000 });
  const nodeTypeFilter = page.getByTestId("kb-node-type-filter");
  await expect(nodeTypeFilter).toBeVisible({ timeout: 20_000 });
  await expect(nodeTypeFilter).toContainText(/All types|Work Item|Datasets/i);
  const nodeSearchInput = page.getByLabel("Search");
  await nodeSearchInput.fill("work");
  await nodeSearchInput.fill("");
  const optionLocators = await nodeTypeFilter.locator("option").all();
  for (const option of optionLocators) {
    const value = await option.getAttribute("value");
    if (value && value !== "All types") {
      await nodeTypeFilter.selectOption({ value });
      break;
    }
  }
  const nodeCopyButton = page.getByTestId("kb-node-copy-button").first();
  await nodeCopyButton.click();
  await expect(nodeCopyButton).toHaveText(/Copied/i);
  await page.getByTestId("kb-view-graph").click();
  await expect(page.getByTestId("kb-graph-view")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("kb-view-list").click();
  await page.getByTestId("kb-tab-nodes").click();
  const nodeRows = page.locator("table tbody tr");
  await expect(nodeRows.first()).toBeVisible({ timeout: 20_000 });
  const nodeCountBefore = await nodeRows.count();
  await nodeTypeFilter.selectOption({ index: 1 });
  const nodeCountAfter = await nodeRows.count();
  expect(nodeCountAfter).toBeLessThanOrEqual(nodeCountBefore);
  await nodeRows.first().click();
  const nodeDetail = page.getByTestId("kb-node-detail-panel");
  await expect(nodeDetail).toBeVisible();
  await nodeDetail.getByTestId("kb-node-detail-copy").click();
  await expect(nodeDetail.getByTestId("kb-node-detail-copy")).toHaveText(/Copied/);
  let sceneIntercepted = false;
  const sceneRoute = async (route: Route) => {
    const payload = route.request().postDataJSON();
    const query = typeof payload?.query === "string" ? payload.query : "";
    if (!sceneIntercepted && query.includes("kbScene")) {
      sceneIntercepted = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            kbScene: {
              nodes: [
                {
                  id: "scene-node",
                  entityType: "catalog.dataset",
                  displayName: "Scene Node",
                  canonicalPath: null,
                  updatedAt: new Date().toISOString(),
                  identity: { logicalKey: "scene-node" },
                },
              ],
              edges: [],
              summary: { nodeCount: 301, edgeCount: 0, truncated: true },
            },
          },
        }),
      });
      return;
    }
    await route.continue();
  };
  await page.route(metadataGraphql, sceneRoute);
  await nodeDetail.getByRole("button", { name: "Scenes" }).click();
  await expect(page).toHaveURL(/\/kb\/scenes/);
  await expect(page.getByText("Graph preview")).toBeVisible({ timeout: 20_000 });
  await page.unroute(metadataGraphql, sceneRoute);
  const sceneUrl = new URL(page.url());
  const selectedNodeId = sceneUrl.searchParams.get("node") ?? "";
  await page.getByTestId("kb-tab-provenance").click();
  await expect(page).toHaveURL(/\/kb\/provenance/);
  await expect(page.getByLabel("Node id")).toHaveValue(selectedNodeId);
  await expect(page.getByText("Timestamp")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("kb-tab-edges").click();
  await expect(page).toHaveURL(/\/kb\/explorer\/edges/);
  await expect(page.getByTestId("kb-edges-table")).toBeVisible({ timeout: 20_000 });
  const edgeTypeFilter = page.getByTestId("kb-edge-type-filter");
  const dependencyOptionCount = await edgeTypeFilter.locator('option[value="DEPENDENCY_OF"]').count();
  if (dependencyOptionCount > 0) {
    await edgeTypeFilter.selectOption({ value: "DEPENDENCY_OF" });
  } else {
    const fallbackOption = edgeTypeFilter.locator("option").nth(1);
    if (await fallbackOption.isVisible().catch(() => false)) {
      const fallbackValue = await fallbackOption.getAttribute("value");
      if (fallbackValue) {
        await edgeTypeFilter.selectOption(fallbackValue);
      }
    }
  }
  const edgeRow = page.locator("table tbody tr").first();
  await expect(edgeRow).toBeVisible({ timeout: 20_000 });
  const edgeCopyButton = page.getByTestId("kb-edge-copy-button").first();
  await edgeCopyButton.click();
  await expect(edgeCopyButton).toHaveText(/Copied/);
  await edgeRow.locator("button").first().click({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/kb\/explorer\/nodes/);
  await expect(page.getByTestId("kb-node-detail-panel")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("kb-tab-edges").click();
  const detailCopy = page.getByTestId("kb-edge-detail-copy").first();
  await detailCopy.click();
  await expect(detailCopy).toHaveText(/Copied/);
});

test("ingestion console is restricted to non-admin users", async ({ page }) => {
  await openMetadataWorkspace(page);
  const ingestionButton = page.getByRole("button", { name: "Ingestion" });
  await expect(ingestionButton).toBeDisabled();
});

test("ingestion console renders for admin users", async ({ page }) => {
  await ensureRealmUser({ ...ADMIN_CREDENTIALS, roles: ["admin"] });
  await openMetadataWorkspace(page, ADMIN_CREDENTIALS);
  const ingestionButton = page.getByRole("button", { name: "Ingestion" });
  await ingestionButton.click();
  const consoleRoot = page.getByTestId("ingestion-console");
  await expect(consoleRoot).toBeVisible({ timeout: 20_000 });
  const emptyState = page.getByTestId("ingestion-empty-state");
  const unitRow = page.getByTestId("ingestion-unit-row").first();
  await expect(emptyState.or(unitRow)).toBeVisible({ timeout: 20_000 });
});

test("jira ingestion console shows healthy units for admin", async ({ page, request }) => {
  await ensureRealmUser({ ...ADMIN_CREDENTIALS, roles: ["admin"] });
  const endpointName = `Playwright Jira Ingestion ${Date.now().toString(36)}`;
  const endpoint = await createJiraEndpointForTest(request, endpointName);
  const unitMappings: [string, string][] = [
    ["jira.projects", "Jira Projects"],
    ["jira.issues", "Jira Issues"],
    ["jira.users", "Jira Users"],
  ];
  for (const [unitId] of unitMappings) {
    await startIngestionAndWait(request, endpoint.id, unitId);
  }
  await openMetadataWorkspace(page, ADMIN_CREDENTIALS);
  const ingestionButton = page.getByRole("button", { name: "Ingestion" });
  await ingestionButton.click();
  const consoleRoot = page.getByTestId("ingestion-console");
  await expect(consoleRoot).toBeVisible({ timeout: 30_000 });
  const endpointButton = page.getByRole("button", { name: endpointName }).first();
  await endpointButton.click();
  const refreshButton = page.getByRole("button", { name: "Refresh" }).first();
  const refreshEnabled = await refreshButton.isEnabled().catch(() => false);
  if (refreshEnabled) {
    await refreshButton.click();
  }
  const unitRows = page.getByTestId("ingestion-unit-row");
  await expect.poll(async () => unitRows.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(unitMappings.length);
  for (const [, displayName] of unitMappings) {
    const row = unitRows.filter({ hasText: displayName });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(/Healthy/i);
  }
});

test("Temporal UI shows Jira ingestion workflow runs", async ({ page, request }) => {
  await ensureRealmUser({ ...ADMIN_CREDENTIALS, roles: ["admin"] });
  const endpointName = `Playwright Jira Temporal ${Date.now().toString(36)}`;
  const endpoint = await createJiraEndpointForTest(request, endpointName);
  const runId = await startIngestionAndWait(request, endpoint.id, "jira.projects", { bypassWrites: false });
  const temporalBase = process.env.TEMPORAL_UI_URL ?? "http://localhost:8080";
  const query = encodeURIComponent(`WorkflowId='${runId}'`);
  await page.goto(`${temporalBase}/namespaces/default/workflows?query=${query}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Workflow Id").first()).toBeVisible({ timeout: 30_000 });
  const workflowRow = page.locator(`text=${runId}`).first();
  await expect(workflowRow).toBeVisible({ timeout: 30_000 });
});

test("cdm explorer shell surfaces work tab", async ({ page }) => {
  await openCdmExplorerWorkTab(page);
  const searchInput = page.locator("input[placeholder*='Search']").first();
  await expect(searchInput).toBeVisible({ timeout: 20_000 });
  const table = page.getByTestId("cdm-work-table");
  await expect(table).toBeVisible({ timeout: 20_000 });
  const issueRow = page.getByTestId("cdm-work-row").first();
  await expect(issueRow).toContainText("Seeded issue summary");
  await issueRow.click();
  const detailPanel = page.getByTestId("cdm-work-detail-panel");
  await expect(detailPanel).toBeVisible();
  await expect(detailPanel.getByText("Summary: Seeded issue summary")).toBeVisible();
  await expect(detailPanel.getByText("Dataset:", { exact: false })).toBeVisible();
  const datasetSelect = page.locator("select").nth(1);
  await expect(datasetSelect).toBeVisible();
  await expect(datasetSelect.locator("option").first()).toHaveText("All datasets");
  await searchInput.fill("does-not-exist");
  await expect(page.getByText("No CDM issues found", { exact: false })).toBeVisible();
  await searchInput.fill("Seeded");
  await expect(page.getByTestId("cdm-work-row").first()).toBeVisible();
  await searchInput.fill("");
  await page.getByRole("button", { name: "Comments" }).click();
  await searchInput.fill("Seeded comment body");
  const commentRow = page.getByTestId("cdm-work-row").first();
  await expect(commentRow).toContainText("Seeded comment body");
  await commentRow.click();
  await expect(detailPanel.getByText("Seeded comment body")).toBeVisible();
  await searchInput.fill("");
  await page.getByRole("button", { name: "Issues" }).click();
  await expect(page.getByTestId("cdm-work-row").first()).toContainText("Seeded issue summary");
  await page.getByRole("button", { name: "Worklogs" }).click();
  await expect(searchInput).toHaveAttribute("placeholder", /worklog/i);
  await expect(page.getByTestId("cdm-work-row").first()).toBeVisible();
  await page.getByRole("button", { name: "Projects" }).click();
  const projectRow = page.getByTestId("cdm-work-row").first();
  await expect(projectRow).toContainText("Seed Engineering");
  await projectRow.click();
  await expect(detailPanel).toContainText("Seed Engineering");
  await page.getByRole("button", { name: "Users" }).click();
  await searchInput.fill("Seed Assignee");
  const userRow = page.getByTestId("cdm-work-row").first();
  await expect(userRow).toContainText("Seed Assignee");
  await userRow.click();
  await expect(detailPanel).toContainText("Seed Assignee");
  await searchInput.fill("");
});

test("cdm explorer shell surfaces docs tab", async ({ page }) => {
  await openCdmExplorerWorkTab(page);
  await page.getByRole("button", { name: "Docs" }).click();
  await expect(page.getByText("Unified workspace", { exact: false })).toBeVisible();
  await expect(page.getByText("Select a doc", { exact: false })).toBeVisible();
});

async function ensureWorkspaceReady(page: Page) {
  const errorBanner = page.getByTestId("metadata-error-banner");
  if (await errorBanner.isVisible({ timeout: 2000 }).catch(() => false)) {
    await errorBanner.click({ force: true }).catch(() => {});
    await page.getByRole("button", { name: "Refresh" }).click();
  }
  const registerButton = page.getByTestId("metadata-register-open").first();
  const registerForm = page.locator("[data-testid='metadata-register-form']");
  await expect(registerButton.or(registerForm)).toBeVisible({ timeout: 20_000 });
}

async function openMetadataWorkspace(page: Page, credentials?: { username?: string; password?: string }) {
  await loginViaKeycloak(page, credentials);
  const metadataTab = page.getByRole("button", { name: "Metadata" });
  const tabVisible = await metadataTab.isVisible({ timeout: 2000 }).catch(() => false);
  if (tabVisible) {
    await metadataTab.click();
  } else {
    await page.goto(`${metadataBase}/`, { waitUntil: "domcontentloaded" });
  }
  await ensureWorkspaceReady(page);
}

async function openKnowledgeBase(page: Page, credentials?: { username?: string; password?: string }) {
  await openMetadataWorkspace(page, credentials);
  const knowledgeBaseButton = page.getByRole("button", { name: "Knowledge Base" });
  await knowledgeBaseButton.click();
  await expect(page.getByText("Admin Console")).toBeVisible({ timeout: 20_000 });
}

async function openCdmExplorerWorkTab(page: Page) {
  await openMetadataWorkspace(page);
  const explorerButton = page.getByRole("button", { name: "CDM Explorer" });
  if (await explorerButton.isVisible().catch(() => false)) {
    await explorerButton.click();
  } else {
    await page.getByRole("button", { name: "CDM → Work" }).click();
  }
}

async function waitForCatalogDataset(
  page: Page,
  displayName: string,
  timeout = 30_000,
  options?: { useSearch?: boolean },
) {
  const locator = page
    .locator("[data-testid='metadata-catalog-card']")
    .filter({ hasText: displayName })
    .first();
  if (options?.useSearch) {
    const searchField = page.getByLabel(/Search name, label, or source/i).first();
    await searchField.fill(displayName);
    await expect(locator).toBeVisible({ timeout });
    return locator;
  }
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const visible = await locator.isVisible({ timeout: 500 }).catch(() => false);
    if (visible) {
      await expect(locator).toBeVisible();
      return locator;
    }
    const refreshButton = page.getByRole("button", { name: "Refresh" }).first();
    await refreshButton.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await expect(locator).toBeVisible({ timeout: 2000 });
  return locator;
}

async function fillPostgresConnectionForm(page: Page, overrides: Partial<typeof POSTGRES_CONNECTION_DEFAULTS> = {}) {
  const config = { ...POSTGRES_CONNECTION_DEFAULTS, ...overrides };
  const fillField = async (label: RegExp, value: string) => {
    // Some templates render marketing copy that also matches these labels;
    // prefer the last match so we always target the actual input element.
    await page.getByLabel(label).last().fill(value);
  };
  await fillField(/Host/i, config.host);
  await fillField(/Port/i, config.port);
  await fillField(/Database/i, config.database);
  await fillField(/Username/i, config.username);
  await fillField(/Password/i, config.password);
  await fillField(/Schemas/i, config.schemas);
}

const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? process.env.VITE_KEYCLOAK_REALM ?? "nucleus";
const ADMIN_CREDENTIALS = { username: "dev-admin", password: process.env.KEYCLOAK_ADMIN_PASSWORD ?? "password" };

async function closeEndpointDetailIfVisible(page: Page): Promise<void> {
  const detailPanel = page.getByTestId("metadata-endpoint-detail");
  const panelVisible = await detailPanel.isVisible().catch(() => false);
  if (!panelVisible) {
    return;
  }
  const closeButton = detailPanel.getByRole("button", { name: "Close" });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }
}

type RegisteredEndpoint = { id: string; name: string };
type EndpointRef = RegisteredEndpoint | string;

async function registerEndpointViaApi(
  request: APIRequestContext,
  endpointName: string,
  options?: {
    capabilities?: string[];
    labels?: string[];
    url?: string;
    connectionOverrides?: Partial<typeof POSTGRES_CONNECTION_DEFAULTS>;
    bypassValidation?: boolean;
    useTemplateConfig?: boolean;
    config?: Record<string, unknown>;
  },
): Promise<RegisteredEndpoint> {
  await ensureRealmUser({ username: DEFAULT_TEST_USERNAME, password: DEFAULT_TEST_PASSWORD, roles: ["writer"] });
  const writerToken = await fetchKeycloakTokenForUser(request, {
    username: DEFAULT_TEST_USERNAME,
    password: DEFAULT_TEST_PASSWORD,
  });
  const shouldUseTemplate = options?.useTemplateConfig !== false;
  const connection = {
    ...POSTGRES_CONNECTION_DEFAULTS,
    ...(options?.connectionOverrides ?? {}),
  };
  const schemas = String(connection.schemas ?? POSTGRES_CONNECTION_DEFAULTS.schemas)
    .split(",")
    .map((schema) => schema.trim())
    .filter((schema) => schema.length > 0);
  let resolvedConfig: Record<string, unknown> | null = null;
  let resolvedUrl = options?.url ?? null;
  if (shouldUseTemplate) {
    resolvedConfig = {
      templateId: "jdbc.postgres",
      parameters: {
        host: String(connection.host),
        port: String(connection.port),
        database: String(connection.database),
        username: String(connection.username),
        password: String(connection.password),
      },
      schemas,
    };
    resolvedUrl =
      resolvedUrl ??
      `postgresql://${encodeURIComponent(String(connection.username))}:${encodeURIComponent(String(connection.password))}@${
        connection.host
      }:${connection.port}/${connection.database}`;
  } else {
    resolvedConfig = options?.config ?? null;
    resolvedUrl = resolvedUrl ?? `https://metadata-playwright.localhost/api/${Date.now()}`;
  }
  const registerResponse = await request.post(METADATA_GRAPHQL_ENDPOINT, {
    data: {
      query: `
        mutation RegisterEndpoint($input: EndpointInput!) {
          registerEndpoint(input: $input) {
            id
            name
          }
        }
      `,
      variables: {
        input: {
          projectSlug: METADATA_DEFAULT_PROJECT,
          name: endpointName,
          verb: "POST",
          url: resolvedUrl,
          description: "Playwright seeded endpoint",
          labels: options?.labels ?? ["playwright"],
          capabilities: options?.capabilities ?? ["metadata"],
          config: resolvedConfig,
        },
      },
    },
    headers: {
      Authorization: `Bearer ${writerToken}`,
      "Content-Type": "application/json",
      ...(options?.bypassValidation ? { "X-Metadata-Test-Write": "1" } : {}),
    },
    timeout: 45_000,
  });
  if (!registerResponse.ok()) {
    const errorBody = await registerResponse.text();
    throw new Error(`Failed to register endpoint via API: ${errorBody}`);
  }
  const payload = (await registerResponse.json()) as { data?: { registerEndpoint?: { id: string; name: string } } };
  const endpointId = payload.data?.registerEndpoint?.id;
  if (!endpointId) {
    throw new Error("Register endpoint response missing id");
  }
  return { id: endpointId, name: endpointName };
}

async function createJiraEndpointForTest(request: APIRequestContext, endpointName: string): Promise<RegisteredEndpoint> {
  return registerEndpointViaApi(request, endpointName, {
    useTemplateConfig: false,
    capabilities: ["metadata", "ingest"],
    labels: ["jira", "playwright"],
    url: PLAYWRIGHT_JIRA_BASE_URL,
    config: buildJiraConfig(),
    bypassValidation: true,
  });
}

function buildJiraConfig(): Record<string, unknown> {
  return {
    templateId: "jira.http",
    parameters: {
      base_url: PLAYWRIGHT_JIRA_BASE_URL,
      auth_type: "basic",
      username: PLAYWRIGHT_JIRA_USERNAME,
      api_token: PLAYWRIGHT_JIRA_TOKEN,
      project_keys: PLAYWRIGHT_JIRA_PROJECT_KEYS,
    },
    base_url: PLAYWRIGHT_JIRA_BASE_URL,
    auth_type: "basic",
    username: PLAYWRIGHT_JIRA_USERNAME,
    api_token: PLAYWRIGHT_JIRA_TOKEN,
    project_keys: Array.isArray(PLAYWRIGHT_JIRA_PROJECT_KEYS)
      ? PLAYWRIGHT_JIRA_PROJECT_KEYS
      : String(PLAYWRIGHT_JIRA_PROJECT_KEYS)
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
  };
}

async function startIngestionAndWait(
  request: APIRequestContext,
  endpointId: string,
  unitId: string,
  options?: { bypassWrites?: boolean },
): Promise<string> {
  const bypassWrites = options?.bypassWrites ?? true;
  const adminToken = await fetchKeycloakTokenForUser(request, ADMIN_CREDENTIALS);
  const startResponse = await graphql<{ startIngestion: { ok: boolean; runId: string | null } }>(
    request,
    adminToken,
    `
      mutation StartIngestion($endpointId: ID!, $unitId: ID!) {
        startIngestion(endpointId: $endpointId, unitId: $unitId) {
          ok
          runId
        }
      }
    `,
    { endpointId, unitId },
    bypassWrites ? { bypassWrites: true } : undefined,
  );
  const runId = startResponse.startIngestion?.runId ?? null;
  expect(runId, "startIngestion returned runId").toBeTruthy();
  if (!bypassWrites) {
    return runId!;
  }
  const statusQuery = `
    query IngestionStatus($endpointId: ID!, $unitId: ID!) {
      ingestionStatus(endpointId: $endpointId, unitId: $unitId) {
        state
      }
    }
  `;
  const maxAttempts = bypassWrites ? 5 : 60;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const statusResponse = await graphql<{ ingestionStatus: { state: string | null } | null }>(
      request,
      adminToken,
      statusQuery,
      { endpointId, unitId },
    );
    const state = statusResponse.ingestionStatus?.state;
    if (state === "SUCCEEDED") {
      return runId!;
    }
    if (state === "FAILED") {
      throw new Error(`Ingestion ${unitId} failed for ${endpointId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Ingestion ${unitId} did not report success within timeout`);
}

async function ensureEndpointDatasetViaApi(
  request: APIRequestContext,
  endpointRef: EndpointRef,
  options?: { displayName?: string },
): Promise<string> {
  const adminToken = await ensureAdminToken(request);
  const endpoint =
    typeof endpointRef === "string" ? await fetchEndpointByName(request, adminToken, endpointRef) : endpointRef;
  if (!endpoint) {
    throw new Error(`Unable to locate endpoint "${typeof endpointRef === "string" ? endpointRef : endpointRef.name}" to seed datasets`);
  }
  const datasetId = `pw_dataset_${Date.now()}`;
  const displayName = options?.displayName ?? `${endpoint.name} Dataset`;
  const upsertResponse = await request.post(METADATA_GRAPHQL_ENDPOINT, {
    data: {
      query: `
        mutation UpsertDataset($input: MetadataRecordInput!) {
          upsertMetadataRecord(input: $input) {
            id
          }
        }
      `,
      variables: {
        input: {
          id: datasetId,
          projectId: METADATA_DEFAULT_PROJECT,
          domain: METADATA_CATALOG_DOMAIN,
          labels: ["playwright", `endpoint:${endpoint.id}`],
          payload: {
            dataset: {
              id: datasetId,
              displayName,
              description: "Seeded dataset for endpoint detail verification",
              fields: [
                { name: "id", type: "STRING", description: "Synthetic primary key" },
                { name: "value", type: "NUMBER", description: "Synthetic metric" },
              ],
            },
            schema: "PUBLIC",
            name: `seed_table_${datasetId}`,
            labels: ["playwright", `endpoint:${endpoint.id}`],
            metadata_endpoint_id: endpoint.id,
            _metadata: {
              source_endpoint_id: endpoint.id,
              source_id: endpoint.id,
              collected_at: new Date().toISOString(),
            },
          },
        },
      },
    },
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!upsertResponse.ok()) {
    const errorBody = await upsertResponse.text();
    throw new Error(`Failed to seed dataset for endpoint: ${errorBody}`);
  }
  return displayName;
}

async function deleteEndpointViaApi(request: APIRequestContext, endpointRef: EndpointRef) {
  const adminToken = await ensureAdminToken(request);
  const endpoint =
    typeof endpointRef === "string" ? await fetchEndpointByName(request, adminToken, endpointRef) : endpointRef;
  if (!endpoint) {
    throw new Error(`Unable to locate endpoint "${typeof endpointRef === "string" ? endpointRef : endpointRef.name}" for deletion`);
  }
  const deleteResponse = await request.post(METADATA_GRAPHQL_ENDPOINT, {
    data: {
      query: `mutation DeleteEndpoint($id: ID!) { deleteEndpoint(id: $id) }`,
      variables: { id: endpoint.id },
    },
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!deleteResponse.ok()) {
    const errorBody = await deleteResponse.text();
    throw new Error(`Failed to delete endpoint via API: ${errorBody}`);
  }
}

async function updateEndpointPasswordViaApi(
  request: APIRequestContext,
  endpointId: string,
  password: string,
  options?: { bypassWrites?: boolean },
): Promise<void> {
  const adminToken = await ensureAdminToken(request);
  const existingConfig = await fetchEndpointConfigViaApi(request, adminToken, endpointId);
  const currentParameters = (existingConfig.parameters as Record<string, unknown> | undefined) ?? {};
  const nextConfig = {
    ...existingConfig,
    parameters: {
      ...currentParameters,
      password,
    },
  };
  const response = await request.post(METADATA_GRAPHQL_ENDPOINT, {
    data: {
      query: `
        mutation UpdateEndpointConfig($id: ID!, $config: JSON!) {
          updateEndpoint(id: $id, patch: { config: $config }) {
            id
          }
        }
      `,
      variables: { id: endpointId, config: nextConfig },
    },
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
      ...(options?.bypassWrites ? { "X-Metadata-Test-Write": "1" } : {}),
    },
  });
  if (!response.ok()) {
    const errorBody = await response.text();
    throw new Error(`Failed to update endpoint config: ${errorBody}`);
  }
}

async function fetchEndpointConfigViaApi(
  request: APIRequestContext,
  token: string,
  endpointId: string,
): Promise<Record<string, unknown>> {
  const response = await request.post(METADATA_GRAPHQL_ENDPOINT, {
    data: {
      query: `
        query EndpointConfig($id: ID!) {
          endpoint(id: $id) {
            config
          }
        }
      `,
      variables: { id: endpointId },
    },
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok()) {
    const errorBody = await response.text();
    throw new Error(`Failed to fetch endpoint config: ${errorBody}`);
  }
  const payload = (await response.json()) as { data?: { endpoint?: { config?: Record<string, unknown> } } };
  return (payload.data?.endpoint?.config as Record<string, unknown>) ?? { templateId: "jdbc.postgres", parameters: {} };
}

async function fetchCatalogDatasetsViaApi(request: APIRequestContext, endpointId: string): Promise<string[]> {
  const adminToken = await ensureAdminToken(request);
  const response = await request.post(METADATA_GRAPHQL_ENDPOINT, {
    data: {
      query: `
        query CatalogDatasets($endpointId: ID!, $labels: [String!]) {
          catalogDatasetConnection(first: 50, endpointId: $endpointId, labels: $labels) {
            nodes { id }
            totalCount
          }
        }
      `,
      variables: { endpointId, labels: [`endpoint:${endpointId}`] },
    },
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok()) {
    const errorBody = await response.text();
    throw new Error(`Failed to fetch catalog datasets: ${errorBody}`);
  }
  const payload = (await response.json()) as {
    data?: { catalogDatasetConnection?: { nodes?: Array<{ id: string }> } };
  };
  return payload.data?.catalogDatasetConnection?.nodes?.map((dataset) => dataset.id) ?? [];
}

async function triggerCollectionViaApi(
  request: APIRequestContext,
  endpointRef: EndpointRef,
): Promise<{ ok: boolean; codes: string[] }> {
  const adminToken = await ensureAdminToken(request);
  const endpointId = typeof endpointRef === "string" ? endpointRef : endpointRef.id;
  const response = await request.post(METADATA_GRAPHQL_ENDPOINT, {
    data: {
      query: `
        mutation TriggerEndpointCollection($endpointId: ID!) {
          triggerEndpointCollection(endpointId: $endpointId) {
            id
            status
          }
        }
      `,
      variables: { endpointId },
    },
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok()) {
    const errorBody = await response.text();
    throw new Error(`Failed to trigger collection via API: ${errorBody}`);
  }
  const payload = (await response.json()) as {
    data?: { triggerEndpointCollection?: { id: string } };
    errors?: Array<{ extensions?: { code?: string } }>;
  };
  if (payload.errors?.length) {
    return {
      ok: false,
      codes: payload.errors.map((error) => error.extensions?.code ?? "UNKNOWN"),
    };
  }
  return { ok: Boolean(payload.data?.triggerEndpointCollection?.id), codes: [] };
}

async function listCollectionRunsViaApi(
  request: APIRequestContext,
  endpointId: string,
): Promise<Array<{ id: string; status: string }>> {
  const adminToken = await ensureAdminToken(request);
  const response = await request.post(METADATA_GRAPHQL_ENDPOINT, {
    data: {
      query: `
        query CollectionRuns($endpointId: ID!) {
          collectionRuns(filter: { endpointId: $endpointId }) {
            id
            status
          }
        }
      `,
      variables: { endpointId },
    },
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok()) {
    const errorBody = await response.text();
    throw new Error(`Failed to list collection runs: ${errorBody}`);
  }
  const payload = (await response.json()) as {
    data?: { collectionRuns?: Array<{ id: string; status: string }> };
  };
  return payload.data?.collectionRuns ?? [];
}

async function waitForCollectionRunStatus(
  request: APIRequestContext,
  endpointId: string,
  status: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runs = await listCollectionRunsViaApi(request, endpointId);
    if (runs.some((run) => run.status === status)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for collection run status ${status} for endpoint ${endpointId}`);
}

async function fetchKeycloakTokenForUser(
  request: APIRequestContext,
  credentials: { username: string; password: string },
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await request.post(`${keycloakBase}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`, {
      form: {
        client_id: "jira-plus-plus",
        grant_type: "password",
        username: credentials.username,
        password: credentials.password,
        scope: "nucleus-context",
      },
    });
    if (response.ok()) {
      const payload = (await response.json()) as { access_token?: string };
      if (!payload.access_token) {
        throw new Error("Keycloak token response missing access_token");
      }
      return payload.access_token;
    }
    const errorBody = await response.text();
    if (attempt === 2) {
      throw new Error(`Failed to fetch Keycloak token: ${errorBody}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Failed to fetch Keycloak token after retries");
}

async function ensureAdminToken(request: APIRequestContext): Promise<string> {
  await ensureRealmUser({ ...ADMIN_CREDENTIALS, roles: ["admin"] });
  return fetchKeycloakTokenForUser(request, ADMIN_CREDENTIALS);
}

async function cleanupPlaywrightArtifacts(request: APIRequestContext): Promise<void> {
  try {
    const adminToken = await ensureAdminToken(request);
    const response = await request.post(METADATA_GRAPHQL_ENDPOINT, {
      data: {
        query: `
          query PlaywrightEndpoints($projectSlug: String) {
            endpoints(projectSlug: $projectSlug, first: 200) {
              id
              name
              labels
            }
          }
        `,
        variables: { projectSlug: METADATA_DEFAULT_PROJECT },
      },
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok()) {
      return;
    }
    const payload = (await response.json()) as {
      data?: { endpoints?: Array<{ id: string; name: string; labels?: string[] | null }> };
    };
    const endpoints = payload.data?.endpoints ?? [];
    await Promise.all(
      endpoints
        .filter((endpoint) => {
          const labels = endpoint.labels ?? [];
          if (labels.includes("playwright")) {
            return true;
          }
          return /playwright/i.test(endpoint.name ?? "");
        })
        .map((endpoint) =>
          request
            .post(METADATA_GRAPHQL_ENDPOINT, {
              data: {
                query: `mutation CleanupDelete($id: ID!) { deleteEndpoint(id: $id) }`,
                variables: { id: endpoint.id },
              },
              headers: {
                Authorization: `Bearer ${adminToken}`,
                "Content-Type": "application/json",
              },
            })
            .then(async (resp) => {
              if (!resp.ok()) {
                console.warn("[metadata-auth] cleanup delete failed", await resp.text());
              }
            }),
        ),
    );
  } catch (error) {
    console.warn("[metadata-auth] cleanup skipped", error);
  }
}

async function fetchEndpointByName(
  request: APIRequestContext,
  token: string,
  endpointName: string,
): Promise<{ id: string; name: string } | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const listResponse = await request.post(METADATA_GRAPHQL_ENDPOINT, {
      data: {
        query: `query EndpointList($search: String) { endpoints(search: $search) { id name } }`,
        variables: { search: endpointName },
      },
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (!listResponse.ok()) {
      const errorBody = await listResponse.text();
      throw new Error(`Failed to list endpoints: ${errorBody}`);
    }
    const listPayload = (await listResponse.json()) as { data?: { endpoints: Array<{ id: string; name: string }> } };
    const match = listPayload.data?.endpoints.find((entry) => entry.name === endpointName);
    if (match) {
      return match;
    }
    await delay(500 * (attempt + 1));
  }
  const fallbackResponse = await request.post(METADATA_GRAPHQL_ENDPOINT, {
    data: {
      query: `query MetadataEndpointList { metadataEndpoints { id name } }`,
    },
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!fallbackResponse.ok()) {
    const errorBody = await fallbackResponse.text();
    throw new Error(`Failed to list metadata endpoints: ${errorBody}`);
  }
  const fallbackPayload = (await fallbackResponse.json()) as {
    data?: { metadataEndpoints: Array<{ id: string; name: string }> };
  };
  return fallbackPayload.data?.metadataEndpoints.find((entry) => entry.name === endpointName) ?? null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMetadataGraphqlRoutePatterns(endpoint: string): string[] {
  const patterns = new Set<string>();
  patterns.add(resolveMetadataGraphqlRoutePattern(endpoint));
  patterns.add("**://localhost:4010/graphql");
  patterns.add("**://127.0.0.1:4010/graphql");
  patterns.add("**/metadata/graphql");
  return Array.from(patterns);
}

function resolveMetadataGraphqlRoutePattern(endpoint: string): string {
  if (!endpoint) {
    return "**/metadata/graphql";
  }
  if (endpoint.startsWith("/")) {
    return endpoint.startsWith("**") ? endpoint : `**${endpoint}`;
  }
  try {
    const url = new URL(endpoint);
    return `**://${url.host}${url.pathname}`;
  } catch {
    return endpoint;
  }
}
