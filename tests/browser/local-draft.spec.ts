import { expect, test } from "@playwright/test";

const draftKey = "wordcloud-studio:source-draft:v1";

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
