import { expect, test } from "@playwright/test";

const draftKey = "wordcloud-studio:source-draft:v1";
const stopWordsKey = "wordcloud-studio:stop-words:v1";
const dictionaryKey = "wordcloud-studio:dictionary:v1";
const styleKey = "wordcloud-studio:style-preferences:v1";

test("restores the last source draft after a refresh", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.evaluate((key) => localStorage.removeItem(key), draftKey);

  const source = "這是一段會留在本機的草稿。 local draft 123";
  const sourceInput = page.getByLabel("原文");
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
  await page.goto("/");
  await page.evaluate((key) => localStorage.removeItem(key), draftKey);
  await page.getByLabel("原文").fill("temporary local draft");

  await page.getByRole("button", { name: /開始新的文字雲/u }).click();
  await page.reload({ waitUntil: "commit" });

  await expect(page.getByLabel("原文")).toHaveValue("");
});

test("restores token inputs and style preferences after a refresh", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.evaluate(
    (keys) => keys.forEach((key) => localStorage.removeItem(key)),
    [draftKey, stopWordsKey, dictionaryKey, styleKey],
  );
  await page.reload({ waitUntil: "commit" });

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

  const minFontSize = page.getByRole("slider", { name: "最小字級" });
  await minFontSize.press("ArrowRight");
  const maxFontSize = page.getByRole("slider", { name: "最大字級" });
  await maxFontSize.press("Home");
  await maxFontSize.press("ArrowRight");
  await maxFontSize.press("ArrowRight");
  const wordSpacing = page.getByRole("slider", { name: "詞間距" });
  await wordSpacing.press("Home");
  await wordSpacing.press("ArrowRight");
  await wordSpacing.press("ArrowRight");
  await wordSpacing.press("ArrowRight");
  const rotationAngle = page.getByRole("slider", { name: "旋轉方式" });
  await rotationAngle.press("End");
  const paletteInput = page.locator("#palette");
  for (const tag of ["#123456", "#654321"]) {
    await paletteInput.fill(tag);
    await paletteInput.press("Enter");
  }

  await page.reload({ waitUntil: "commit" });

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
});
