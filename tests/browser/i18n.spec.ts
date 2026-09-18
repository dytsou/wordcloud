import { expect, test } from "@playwright/test";

test("uses the browser language as the initial tokenizer locale", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();

  await page.goto("/");

  await expect(page.locator("#locale")).toHaveValue("en");
  await expect(page.getByLabel("Interface language")).toHaveValue("en");

  await context.close();
});

test("switches the interface without changing the tokenizer locale", async ({
  page,
}) => {
  await page.goto("/");

  const tokenizerLocale = page.locator("#locale");
  await expect(tokenizerLocale).toHaveValue("zh-Hant");

  await page.getByLabel("介面語言").selectOption("en");

  await expect(
    page.getByRole("heading", { name: "Bring the words in." }),
  ).toBeVisible();
  await expect(page.getByLabel("Source text")).toBeVisible();
  await expect(tokenizerLocale).toHaveValue("zh-Hant");
});
