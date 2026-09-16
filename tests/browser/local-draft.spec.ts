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

  await page.locator("#stop-words").fill("的, 是, the");
  await page.locator("#dictionary").fill("人工智慧, Cloudflare Workers");

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
  await page.locator("#palette").fill("#123456, #654321");

  await page.reload({ waitUntil: "commit" });

  await expect(page.locator("#stop-words")).toHaveValue("的, 是, the");
  await expect(page.locator("#dictionary")).toHaveValue(
    "人工智慧, Cloudflare Workers",
  );
  await expect(minFontSize).toHaveValue("9");
  await expect(maxFontSize).toHaveValue("26");
  await expect(wordSpacing).toHaveValue("-9");
  await expect(rotationAngle).toHaveValue("120");
  await expect(page.locator("#palette")).toHaveValue("#123456, #654321");
});
