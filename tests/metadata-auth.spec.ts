import { test, expect, type Page, type APIRequestContext, type Route } from "@playwright/test";
import { loginViaKeycloak, ensureRealmUser, keycloakBase, metadataBase } from "./helpers/webAuth";

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
  await interceptMetadataTestWrites(page);
});

test("metadata console requires Keycloak login and loads workspace nav", async ({ page }) => {
  await openMetadataWorkspace(page);
  await expect(page.getByTestId("metadata-register-open").first()).toBeVisible();
  await expect(page.locator("text=/Authentication required/i")).toHaveCount(0);
});

test("metadata workspace sections render datasets, endpoints, and collections", async ({ page }) => {
  await openMetadataWorkspace(page);

  const catalogCards = page.locator("[data-testid='metadata-catalog-card']");
  const catalogEmpty = page.locator("[data-testid='metadata-catalog-empty']");
  await expect(catalogCards.first().or(catalogEmpty)).toBeVisible({ timeout: 20_000 });
  if ((await catalogCards.count()) > 0) {
    await expect(catalogCards.first()).toBeVisible();
    await catalogCards.first().click();
    const previewButton = page.getByTestId("metadata-preview-button");
    await expect(previewButton).toBeVisible();
    if (!(await previewButton.isDisabled())) {
      await previewButton.click();
      const previewResult = page.getByTestId("metadata-preview-table");
      await expect(previewResult.or(page.getByTestId("metadata-preview-empty"))).toBeVisible({ timeout: 20_000 });
    } else {
      await expect(page.getByTestId("metadata-preview-empty")).toBeVisible();
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
    await endpointFilter.selectOption(endpointA.id);
    await waitForCatalogDataset(page, datasetNameA);
    await expect(page.locator("[data-testid='metadata-catalog-card']").filter({ hasText: datasetNameB })).toHaveCount(0);
    await endpointFilter.selectOption(endpointB.id);
    await waitForCatalogDataset(page, datasetNameB);
    await expect(page.locator("[data-testid='metadata-catalog-card']").filter({ hasText: datasetNameA })).toHaveCount(0);
    await endpointFilter.selectOption("all");
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
    timeout: 20_000,
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
    .getByText(`Dataset previews disabled: ${endpointName} is missing the "preview" capability.`)
    .or(page.getByText(/Dataset previews disabled: this endpoint is missing the "preview" capability./i))
    .or(page.getByText(/Link this dataset to a registered endpoint before running previews\./i));
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
  const detailPanel = page.getByTestId("metadata-endpoint-detail");
  if (await detailPanel.isVisible({ timeout: 2000 }).catch(() => false)) {
    await detailPanel.getByRole("button", { name: "Close" }).click();
  }
  await updateEndpointPasswordViaApi(request, endpoint.id, PLAYWRIGHT_BAD_PASSWORD);
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
  await page.getByRole("button", { name: "Close" }).click();
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

async function waitForCatalogDataset(page: Page, displayName: string, timeout = 30_000) {
  const locator = page
    .locator("[data-testid='metadata-catalog-card']")
    .filter({ hasText: displayName })
    .first();
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

type RegisteredEndpoint = { id: string; name: string };
type EndpointRef = RegisteredEndpoint | string;

async function registerEndpointViaApi(
  request: APIRequestContext,
  endpointName: string,
  options?: { capabilities?: string[]; labels?: string[] },
): Promise<RegisteredEndpoint> {
  await ensureRealmUser({ username: DEFAULT_TEST_USERNAME, password: DEFAULT_TEST_PASSWORD, roles: ["writer"] });
  const writerToken = await fetchKeycloakTokenForUser(request, {
    username: DEFAULT_TEST_USERNAME,
    password: DEFAULT_TEST_PASSWORD,
  });
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
          verb: "GET",
          url: `https://metadata-playwright.example.com/api/${Date.now()}`,
          description: "Playwright seeded endpoint",
          labels: options?.labels ?? ["playwright"],
          capabilities: options?.capabilities ?? ["metadata"],
        },
      },
    },
    headers: {
      Authorization: `Bearer ${writerToken}`,
      "Content-Type": "application/json",
      "X-Metadata-Test-Write": "1",
    },
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
      "X-Metadata-Test-Write": "1",
    },
  });
  if (!upsertResponse.ok()) {
    const errorBody = await upsertResponse.text();
    throw new Error(`Failed to seed dataset for endpoint: ${errorBody}`);
  }
  return displayName;
}

async function interceptMetadataTestWrites(page: Page): Promise<() => Promise<void>> {
  const targets = METADATA_GRAPHQL_ROUTE_PATTERNS;
  const handler = async (route: Route) => {
    const headers = {
      ...route.request().headers(),
      "x-metadata-test-write": "1",
    };
    await route.continue({ headers });
  };
  await Promise.all(targets.map((target) => page.route(target, handler)));
  return async () => {
    await Promise.all(targets.map((target) => page.unroute(target, handler)));
  };
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
      "X-Metadata-Test-Write": "1",
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
      "X-Metadata-Test-Write": "1",
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
      "X-Metadata-Test-Write": "1",
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
  const response = await request.post(`${keycloakBase}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`, {
    form: {
      client_id: "jira-plus-plus",
      grant_type: "password",
      username: credentials.username,
      password: credentials.password,
      scope: "nucleus-context",
    },
  });
  if (!response.ok()) {
    const errorBody = await response.text();
    throw new Error(`Failed to fetch Keycloak token: ${errorBody}`);
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("Keycloak token response missing access_token");
  }
  return payload.access_token;
}

async function ensureAdminToken(request: APIRequestContext): Promise<string> {
  await ensureRealmUser({ ...ADMIN_CREDENTIALS, roles: ["admin"] });
  return fetchKeycloakTokenForUser(request, ADMIN_CREDENTIALS);
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
