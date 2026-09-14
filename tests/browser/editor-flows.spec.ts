import { expect, test } from "@playwright/test";

test("creator can generate, inspect, remix, and create a V link locally", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    requests.push(
      `${request.method()} ${request.url()} ${request.postData() ?? ""}`,
    );
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bring the words in." }),
  ).toBeVisible();
  await page.getByLabel("原文").fill("Cloud cloud 雲端 雲端 データ data");
  await expect(page.getByText("分詞預覽")).toBeVisible();
  await page.getByRole("button", { name: "產生文字雲" }).click();
  await expect(
    page.getByRole("heading", { name: "The exact numbers." }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "2" }).first()).toBeVisible();

  await page.getByLabel("色盤 (hex, comma)").fill("#ff0000, #000000");
  await page.getByRole("button", { name: "產生 V 連結" }).click();
  await expect(page.getByLabel("V URL")).toHaveValue(/#wc-pako:v1:/);

  const sourceLeak = requests.find((request) =>
    request.includes("Cloud cloud 雲端"),
  );
  expect(sourceLeak).toBeUndefined();
});

test("deep paths still render the SPA shell", async ({ page }) => {
  await page.goto("/creator/anything");
  await expect(
    page.getByRole("heading", { name: "Bring the words in." }),
  ).toBeVisible();
});
