import { expect, test } from "@playwright/test";

test("ignore case merges variants and keeps the first spelling", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByLabel("原文").fill("Apple apple APPLE banana");

  const ignoreCase = page.getByRole("checkbox", { name: "忽略大小寫" });
  await expect(ignoreCase).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "忽略大小寫說明" }),
  ).toHaveAttribute("aria-describedby", "case-insensitive-help");
  await ignoreCase.check();
  await page.getByRole("button", { name: "產生文字雲" }).click();

  const table = page.getByRole("table", {
    name: "文字雲詞頻排名與排版狀態",
  });
  await expect(table).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(2);

  const appleRow = table.locator("tbody tr").filter({ hasText: "Apple" });
  await expect(appleRow.locator(".word-link")).toHaveText("Apple");
  await expect(appleRow.locator(".count-cell")).toHaveText("3");
});
