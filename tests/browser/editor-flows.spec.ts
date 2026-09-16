import { expect, test } from "@playwright/test";

test("creator can generate, inspect, remix, and create a V link locally", async ({
  page,
}) => {
  test.setTimeout(90_000);
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
  const shareUrl = page.getByLabel("V URL");
  await expect(shareUrl).toHaveValue("");
  await expect(shareUrl).toHaveAttribute(
    "placeholder",
    "產生連結後會顯示在這裡",
  );
  await expect(shareUrl).toHaveClass(/is-empty/);
  await page.getByLabel("原文").fill("Cloud cloud 雲端 雲端 データ data");
  await expect(page.getByText("分詞預覽")).toBeVisible();
  await page.getByRole("button", { name: "產生文字雲" }).click();
  await expect(
    page.getByRole("heading", { name: "The exact numbers." }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "2" }).first()).toBeVisible();

  const paletteInput = page.locator("#palette");
  await paletteInput.fill("#ff0000");
  await paletteInput.press("Enter");
  await paletteInput.fill("#000000");
  await paletteInput.press("Enter");
  await page.getByRole("button", { name: "產生 V 連結" }).click();
  await expect(shareUrl).toHaveValue(/#wc-pako:v1:/);
  await expect(shareUrl).not.toHaveClass(/is-empty/);

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
