import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("wordcloud-studio:ui-locale:v1", "zh-Hant");
  });
});

async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
}

test("wizard exposes labeled controls, progress, and a nonvisual word table", async ({
  page,
}) => {
  await open(page, "/");
  await expect.poll(() => page.url()).toMatch(/\/create\/source$/);
  await expect(page.getByRole("textbox", { name: "原文" })).toBeVisible();
  expect(await page.locator("#locale").count()).toBe(0);
  expect(await page.getByRole("button", { name: "風格" }).count()).toBe(0);

  await page.locator("#source-text").fill("alpha alpha beta");
  await page
    .getByRole("button", { name: "下一步" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect.poll(() => page.url()).toMatch(/\/create\/words$/);
  await expect(page.getByLabel("預設分詞 locale")).toBeVisible();
  await expect(page.getByLabel("大小寫", { exact: true })).toBeVisible();
  await expect(page.locator(".token-preview")).toBeVisible();

  const precisionToggle = page.getByRole("button", {
    name: "需要精準校正？",
  });
  await expect(precisionToggle).toHaveAttribute("aria-expanded", "false");
  await expect(precisionToggle).toHaveAttribute(
    "aria-controls",
    "precision-rules",
  );
  await precisionToggle.click();
  await expect(precisionToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#precision-rules")).toBeVisible();

  await page
    .getByRole("button", { name: "下一步" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect.poll(() => page.url()).toMatch(/\/create\/style$/);
  await expect(page.getByRole("slider", { name: "最小字級" })).toBeVisible();
  await expect(page.locator(".cloud-svg")).toBeVisible();
  expect(await page.getByRole("table").count()).toBe(0);

  await page
    .getByRole("button", { name: "下一步" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect.poll(() => page.url()).toMatch(/\/create\/result$/);
  await expect(
    page.getByRole("table", { name: "文字雲詞頻排名與排版狀態" }),
  ).toBeVisible();
  await expect(page.locator(".cloud-svg")).toBeVisible();
  await expect(page.getByRole("button", { name: "上一步" })).toBeVisible();
  await expect(page.locator("[aria-live='polite']")).toHaveText(/完成|排版/);
});

test("invalid source input is announced and receives focus", async ({
  page,
}) => {
  await open(page, "/");
  await page
    .getByRole("button", { name: "下一步" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator("#source-text")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.locator("#source-error")).toBeVisible();
  await expect(page.locator("#source-text")).toBeFocused();
});
