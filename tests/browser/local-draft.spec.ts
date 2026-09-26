import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { decodeSnapshotFragment } from "../../src/core/snapshot";

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

const draftKey = "wordcloud-studio:source-draft:v1";
const stopWordsKey = "wordcloud-studio:stop-words:v1";
const dictionaryKey = "wordcloud-studio:dictionary:v1";
const styleKey = "wordcloud-studio:style-preferences:v1";
const tokenizerKey = "wordcloud-studio:tokenizer-settings:v1";

test("restores the last source draft after a refresh", async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, "/");
  await page.evaluate((key) => localStorage.removeItem(key), draftKey);

  const source = "這是一段會留在本機的草稿。 local draft 123";
  const sourceInput = page.locator("#source-text");
  await sourceInput.fill(source);
  await expect(sourceInput).toHaveValue(source);

  await page.reload({ waitUntil: "commit" });

  await expect(sourceInput).toHaveValue(source);
  await expect(
    page.getByText("已從本機草稿還原原文；內容只留在這個瀏覽器裡。"),
  ).toBeVisible();
});

test("starting a new cloud clears the cached source draft", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await open(page, "/");
  await page.evaluate((key) => localStorage.removeItem(key), draftKey);
  await page.locator("#source-text").fill("temporary local draft");
  await advance(page, /\/create\/words$/);
  await advance(page, /\/create\/style$/);
  await expect(page.locator(".cloud-svg")).toBeVisible();
  await advance(page, /\/create\/result$/);

  await page
    .getByRole("button", { name: /開始新的文字雲/u })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await page.reload({ waitUntil: "commit" });

  await expect(page.locator("#source-text")).toHaveValue("");
});

test("restores token inputs and style preferences after a refresh", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await open(page, "/");
  await page.evaluate(
    (keys) => keys.forEach((key) => localStorage.removeItem(key)),
    [draftKey, stopWordsKey, dictionaryKey, styleKey, tokenizerKey],
  );
  await page.reload({ waitUntil: "commit" });

  await page.locator("#source-text").fill("這是一段 local draft 123 words");
  await advance(page, /\/create\/words$/);
  const stopWordsInput = page.locator("#stop-words");
  for (const tag of ["的 是", "the, and"]) {
    await stopWordsInput.fill(tag);
    await stopWordsInput.press("Enter");
  }
  const dictionaryInput = page.locator("#dictionary");
  for (const tag of ["人工智慧", "Cloudflare Workers"]) {
    await dictionaryInput.fill(tag);
    await dictionaryInput.press("Enter");
  }
  await page.getByLabel("預設分詞 locale").selectOption("zh-Hant");
  await page.getByLabel("大小寫", { exact: true }).selectOption("lower");
  await page.locator("#case-insensitive").uncheck();
  await advance(page, /\/create\/style$/);
  await expect.poll(() => page.url()).toMatch(/\/create\/style$/);
  await expect(page.locator(".cloud-svg")).toBeVisible();

  const minFontSize = page.getByRole("slider", { name: "最小字級" });
  await minFontSize.press("ArrowRight");
  await expect(minFontSize).toBeEnabled();
  const maxFontSize = page.getByRole("slider", { name: "最大字級" });
  await maxFontSize.press("Home");
  await expect(maxFontSize).toBeEnabled();
  await maxFontSize.press("ArrowRight");
  await expect(maxFontSize).toBeEnabled();
  await maxFontSize.press("ArrowRight");
  await expect(maxFontSize).toBeEnabled();
  const wordSpacing = page.getByRole("slider", { name: "詞間距" });
  await wordSpacing.press("Home");
  await expect(wordSpacing).toBeEnabled();
  await wordSpacing.press("ArrowRight");
  await expect(wordSpacing).toBeEnabled();
  await wordSpacing.press("ArrowRight");
  await expect(wordSpacing).toBeEnabled();
  await wordSpacing.press("ArrowRight");
  await expect(wordSpacing).toBeEnabled();
  const rotationAngle = page.getByRole("slider", { name: "旋轉方式" });
  await rotationAngle.press("End");
  await expect(rotationAngle).toBeEnabled();
  const paletteInput = page.locator("#palette");
  for (const tag of ["#123456", "#654321"]) {
    await paletteInput.fill(tag);
    await paletteInput.press("Enter");
  }

  await page.reload({ waitUntil: "commit" });

  await expect(minFontSize).toHaveValue("9");
  await expect(maxFontSize).toHaveValue("26");
  await expect(wordSpacing).toHaveValue("-9");
  await expect(rotationAngle).toHaveValue("120");
  const paletteTags = page
    .locator(".tag-input")
    .filter({ has: page.locator("#palette") })
    .locator(".tag-chip-value");
  await expect(paletteTags).toHaveText([
    "#aa5948",
    "#27384a",
    "#5c6876",
    "#b86b58",
    "#123456",
    "#654321",
  ]);

  await page
    .getByRole("button", { name: "詞語" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect.poll(() => page.url()).toMatch(/\/create\/words$/);
  await expect(page.getByLabel("預設分詞 locale")).toHaveValue("zh-Hant");
  await expect(page.getByLabel("大小寫", { exact: true })).toHaveValue("lower");
  await expect(page.locator("#case-insensitive")).not.toBeChecked();

  const stopWordTags = page
    .locator(".tag-input")
    .filter({ has: page.locator("#stop-words") })
    .locator(".tag-chip-value");
  await expect(stopWordTags).toHaveText(["的 是", "the, and"]);
  const dictionaryTags = page
    .locator(".tag-input")
    .filter({ has: page.locator("#dictionary") })
    .locator(".tag-chip-value");
  await expect(dictionaryTags).toHaveText(["人工智慧", "Cloudflare Workers"]);
});

test("does not restore shape geometry from reusable style preferences", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        minFontSize: 18,
        maxFontSize: 64,
        padding: 4,
        rotationAngle: 35,
        palette: ["#aa5948", "#27384a"],
        shape: { id: "circle", widthScale: 0.64, heightScale: 0.78 },
      }),
    );
  }, styleKey);

  await open(page, "/");
  await page.locator("#source-text").fill("A new unshaped cloud");
  await advance(page, /\/create\/words$/);
  await advance(page, /\/create\/style$/);
  await expect(page.locator(".cloud-svg")).toBeVisible();
  await advance(page, /\/create\/result$/);

  await page.getByRole("button", { name: "產生 V 連結" }).click();
  const shareUrl = await page.getByLabel("V URL").inputValue();
  const snapshot = decodeSnapshotFragment(new URL(shareUrl).hash);

  expect(snapshot.schemaVersion).toBe("wc-snapshot-v1");
  expect(snapshot.presentation).not.toHaveProperty("shape");
});
