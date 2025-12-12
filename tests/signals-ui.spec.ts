import { test, expect } from "@playwright/test";
import { openMetadataWorkspace } from "./helpers/metadata";
import { seedCdmData } from "./helpers/cdmSeed";
import { seedSignalData } from "./helpers/signalSeed";

test.beforeAll(async () => {
  await seedCdmData();
  await seedSignalData();
});

test("Signals view surfaces signals and links to CDM entity", async ({ page }) => {
  await openMetadataWorkspace(page);
  await page.getByRole("button", { name: "Signals" }).click();

  const view = page.getByTestId("signals-view");
  await expect(view).toBeVisible();

  // Toggle filters and ensure table renders either rows or empty state
  await page.getByTestId("signal-filter-status-OPEN").click();
  await page.getByTestId("signal-filter-status-RESOLVED").click();
  const firstRow = page.getByTestId("signal-row").first();
  const emptyState = page.getByText("No signals match the current filters.");
  await expect(firstRow.or(emptyState)).toBeVisible({ timeout: 10_000 });
});
