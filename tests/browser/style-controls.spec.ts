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

test("built-in silhouette gallery preserves and resets shape proportions", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await createCloudAtStyle(page, "shape gallery campus research words");
  await page.locator("#ui-locale").selectOption("en");

  const categories = page.getByRole("group", { name: "Shape categories" });
  const gallery = page.getByRole("group", { name: "Built-in shapes" });
  const noShape = page.getByRole("button", { name: "No shape", exact: true });

  await expect(categories).toBeVisible();
  await expect(gallery).toBeVisible();
  await expect(noShape).toHaveAttribute("aria-pressed", "true");

  await expect(
    gallery
      .getByRole("button", { name: "Ellipse", exact: true })
      .locator(".shape-thumbnail"),
  ).toHaveAttribute("viewBox", "0 0 1.45 1");

  for (const [name, shapeNames] of [
    [
      "Basic forms",
      [
        "Circle",
        "Ellipse",
        "Square",
        "Rectangle",
        "Triangle",
        "Diamond",
        "Hexagon",
        "Star",
      ],
    ],
    [
      "Symbols",
      [
        "Heart",
        "Speech bubble",
        "Crescent moon",
        "Lightning bolt",
        "Music note",
        "Smiling face",
      ],
    ],
    ["Nature", ["Cloud", "Sun", "Flower", "Leaf", "Mountain", "Wave"]],
    ["Animals", ["Cat", "Dog", "Bird", "Fish", "Butterfly"]],
    [
      "Everyday and activities",
      ["House", "Book", "Light bulb", "Trophy", "Game controller"],
    ],
  ] as const) {
    await categories.getByRole("button", { name, exact: true }).click();
    await expect(gallery.getByRole("button")).toHaveCount(shapeNames.length);
    for (const shapeName of shapeNames) {
      const option = gallery.getByRole("button", {
        name: shapeName,
        exact: true,
      });
      await expect(option).toBeVisible();
      await expect(option.locator(".shape-thumbnail")).toBeVisible();
    }
  }

  await categories.getByRole("button", { name: "Symbols" }).click();
  await expect(
    gallery
      .getByRole("button", { name: "Lightning bolt", exact: true })
      .locator(".shape-thumbnail"),
  ).toHaveAttribute("viewBox", "0 0 0.78 1");

  await categories.getByRole("button", { name: "Basic forms" }).click();
  await gallery.getByRole("button", { name: "Ellipse", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Lock aspect ratio" }),
  ).toBeChecked();

  const lockedSize = page.getByRole("slider", { name: "Shape size" });
  await expect(lockedSize).toHaveValue("1");
  await expect(lockedSize).toBeEnabled();
  await lockedSize.focus();
  await page.keyboard.down("Home");
  await expect(lockedSize).toHaveValue("0.2");
  await expect(lockedSize).toBeEnabled();
  await expect(page.locator(".cloud-svg text").first()).toBeVisible();
  await page.keyboard.up("Home");

  await page.getByRole("checkbox", { name: "Lock aspect ratio" }).uncheck();
  const width = page.getByRole("slider", { name: "Shape width" });
  const height = page.getByRole("slider", { name: "Shape height" });
  await expect(width).toHaveValue("0.2");
  await expect(height).toHaveValue("0.2");
  await width.focus();
  await width.press("ArrowRight");
  await expect(width).toHaveValue("0.25");
  await expect(height).toHaveValue("0.2");

  await categories.getByRole("button", { name: "Symbols" }).click();
  await gallery.getByRole("button", { name: "Heart", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Lock aspect ratio" }),
  ).toBeChecked();
  const resetSize = page.getByRole("slider", { name: "Shape size" });
  await expect(resetSize).toHaveValue("1");
  await expect(resetSize).toBeEnabled();

  await page.getByRole("checkbox", { name: "Lock aspect ratio" }).uncheck();
  const resetButton = page.getByRole("button", { name: "Reset shape size" });
  await expect(resetButton).toBeEnabled();
  await resetButton.click();
  await expect(
    page.getByRole("checkbox", { name: "Lock aspect ratio" }),
  ).toBeChecked();

  await resetSize.press("Home");
  await resetButton.click();
  await expect(page.getByRole("slider", { name: "Shape size" })).toHaveValue(
    "1",
  );
  await expect(
    page.getByRole("checkbox", { name: "Lock aspect ratio" }),
  ).toBeChecked();

  await noShape.click();
  await expect(noShape).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("slider", { name: "Shape size" })).toHaveCount(0);
  await expect(page.locator(".cloud-svg text").first()).toBeVisible();
});

test("zero-fit silhouette offers focused size adjustment and mask removal", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await createCloudAtStyle(page, "community");
  await page.locator("#ui-locale").selectOption("en");
  const minimumFontSize = page.getByRole("slider", {
    name: "Minimum size",
  });
  await expect(minimumFontSize).toBeEnabled();
  await minimumFontSize.focus();
  await minimumFontSize.press("End");

  const gallery = page.getByRole("group", { name: "Built-in shapes" });
  await gallery.getByRole("button", { name: "Circle", exact: true }).click();
  const size = page.getByRole("slider", { name: "Shape size" });
  await expect(size).toBeEnabled();
  await size.press("Home");
  await expect(page.locator(".cloud-svg text")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Adjust shape size" }),
  ).toBeVisible();

  await advanceWizard(page, "result", "Continue");
  await page.getByRole("button", { name: "Open the word index" }).click();
  const wordIndex = page.getByRole("dialog", { name: "Word index" });
  await expect(
    wordIndex.getByRole("row", {
      name: /community.*(?:unplaceable|budget limited)/u,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove shape" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Adjust shape size" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/create/style");
  await expect(size).toBeFocused();

  await page.getByRole("button", { name: "Remove shape" }).click();
  await expect(page.locator(".cloud-svg text").first()).toBeVisible();
  await advanceWizard(page, "result", "Continue");
  await page.getByRole("button", { name: "Open the word index" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Word index" })
      .getByRole("row", { name: /community.*placed/u }),
  ).toBeVisible();
});
