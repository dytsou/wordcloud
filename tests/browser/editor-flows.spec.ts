import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("wordcloud-studio:ui-locale:v1", "zh-Hant");
  });
});

async function advance(page: Page, destination: RegExp) {
  await page
    .getByRole("button", { name: "下一步" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect.poll(() => page.url()).toMatch(destination);
}

async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
}

async function continueToWords(page: Page) {
  await page.locator("#source-text").fill("cloudnative cloud data");
  await advance(page, /\/create\/words$/);
}

test("creator moves through the wizard and can return to update the cloud", async ({
  page,
}) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(30_000);
  const requests: string[] = [];
  page.on("request", (request) => {
    requests.push(
      `${request.method()} ${request.url()} ${request.postData() ?? ""}`,
    );
  });

  await open(page, "/");
  await expect.poll(() => page.url()).toMatch(/\/create\/source$/);
  await expect(page.getByRole("heading", { name: "先放入原文" })).toBeVisible();
  await expect(page.getByLabel("V URL")).toHaveCount(0);

  const source = "Cloud cloud 雲端 雲端 データ data";
  await page.locator("#source-text").fill(source);
  await advance(page, /\/create\/words$/);
  await expect(
    page.getByRole("heading", { name: "校正詞語與切分" }),
  ).toBeVisible();
  await expect(page.getByText("分詞預覽")).toBeVisible();

  await advance(page, /\/create\/style$/);
  await expect(
    page.getByRole("heading", { name: "設計文字雲風格" }),
  ).toBeVisible();
  await expect(page.locator(".cloud-svg")).toBeVisible();

  await advance(page, /\/create\/result$/);
  await expect(
    page.getByRole("heading", { name: "文字雲已完成" }),
  ).toBeVisible();
  const wordTable = page.getByRole("table", {
    name: "文字雲詞頻排名與排版狀態",
  });
  await expect(wordTable).toBeVisible();

  await page
    .getByRole("button", { name: "原文" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect.poll(() => page.url()).toMatch(/\/create\/source$/);
  await page.locator("#source-text").fill("alpha gamma gamma 雲端");
  await advance(page, /\/create\/words$/);
  await advance(page, /\/create\/style$/);
  await expect(page.locator(".cloud-svg")).toBeVisible();
  await advance(page, /\/create\/result$/);
  await expect(page.getByRole("button", { name: "beta" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "gamma" })).toBeVisible();

  const shareUrl = page.getByLabel("V URL");
  await expect(shareUrl).toHaveValue("");
  await expect(shareUrl).toHaveAttribute(
    "placeholder",
    "產生連結後會顯示在這裡",
  );
  await page.getByRole("button", { name: "產生 V 連結" }).click();
  await expect(shareUrl).toHaveValue(/\/create\/result#\wc-pako:v1:/);

  expect(requests.some((request) => request.includes("Cloud cloud 雲端"))).toBe(
    false,
  );
});

test("deep paths are normalized to the first wizard step", async ({ page }) => {
  await open(page, "/creator/anything");
  await expect.poll(() => page.url()).toMatch(/\/create\/source$/);
  await expect(page.getByRole("heading", { name: "先放入原文" })).toBeVisible();
});

test("vocabulary starts simple and exposes grouped precision controls", async ({
  page,
}) => {
  await open(page, "/");
  await continueToWords(page);

  const panel = page.locator(".rules-panel");
  const disclosure = page.getByRole("button", { name: "需要精準校正？" });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(panel.locator("#new-rule-kind")).toHaveCount(0);
  await expect(panel.locator(".rule-index")).toHaveCount(0);
  await expect(panel.getByRole("heading", { name: "固定文字" })).toBeHidden();

  await disclosure.press("Enter");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByRole("heading", { name: "固定文字" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "拆分文字" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "合併文字" })).toBeVisible();

  const fixedGroup = panel.locator('[data-rule-kind="protected"]');
  const addFixed = fixedGroup.getByRole("button", { name: "新增固定文字" });
  await addFixed.click();
  await addFixed.click();
  const fixedInputs = fixedGroup.locator(".precision-rule input");
  await fixedInputs.nth(0).fill("Cloudflare Workers");
  await fixedInputs.nth(1).fill("temporary phrase");
  await expect(fixedInputs.nth(0)).toHaveValue("Cloudflare Workers");
  await expect(fixedInputs.nth(1)).toHaveValue("temporary phrase");
  await expect(
    panel.getByRole("button", { name: "移除固定文字 1" }),
  ).toBeVisible();

  await panel.getByRole("button", { name: "移除固定文字 1" }).click();
  await addFixed.click();
  const readdedInputs = fixedGroup.locator(".precision-rule input");
  await expect(readdedInputs).toHaveCount(2);
  await expect(readdedInputs.nth(0)).toHaveValue("temporary phrase");
  await readdedInputs.nth(1).fill("new phrase");
  await expect(readdedInputs.nth(0)).toHaveValue("temporary phrase");

  await panel.getByRole("button", { name: "移除固定文字 2" }).click();
  await expect(fixedGroup.locator(".precision-rule input")).toHaveCount(1);
  await panel.getByRole("button", { name: "移除固定文字 1" }).click();
  await expect(fixedGroup.locator(".precision-rule input")).toHaveCount(0);

  await panel.getByRole("button", { name: "新增拆分文字" }).click();
  const splitSource = panel.getByLabel("要拆分的文字 1");
  await splitSource.fill("cloudnative");
  await panel.getByLabel("拆分後詞語 1").fill("cloud, native");
  await expect(splitSource).toHaveValue("cloudnative");

  await panel.getByRole("button", { name: "新增合併文字" }).click();
  const mergeSource = panel.getByLabel("要合併的文字 1");
  await mergeSource.fill("data cloud");
  await panel.getByLabel("合併後文字 1").fill("data-cloud");
  await expect(mergeSource).toHaveValue("data cloud");
});

test("precision controls stay within a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/");
  await continueToWords(page);
  await page.getByRole("button", { name: "需要精準校正？" }).click();

  await expect(
    page.getByRole("button", { name: "新增固定文字" }),
  ).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport);
});
