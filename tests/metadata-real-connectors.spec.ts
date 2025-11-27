import { test, expect, type Page } from "@playwright/test";
import { loginViaKeycloak, metadataBase } from "./helpers/webAuth";

const ADMIN_USERNAME = process.env.KEYCLOAK_ADMIN ?? "dev-admin";
const ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD ?? "password";

const JIRA_ENDPOINT_NAME = process.env.UAT_JIRA_ENDPOINT_NAME ?? "Customer Success Jira";
const POSTGRES_ENDPOINT_NAME = process.env.UAT_POSTGRES_ENDPOINT_NAME ?? "Local Postgres";

test.describe("Real connector UI smoke", () => {
  test("metadata workspace lists Jira + Postgres endpoints", async ({ page }) => {
    await openMetadataWorkspace(page);
    await page.getByRole("button", { name: "Endpoints" }).click();
    await page.getByRole("button", { name: "Refresh" }).click();
    await ensureWorkspaceReady(page);

    await assertEndpointCard(page, JIRA_ENDPOINT_NAME);
    await assertEndpointCard(page, POSTGRES_ENDPOINT_NAME);
  });

  test("catalog shows Jira datasets from collection run", async ({ page }) => {
    await openMetadataWorkspace(page);
    const catalogCard = page.locator("[data-testid='metadata-catalog-card']").first();
    await expect(catalogCard).toBeVisible({ timeout: 30_000 });
    await catalogCard.click();

    const previewButton = page.getByTestId("metadata-preview-button");
    await expect(previewButton).toBeVisible();
    if (!(await previewButton.isDisabled())) {
      await previewButton.click();
      await expect(page.getByTestId("metadata-preview-table").or(page.getByTestId("metadata-preview-empty"))).toBeVisible({
        timeout: 20_000,
      });
    }

    const detailButton = page.getByRole("button", { name: "View detail" }).first();
    await detailButton.click();
    await expect(page.getByTestId("metadata-dataset-detail-drawer")).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");
  });

  test("ingestion console lists Jira units", async ({ page }) => {
    await openMetadataWorkspace(page);
    await page.getByRole("button", { name: "Ingestion" }).click();
    const consoleRoot = page.getByTestId("ingestion-console");
    await expect(consoleRoot).toBeVisible({ timeout: 30_000 });

    const endpointButton = page.getByRole("button", { name: JIRA_ENDPOINT_NAME }).first();
    await endpointButton.click();
    const refreshButton = page.getByRole("button", { name: "Refresh" }).first();
    await refreshButton.click();

    const unitRows = page.getByTestId("ingestion-unit-row");
    await expect(unitRows.first()).toBeVisible({ timeout: 30_000 });
    await expect(unitRows.first()).toContainText(/Healthy|Idle|Ready|Succeeded/i);
  });
});

async function assertEndpointCard(page: Page, endpointName: string) {
  const cards = page.locator("[data-testid='metadata-endpoint-card']");
  const card = cards.filter({ hasText: endpointName }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  const statusPill = card.getByTestId("metadata-endpoint-status");
  await expect(statusPill).toHaveAttribute("data-status", /healthy|succeeded|idle/i);
  await card.getByRole("button", { name: "Details" }).click();
  await expect(page.getByTestId("metadata-endpoint-detail")).toContainText(endpointName);
  await page.getByRole("button", { name: "Close" }).click();
}

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

async function openMetadataWorkspace(page: Page) {
  await loginViaKeycloak(page, { username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  const metadataTab = page.getByRole("button", { name: "Metadata" });
  const tabVisible = await metadataTab.isVisible({ timeout: 2000 }).catch(() => false);
  if (tabVisible) {
    await metadataTab.click();
  } else {
    await page.goto(`${metadataBase}/`, { waitUntil: "domcontentloaded" });
  }
  await ensureWorkspaceReady(page);
}
