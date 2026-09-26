import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { privateSourceText } from "../fixtures/multilingual-text";

async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
}

async function advance(page: Page, destination: RegExp) {
  await page
    .getByRole("button", { name: "下一步" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect.poll(() => new URL(page.url()).pathname).toMatch(destination);
}

async function createCloud(page: Page, sourceText: string) {
  await page.locator("#source-text").fill(sourceText);
  await advance(page, /\/create\/words$/);
  await advance(page, /\/create\/style$/);
  await expect(page.locator(".cloud-svg")).toBeVisible();
  await advance(page, /\/create\/result$/);
  await expect(page.getByRole("table")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("wordcloud-studio:ui-locale:v1", "zh-Hant");
  });
});

test("reopens a V and a .wc file as style-only remix states", async ({
  page,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(30_000);
  await open(page, "/");
  await createCloud(page, privateSourceText);
  await page.getByRole("button", { name: "產生 V 連結" }).click();
  const originalUrl = await page.getByLabel("V URL").inputValue();
  expect(originalUrl).toMatch(/#wc-pako:v1:/);
  expect(originalUrl).not.toContain(privateSourceText);

  await open(page, originalUrl);
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toMatch(/\/create\/result$/);
  await expect(page.locator(".remix-banner")).toBeVisible();
  expect(await page.locator("#source-text").count()).toBe(0);
  expect(await page.locator("#dictionary").count()).toBe(0);
  expect(await page.getByRole("button", { name: "原文" }).count()).toBe(0);
  await page
    .getByRole("button", { name: "上一步" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toMatch(/\/create\/style$/);
  await page.getByRole("button", { name: "套用色盤：校園霓虹" }).click();
  await page
    .getByRole("button", { name: "下一步" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toMatch(/\/create\/result$/);
  await page.getByRole("button", { name: "產生 V 連結" }).click();
  await expect(page.getByLabel("V URL")).toHaveValue(/#wc-pako:v1:/);

  await open(page, "/");
  await createCloud(page, privateSourceText);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /下載完整 \.wc 快照/u }).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  expect(download.suggestedFilename()).toBe("wordcloud.wc");

  await page
    .getByRole("button", { name: /開始新的文字雲/u })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toMatch(/\/create\/source$/);
  await createCloud(page, privateSourceText);
  await page.locator('input[type="file"]').setInputFiles(filePath!);
  await expect(page.locator(".remix-banner")).toBeVisible();
  expect(await page.locator("#source-text").count()).toBe(0);
  expect(await page.locator("#dictionary").count()).toBe(0);
  await expect(page.getByRole("table")).toBeVisible();
});
