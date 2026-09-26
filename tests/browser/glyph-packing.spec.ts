import { expect, test } from "@playwright/test";
import { paintedOverlaps } from "./painted-overlaps";
import { advanceWizard, openWizard } from "./wizard-helpers";

test("dense preset fills glyph gaps, preserves colors and replays the V scene", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openWizard(page);
  const terms = [
    "陽明交大",
    "師範大學",
    "台灣大學",
    "中央大學",
    "成功大學",
    "清華大學",
    "北科大",
    "逢甲大學",
    "元智大學",
    "中原大學",
    "大同大學",
    "中興大學",
    "南山中學",
    "台科大",
    "政治大學",
    "輔仁大學",
    "銘傳大學",
    "東華大學",
    "松山高中",
    "竹北高中",
  ];
  const source = terms
    .flatMap((term, index) => Array(40 - index * 2).fill(term))
    .join(" ");
  await page.locator("#source-text").fill(source);
  await advanceWizard(page, "words");
  await page.locator("#locale").selectOption("zh-Hant");
  const dictionaryInput = page.locator("#dictionary");
  const dictionaryTags = page
    .locator(".tag-input")
    .filter({ has: dictionaryInput })
    .locator(".tag-chip-value");
  for (const [index, term] of terms.entries()) {
    await dictionaryInput.fill(term);
    await dictionaryInput.press("Enter");
    await expect(dictionaryTags).toHaveCount(index + 1);
  }
  await advanceWizard(page, "style");
  const svg = page.locator(".cloud-svg");
  await expect(svg.locator("text").first()).toBeVisible({ timeout: 120_000 });
  const before = await svg.innerHTML();
  expect(await svg.locator("text").count()).toBeGreaterThan(15);
  // Actual SVG rasterization: word boxes may overlap, their painted pixels must not.
  const overlaps = await svg.evaluate(paintedOverlaps);
  expect(overlaps).toBe(0);
  await svg.screenshot({ path: "/tmp/wordcloud-glyph-packing.png" });
  await advanceWizard(page, "result");
  await page.getByRole("button", { name: "產生 V 連結" }).click();
  const url = await page.getByLabel("V URL").inputValue();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(svg).toBeVisible();
  expect(await svg.innerHTML()).toBe(before);
});
