import { test, expect } from "@playwright/test";

const NEWS_URL =
  "https://techcrunch.com/2025/06/05/x-changes-its-terms-to-bar-training-of-ai-models-using-its-content/";
const DOI = "10.1038/s41586-020-2649-2";

test("batch with mixed news URL + DOI", async ({ page }) => {
  await page.goto("/");
  await page.locator("#batch").fill(`${NEWS_URL}\n${DOI}`);
  await page.locator("#format").selectOption("apa");
  await page.locator("#run").click();

  await expect(page.locator("#status")).toContainText("Done.", {
    timeout: 45_000,
  });

  const output = await page.locator("#output").textContent();
  const citations = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  expect(citations.length).toBeGreaterThanOrEqual(2);
});
