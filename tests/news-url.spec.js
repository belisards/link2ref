import { test, expect } from "@playwright/test";

const NEWS_URL =
  "https://techcrunch.com/2025/06/05/x-changes-its-terms-to-bar-training-of-ai-models-using-its-content/";
const DOI = "10.1038/s41586-020-2649-2";

test.describe("News URL citation quality", () => {
  test("produces article-newspaper type in CSL-JSON", async ({ page }) => {
    await page.goto("/");
    await page.locator("#batch").fill(NEWS_URL);
    await page.locator("#format").selectOption("csl_json");
    await page.locator("#run").click();

    await expect(page.locator("#output")).not.toHaveText("[]", {
      timeout: 30_000,
    });

    const output = await page.locator("#output").textContent();
    const json = JSON.parse(output);
    const item = Array.isArray(json) ? json[0] : json;

    expect(item.type).toBe("article-newspaper");
    expect(item.accessed).toBeDefined();
    expect(item["date-parts"] || item.issued?.["date-parts"]).toBeDefined();
    const dateParts = item.issued?.["date-parts"]?.[0] || item["date-parts"]?.[0];
    expect(dateParts.length).toBeGreaterThanOrEqual(2);
    expect(item["container-title"]).toBeTruthy();
  });

  test("produces proper APA citation", async ({ page }) => {
    await page.goto("/");
    await page.locator("#batch").fill(NEWS_URL);
    await page.locator("#format").selectOption("apa");
    await page.locator("#run").click();

    await expect(page.locator("#output")).not.toHaveText("[]", {
      timeout: 30_000,
    });

    const output = await page.locator("#output").textContent();
    expect(output).toMatch(/20[0-9]{2}/);
    expect(output).toContain("TechCrunch");
    // APA 7 includes the URL for web sources
    expect(output).toContain("https://");
  });

  test("produces proper ABNT citation", async ({ page }) => {
    await page.goto("/");
    await page.locator("#batch").fill(NEWS_URL);
    await page.locator("#format").selectOption("abnt");
    await page.locator("#run").click();

    await expect(page.locator("#output")).not.toHaveText("[]", {
      timeout: 30_000,
    });

    const output = await page.locator("#output").textContent();
    expect(output).toContain("Acesso em:");
  });

  test("DOI regression — academic DOI still works", async ({ page }) => {
    await page.goto("/");
    await page.locator("#batch").fill(DOI);
    await page.locator("#format").selectOption("apa");
    await page.locator("#run").click();

    await expect(page.locator("#output")).not.toHaveText("[]", {
      timeout: 30_000,
    });

    const output = await page.locator("#output").textContent();
    expect(output).toMatch(/20[0-9]{2}/);
    expect(output.toLowerCase()).not.toContain("retrieved");
  });

  test("format switching preserves data", async ({ page }) => {
    await page.goto("/");
    await page.locator("#batch").fill(NEWS_URL);
    await page.locator("#format").selectOption("apa");
    await page.locator("#run").click();

    await expect(page.locator("#output")).not.toHaveText("[]", {
      timeout: 30_000,
    });

    await page.locator("#format").selectOption("csl_json");
    await expect(async () => {
      const text = await page.locator("#output").textContent();
      const json = JSON.parse(text);
      const item = Array.isArray(json) ? json[0] : json;
      expect(item.type).toBe("article-newspaper");
    }).toPass({ timeout: 10_000 });

    await page.locator("#format").selectOption("abnt");
    await expect(async () => {
      const text = await page.locator("#output").textContent();
      expect(text).toContain("Acesso em:");
    }).toPass({ timeout: 10_000 });
  });
});
