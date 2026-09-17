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

test("vocabulary starts simple and exposes grouped precision controls", async ({
  page,
}) => {
  await page.goto("/");

  const panel = page.locator(".rules-panel");
  const disclosure = page.getByRole("button", { name: "需要精準校正？" });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(panel.locator("#new-rule-kind")).toHaveCount(0);
  await expect(panel.locator(".rule-index")).toHaveCount(0);
  await expect(panel.getByRole("heading", { name: "固定文字" })).toBeHidden();

  await disclosure.press("Enter");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByRole("heading", { name: "固定文字" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "拆分文字" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "合併文字" })).toBeVisible();

  const fixedGroup = panel.locator('[data-rule-kind="protected"]');
  const addFixed = fixedGroup.getByRole("button", { name: "新增固定文字" });
  await addFixed.click();
  await addFixed.click();
  const fixedInputs = fixedGroup.locator(".precision-rule input");
  await fixedInputs.nth(0).fill("Cloudflare Workers");
  await fixedInputs.nth(1).fill("temporary phrase");
  await expect(fixedInputs.nth(0)).toHaveValue("Cloudflare Workers");
  await expect(fixedInputs.nth(1)).toHaveValue("temporary phrase");
  await expect(
    panel.getByRole("button", { name: "移除固定文字 1" }),
  ).toBeVisible();

  await panel.getByRole("button", { name: "移除固定文字 1" }).click();
  await addFixed.click();
  const readdedInputs = fixedGroup.locator(".precision-rule input");
  await expect(readdedInputs).toHaveCount(2);
  await expect(readdedInputs.nth(0)).toHaveValue("temporary phrase");
  await readdedInputs.nth(1).fill("new phrase");
  await expect(readdedInputs.nth(0)).toHaveValue("temporary phrase");

  await panel.getByRole("button", { name: "移除固定文字 2" }).click();
  await expect(fixedGroup.locator(".precision-rule input")).toHaveCount(1);
  await panel.getByRole("button", { name: "移除固定文字 1" }).click();
  await expect(fixedGroup.locator(".precision-rule input")).toHaveCount(0);

  await panel.getByRole("button", { name: "新增拆分文字" }).click();
  const splitSource = panel.getByLabel("要拆分的文字 1");
  await splitSource.fill("cloudnative");
  await panel.getByLabel("拆分後詞語 1").fill("cloud, native");
  await expect(splitSource).toHaveValue("cloudnative");

  await panel.getByRole("button", { name: "新增合併文字" }).click();
  const mergeSource = panel.getByLabel("要合併的文字 1");
  await mergeSource.fill("data cloud");
  await panel.getByLabel("合併後文字 1").fill("data-cloud");
  await expect(mergeSource).toHaveValue("data cloud");
});

test("precision controls stay within a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "需要精準校正？" }).click();

  await expect(
    page.getByRole("button", { name: "新增固定文字" }),
  ).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport);
});
