import { expect, test } from "@playwright/test";
import { privateSourceText } from "../fixtures/multilingual-text";

test("reopens a V and a .wc file as style-only remix states", async ({
  page,
}) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(30_000);
  await page.goto("/");
  await page.getByLabel("原文").fill(privateSourceText);
  await page.getByRole("button", { name: "產生文字雲" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "產生 V 連結" }).click();
  const originalUrl = await page.getByLabel("V URL").inputValue();
  expect(originalUrl).toMatch(/#wc-pako:v1:/);
  expect(originalUrl).not.toContain(privateSourceText);

  await page.goto(originalUrl);
  await expect(page.getByText("V / STYLE REMIX")).toBeVisible();
  await expect(page.getByLabel("原文")).toBeDisabled();
  await expect(page.locator("#dictionary")).toBeDisabled();
  await expect(page.getByRole("button", { name: "產生文字雲" })).toHaveCount(0);
  await page.getByLabel("字型 profile").selectOption("Georgia");
  await expect(page.getByText(/文字雲完成|本機排版中/)).toBeVisible();
  await page.getByRole("button", { name: "產生 V 連結" }).click();
  await expect(page.getByLabel("V URL")).toHaveValue(/#wc-pako:v1:/);

  await page.goto("/");
  await page.getByLabel("原文").fill(privateSourceText);
  await page.getByRole("button", { name: "產生文字雲" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載完整 .wc 快照" }).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  expect(download.suggestedFilename()).toBe("wordcloud.wc");
  await page.getByRole("button", { name: /開始新的文字雲/ }).click();
  await page.locator('input[type="file"]').setInputFiles(filePath!);
  await expect(page.getByText("V / STYLE REMIX")).toBeVisible();
  await expect(page.getByLabel("原文")).toBeDisabled();
  await expect(page.getByRole("table")).toBeVisible();
});
