import { expect, test } from "@playwright/test";
import { privateSourceText } from "../fixtures/multilingual-text";

test("keeps source local and serves the SPA at application paths", async ({
  page,
}) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(30_000);
  const requests: string[] = [];
  page.on("request", (request) =>
    requests.push(`${request.url()} ${request.postData() ?? ""}`),
  );

  await page.goto("/creator/private-notes");
  await expect(page.getByText("LOCAL ONLY")).toBeVisible();
  await page.getByLabel("原文").fill(privateSourceText);
  await page
    .getByLabel("自訂詞典 (多字詞會保留為一個詞)")
    .fill("private source");
  await page.getByRole("button", { name: "產生文字雲" }).click();
  await expect(page.getByRole("table")).toBeVisible();

  expect(requests.some((request) => request.includes(privateSourceText))).toBe(
    false,
  );
  expect(await page.getByLabel("原文").inputValue()).toBe(privateSourceText);
});

test("shows an actionable error for a malformed V fragment", async ({
  page,
}) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(30_000);
  await page.goto("/#wc-pako:v1:not-valid!!");
  await expect(page.getByRole("alert")).toContainText("快照");
  await expect(page.getByLabel("原文")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "回到新的文字雲" }),
  ).toBeVisible();
});
