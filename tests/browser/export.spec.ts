import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { encodeSnapshot } from "../../src/core/snapshot";
import type { LayoutStyle } from "../../src/core/layout";
import {
  snapshotScene,
  snapshotStyle,
  snapshotWordSet,
} from "../fixtures/snapshots";
import { advanceWizard, createCloudAtStyle } from "./wizard-helpers";

test("exports the current SceneModel as safe SVG and PNG downloads", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await createCloudAtStyle(page, "export export 文字雲");
  await advanceWizard(page, "result");
  await page.getByRole("button", { name: "開啟詞語索引" }).click();
  await expect(page.getByRole("table")).toBeVisible();

  const svgDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載 SVG" }).click();
  const svgDownload = await svgDownloadPromise;
  const svgPath = await svgDownload.path();
  expect(svgDownload.suggestedFilename()).toBe("wordcloud.svg");
  const svg = await readFile(svgPath!);
  const svgText = svg.toString("utf8");
  expect(svgText).toContain("export");
  expect(svgText).toContain("文字雲");
  expect(svgText).not.toMatch(/foreignObject|url\(|<script|on[a-z]+=/iu);

  const pngDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載 PNG" }).click();
  const pngDownload = await pngDownloadPromise;
  const pngPath = await pngDownload.path();
  expect(pngDownload.suggestedFilename()).toBe("wordcloud.png");
  const png = await readFile(pngPath!);
  expect(png.byteLength).toBeGreaterThan(100);
  expect([...png.subarray(0, 8)]).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
});

test("exports the saved scene from a shaped v2 share", async ({ page }) => {
  test.setTimeout(180_000);
  const presentation = {
    ...snapshotStyle,
    version: "layout-v2",
    shape: { id: "circle", widthScale: 0.72, heightScale: 0.86 },
  } satisfies LayoutStyle;
  const scene = { ...snapshotScene, layoutVersion: "layout-v2" };
  const fragment = encodeSnapshot(
    snapshotWordSet,
    presentation,
    scene,
  ).fragment;
  await page.goto(`/${fragment}`, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "設計文字雲風格" }),
  ).toBeVisible();
  await expect(page.locator(".cloud-svg")).toContainText("hello");

  const svgDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載 SVG" }).click();
  const svgDownload = await svgDownloadPromise;
  const svgPath = await svgDownload.path();
  const svgText = (await readFile(svgPath!)).toString("utf8");
  expect(svgText).toContain("hello");
  expect(svgText).not.toMatch(/foreignObject|url\(|<script|on[a-z]+=/iu);

  const pngDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載 PNG" }).click();
  const pngDownload = await pngDownloadPromise;
  const pngPath = await pngDownload.path();
  const png = await readFile(pngPath!);
  expect([...png.subarray(0, 8)]).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
});
