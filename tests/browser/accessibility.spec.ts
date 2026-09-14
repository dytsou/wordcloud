import { expect, test } from "@playwright/test";

test("editor exposes labeled controls and a nonvisual word table", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("原文")).toBeVisible();
  await expect(page.getByLabel("預設分詞 locale")).toBeVisible();
  await expect(page.getByLabel("大小寫")).toBeVisible();
  await expect(page.getByRole("button", { name: "產生文字雲" })).toBeVisible();
  await page.getByLabel("原文").fill("alpha alpha beta");
  await page.getByRole("button", { name: "產生文字雲" }).click();
  await expect(
    page.getByRole("table", { name: "文字雲詞頻排名與排版狀態" }),
  ).toBeVisible();
  await expect(page.locator("[aria-live='polite']")).toHaveText(/完成|排版/);
});
