import { expect, test } from "@playwright/test";
import { paintedOverlaps } from "./painted-overlaps";
import { createCloudAtStyle } from "./wizard-helpers";

test("dense multilingual cloud keeps rendered words apart", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const terms = [
    "成功大學",
    "台灣大學",
    "清華大學",
    "design",
    "research",
    "science",
    "culture",
    "community",
    "students",
    "learning",
    "technology",
    "creative",
    "future",
    "language",
    "cloud",
    "art",
    "open",
    "share",
    "studio",
    "ideas",
  ];
  const source = terms
    .flatMap((term, index) => Array.from({ length: 20 - index }, () => term))
    .join(" ");

  await createCloudAtStyle(page, source);
  const rendered = page.locator(".cloud-svg text");
  await expect(rendered.first()).toBeVisible();

  expect(await rendered.count()).toBeGreaterThan(8);
  expect(await page.locator(".cloud-svg").evaluate(paintedOverlaps)).toBe(0);
});

test("67 tightly packed words in the legacy CJK font stay apart", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 903, height: 726 });
  const terms = Array.from({ length: 67 }, (_, index) => `term${index + 1}`);
  const source = [
    ...terms,
    ...Array.from({ length: 19 }, () => terms[0]),
    ...Array.from({ length: 13 }, () => terms[1]),
    ...Array.from({ length: 9 }, () => terms[2]),
  ].join(" ");
  await createCloudAtStyle(page, source);
  const words = page.locator(".cloud-svg text");
  await expect(words).toHaveCount(67);
  const fontSelect = page.getByLabel("字型 profile");
  await fontSelect.selectOption("Noto Sans CJK TC");
  await expect(fontSelect).toBeEnabled();
  await expect(words).toHaveCount(67);

  const maxSlider = page.getByRole("slider", { name: "最大字級" });
  await maxSlider.scrollIntoViewIfNeeded();
  const maxBounds = await maxSlider.boundingBox();
  expect(maxBounds).not.toBeNull();
  if (!maxBounds) return;
  await page.mouse.click(
    maxBounds.x + maxBounds.width * ((49 - 24) / (160 - 24)),
    maxBounds.y + maxBounds.height / 2,
  );
  await expect(maxSlider).toBeEnabled();
  await expect(words).toHaveCount(67);

  const paddingSlider = page.getByRole("slider", { name: "詞間距" });
  await paddingSlider.focus();
  await paddingSlider.press("Home");
  await expect(paddingSlider).toBeEnabled();
  for (let i = 0; i < 12; i++) {
    await paddingSlider.press("ArrowRight");
    await expect(paddingSlider).toBeEnabled();
  }
  await expect(paddingSlider).toHaveValue("0");
  await expect(words).toHaveCount(67);
  expect(await page.locator(".cloud-svg").evaluate(paintedOverlaps)).toBe(0);
  await page.screenshot({
    path: "/tmp/wordcloud-density-903.png",
    fullPage: true,
  });
});
