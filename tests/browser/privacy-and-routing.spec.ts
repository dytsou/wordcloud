import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { privateSourceText } from "../fixtures/multilingual-text";

async function advance(page: Page, destination: RegExp) {
  await page
    .getByRole("button", { name: "下一步" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect.poll(() => page.url()).toMatch(destination);
}

async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("wordcloud-studio:ui-locale:v1", "zh-Hant");
  });
});

test("keeps source local and serves each wizard route", async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(30_000);
  const requests: string[] = [];
  page.on("request", (request) =>
    requests.push(`${request.url()} ${request.postData() ?? ""}`),
  );

  await open(page, "/creator/private-notes");
  await expect.poll(() => page.url()).toMatch(/\/create\/source$/);
  await page.locator("#source-text").fill(privateSourceText);
  await advance(page, /\/create\/words$/);
  const dictionaryInput = page.locator("#dictionary");
  await dictionaryInput.fill("private source");
  await dictionaryInput.press("Enter");
  await advance(page, /\/create\/style$/);
  await expect(page.locator(".cloud-svg")).toBeVisible();
  await advance(page, /\/create\/result$/);
  await expect(page.getByRole("table")).toBeVisible();

  expect(requests.some((request) => request.includes(privateSourceText))).toBe(
    false,
  );
  expect(requests.some((request) => request.includes("private source"))).toBe(
    false,
  );
});

test("shared snapshots open at results and can return to style", async ({
  page,
}) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(30_000);
  await open(page, "/");
  await page.locator("#source-text").fill("alpha alpha beta gamma");
  await advance(page, /\/create\/words$/);
  await advance(page, /\/create\/style$/);
  await expect(page.locator(".cloud-svg")).toBeVisible();
  await advance(page, /\/create\/result$/);
  const shareUrl = page.getByLabel("V URL");
  await page.getByRole("button", { name: "產生 V 連結" }).click();
  await expect(shareUrl).toHaveValue(/#wc-pako:v1:/);

  await open(page, await shareUrl.inputValue());
  await expect.poll(() => page.url()).toMatch(/\/create\/result#wc-pako:v1:/);
  await expect(page.locator(".remix-banner")).toBeVisible();
  await expect(page.getByRole("button", { name: "原文" })).toHaveCount(0);
  await page
    .getByRole("button", { name: "上一步" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toMatch(/\/create\/style$/);
  await expect(page.getByRole("slider", { name: "最小字級" })).toBeVisible();
});

test("shows an actionable error for a malformed V fragment", async ({
  page,
}) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(30_000);
  await open(page, "/#wc-pako:v1:not-valid!!");
  await expect(page.getByRole("alert")).toContainText("快照");
  await expect
    .poll(() => page.url())
    .toMatch(/\/create\/result#wc-pako:v1:not-valid!!/);
  await expect(page.locator("#source-text")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /開始新的文字雲/u }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /開始新的文字雲/u })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect.poll(() => page.url()).toMatch(/\/create\/source$/);
  await page.reload();
  await expect(page.getByRole("alert")).not.toBeVisible();
  await expect(page.locator("#source-text")).toHaveValue("");
});

test("keeps wizard result controls within a narrow viewport", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/");
  await page.locator("#source-text").fill("Cloud cloud data 中文詞語");
  await advance(page, /\/create\/words$/);
  await advance(page, /\/create\/style$/);
  await expect(page.locator(".cloud-svg")).toBeVisible();
  await advance(page, /\/create\/result$/);

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport);
});
