import { expect, test } from "@playwright/test";
import { advanceWizard, createCloudAtStyle } from "./wizard-helpers";

test("font slider keeps the cloud visible while dragging and commits on release", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 903, height: 726 });
  await createCloudAtStyle(
    page,
    "成功大學 台灣大學 清華大學 design research science culture community ".repeat(
      10,
    ),
  );
  await expect(page.locator(".cloud-svg text").first()).toBeVisible();

  const slider = page.getByRole("slider", { name: /最大字級/u });
  await slider.scrollIntoViewIfNeeded();
  const rect = await slider.boundingBox();
  expect(rect).not.toBeNull();
  if (!rect) return;
  const y = rect.y + rect.height / 2;
  await page.mouse.move(rect.x + rect.width * 0.35, y);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.7, y, { steps: 8 });
  await expect(page.locator(".cloud-svg text").first()).toBeVisible();
  await expect(slider).toBeEnabled();
  await page.mouse.up();
  await expect(page.locator(".cloud-svg text").first()).toBeVisible();
});

test("word spacing slider supports negative tight packing", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await createCloudAtStyle(page, "style controls test words repeated repeated");

  await expect(
    page.getByRole("button", { name: "套用密集填縫排版" }),
  ).toHaveCount(0);
  await expect(page.getByRole("slider", { name: "最小字級" })).toHaveValue("8");
  await expect(page.getByRole("slider", { name: "最大字級" })).toHaveValue(
    "128",
  );
  await expect(page.getByLabel("映射")).toHaveValue("linear");
  await expect(page.getByRole("slider", { name: "旋轉方式" })).toHaveValue(
    "35",
  );
  await expect(
    page.getByRole("button", { name: "詞間距說明" }),
  ).toHaveAttribute("aria-describedby", "spacing-help");

  const slider = page.getByRole("slider", { name: "詞間距" });
  await expect(slider).toHaveAttribute("min", "-12");
  await slider.focus();
  await slider.press("Home");

  const field = page.locator(".range-field").filter({ hasText: "詞間距" });
  await expect(field.locator("output")).toHaveText("-12px");
});

test("palette presets apply curated color combinations", async ({ page }) => {
  test.setTimeout(180_000);
  await createCloudAtStyle(page, "palette presets campus palette preset words");

  const preset = page.getByRole("button", { name: "套用色盤：校園霓虹" });
  await expect(preset).toBeVisible();
  await preset.click();

  const paletteTags = page
    .locator(".tag-input")
    .filter({ has: page.locator("#palette") })
    .locator(".tag-chip-value");
  await expect(paletteTags).toHaveText([
    "#ff9418",
    "#a8e61a",
    "#f3196d",
    "#9b73ff",
    "#45c7d9",
  ]);
  await expect(preset).toHaveAttribute("aria-pressed", "true");
});

test("custom rotation stays within ±120 degrees and survives a V link", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await createCloudAtStyle(
    page,
    "成功大學 台灣大學 清華大學 design research science culture community ".repeat(
      10,
    ),
  );
  const words = page.locator(".cloud-svg text");
  await expect(words.first()).toBeVisible();

  const angleSlider = page.getByRole("slider", { name: "旋轉方式" });
  await expect(angleSlider).toHaveAttribute("max", "120");
  await angleSlider.scrollIntoViewIfNeeded();
  const rect = await angleSlider.boundingBox();
  expect(rect).not.toBeNull();
  if (!rect) return;
  await page.mouse.click(rect.x + rect.width - 2, rect.y + rect.height / 2);
  await expect(angleSlider).toBeEnabled();
  await expect(words.first()).toBeVisible();
  const angles = await words.evaluateAll((elements) =>
    elements.map((element) =>
      Number(
        element
          .getAttribute("transform")
          ?.match(/rotate\((-?\d+(?:\.\d+)?)/u)?.[1] ?? 0,
      ),
    ),
  );
  expect(angles.every((angle) => Math.abs(angle) <= 120)).toBe(true);

  await advanceWizard(page, "result");
  await page.getByRole("button", { name: "產生 V 連結" }).click();
  const url = await page.getByLabel("V URL").inputValue();
  expect(url).toContain("#wc-pako:");
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(words.first()).toBeVisible();
  const replayAngles = await words.evaluateAll((elements) =>
    elements.map((element) =>
      Number(
        element
          .getAttribute("transform")
          ?.match(/rotate\((-?\d+(?:\.\d+)?)/u)?.[1] ?? 0,
      ),
    ),
  );
  expect(replayAngles).toEqual(angles);
});
