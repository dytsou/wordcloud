import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { LayoutStyle } from "../../src/core/layout";
import {
  decodeSnapshotFragment,
  encodeSnapshot,
} from "../../src/core/snapshot";
import { privateSourceText } from "../fixtures/multilingual-text";
import {
  snapshotScene,
  snapshotStyle,
  snapshotUploadedShape,
  snapshotWordSet,
} from "../fixtures/snapshots";

async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
}

async function advance(page: Page, destination: RegExp) {
  await page
    .getByRole("button", { name: "下一步" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect.poll(() => new URL(page.url()).pathname).toMatch(destination);
}

async function readV1Url(page: Page) {
  const toggle = page.getByRole("button", { name: "點擊切換成 V1 連結" });
  await expect(
    page.locator(".share-url-copy-field input").first(),
  ).toBeVisible();
  if (!(await page.locator("#share-url-v1").isVisible())) await toggle.click();
  return page.locator("#share-url-v1").inputValue();
}

async function createCloud(page: Page, sourceText: string) {
  await page.locator("#source-text").fill(sourceText);
  await advance(page, /\/create\/words$/);
  await advance(page, /\/create\/style$/);
  await expect(page.locator(".cloud-svg")).toBeVisible();
  await advance(page, /\/create\/result$/);
  await page.getByRole("button", { name: "開啟詞語索引" }).click();
  await expect(page.getByRole("table")).toBeVisible();
}

async function expectStyleOnlyRemix(page: Page) {
  await expect(
    page.getByRole("heading", { name: "設計文字雲風格" }),
  ).toBeVisible();
  await expect(page.getByText("可重混")).toBeVisible();
  await expect(page.locator(".cloud-svg")).toBeVisible();
}

async function expectSnapshotFileRemix(page: Page) {
  await expect(
    page.getByRole("heading", { name: "文字雲已完成" }),
  ).toBeVisible();
  await expect(page.getByText("你正在編輯一個 V 快照。")).toBeVisible();
  await expect(page.locator(".cloud-svg")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("wordcloud-studio:ui-locale:v1", "zh-Hant");
  });
});

test("reopens V links as style-only remixes and .wc files as editor remixes", async ({
  page,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(30_000);
  await open(page, "/");
  await createCloud(page, privateSourceText);
  await page.getByRole("button", { name: "產生 V 連結" }).click();
  const originalUrl = await readV1Url(page);
  expect(originalUrl).toMatch(/#wc-pako:v1:/);
  expect(originalUrl).not.toContain(privateSourceText);

  await open(page, originalUrl);
  await expectStyleOnlyRemix(page);
  await expect(page.locator("#source-text")).toHaveCount(0);
  await expect(page.locator("#dictionary")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "原文" })).toHaveCount(0);
  await page.getByRole("button", { name: "套用色盤：校園霓虹" }).click();
  await page.getByRole("button", { name: "產生 V 連結" }).click();
  const remixedUrl = await readV1Url(page);
  const remixedSnapshot = decodeSnapshotFragment(new URL(remixedUrl).hash);
  expect(remixedSnapshot.schemaVersion).toBe("wc-snapshot-v1");
  expect(remixedSnapshot.presentation).not.toHaveProperty("shape");

  await open(page, remixedUrl);
  await expectStyleOnlyRemix(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /下載完整 \.wc 快照/u }).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  expect(download.suggestedFilename()).toBe("wordcloud.wc");

  await open(page, "/");
  await page
    .locator('.snapshot-import input[type="file"]')
    .setInputFiles(filePath!);
  await expectSnapshotFileRemix(page);
  await expect(page.locator("#source-text")).toHaveCount(0);
  await expect(page.locator("#dictionary")).toHaveCount(0);
  await expect(page.locator(".cloud-svg")).toBeVisible();
  await page.getByRole("button", { name: "產生 V 連結" }).click();
  const restoredUrl = await readV1Url(page);
  const restoredSnapshot = decodeSnapshotFragment(new URL(restoredUrl).hash);
  expect(restoredSnapshot.schemaVersion).toBe("wc-snapshot-v1");
  expect(restoredSnapshot.presentation).not.toHaveProperty("shape");
});

test("preserves shape geometry through v2 share and .wc round trips", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const presentation = {
    ...snapshotStyle,
    version: "layout-v2",
    shape: { id: "circle", widthScale: 0.72, heightScale: 0.86 },
  } satisfies LayoutStyle;
  const scene = { ...snapshotScene, layoutVersion: "layout-v2" };
  const originalFragment = encodeSnapshot(
    snapshotWordSet,
    presentation,
    scene,
  ).fragment;

  await open(page, `/${originalFragment}`);
  await expectStyleOnlyRemix(page);
  await expect(page.locator(".cloud-svg")).toContainText("hello");
  await expect(page.locator(".shape-ratio-lock input")).not.toBeChecked();
  await expect(page.locator("#shape-size")).toBeVisible();
  await expect(page.locator("#shape-height")).toBeVisible();
  await expect(page.locator(".shape-size-grid output").nth(0)).toHaveText(
    "72%",
  );
  await expect(page.locator(".shape-size-grid output").nth(1)).toHaveText(
    "86%",
  );

  await page.getByRole("button", { name: "產生 V 連結" }).click();
  const sharedUrl = await readV1Url(page);
  expect(new URL(sharedUrl).hash).toBe(originalFragment);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /下載完整 \.wc 快照/u }).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  expect(filePath).toBeTruthy();

  await open(page, "/");
  await page
    .locator('.snapshot-import input[type="file"]')
    .setInputFiles(filePath!);
  await expectSnapshotFileRemix(page);
  await expect(page.locator(".cloud-svg")).toContainText("hello");
  await page.getByRole("button", { name: "產生 V 連結" }).click();
  const restoredUrl = await readV1Url(page);
  expect(new URL(restoredUrl).hash).toBe(originalFragment);

  await open(page, `/${originalFragment}`);
  await expectStyleOnlyRemix(page);
  const widthSlider = page.locator("#shape-size");
  await expect(widthSlider).toBeEnabled();
  await widthSlider.focus();
  await widthSlider.press("ArrowRight");
  await expect(page.locator(".shape-size-grid output").nth(0)).not.toHaveText(
    "72%",
  );
  await expect(page.locator(".shape-size-grid output").nth(1)).toHaveText(
    "86%",
  );

  await page.getByRole("button", { name: "產生 V 連結" }).click();
  const resizedUrl = await readV1Url(page);
  const resizedSnapshot = decodeSnapshotFragment(new URL(resizedUrl).hash);
  const resizedShape = (resizedSnapshot.presentation as LayoutStyle).shape;
  expect(resizedShape?.widthScale).not.toBe(0.72);
  expect(resizedShape?.heightScale).toBe(0.86);
});

test("preserves uploaded foreground through v3 share and .wc round trips", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const presentation = {
    ...snapshotStyle,
    version: "layout-v2",
    shape: snapshotUploadedShape,
  } satisfies LayoutStyle;
  const scene = {
    ...snapshotScene,
    layoutVersion: "layout-v2",
    shape: snapshotUploadedShape,
  };
  const originalFragment = encodeSnapshot(
    snapshotWordSet,
    presentation,
    scene,
  ).fragment;
  const originalSnapshot = decodeSnapshotFragment(originalFragment);
  expect(originalSnapshot.schemaVersion).toBe("wc-snapshot-v3");

  await open(page, `/${originalFragment}`);
  await expectStyleOnlyRemix(page);
  await expect(page.locator(".cloud-svg")).toContainText("hello");

  await page.getByRole("button", { name: "產生 V 連結" }).click();
  const sharedUrl = await readV1Url(page);
  expect(new URL(sharedUrl).hash).toBe(originalFragment);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /下載完整 \.wc 快照/u }).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  expect(filePath).toBeTruthy();

  await open(page, "/");
  await page
    .locator('.snapshot-import input[type="file"]')
    .setInputFiles(filePath!);
  await expectSnapshotFileRemix(page);
  await expect(page.locator(".cloud-svg")).toContainText("hello");
  await page.getByRole("button", { name: "產生 V 連結" }).click();
  const restoredUrl = await readV1Url(page);
  const restoredSnapshot = decodeSnapshotFragment(new URL(restoredUrl).hash);
  expect(restoredSnapshot.schemaVersion).toBe("wc-snapshot-v3");
  if (restoredSnapshot.schemaVersion !== "wc-snapshot-v3") {
    throw new Error("Uploaded shapes must use a v3 snapshot.");
  }
  expect(restoredSnapshot.presentation.shape).toEqual(snapshotUploadedShape);
  expect(restoredSnapshot.scene.shape).toEqual(snapshotUploadedShape);
  expect(restoredSnapshot.scene.words).toEqual(scene.words);
});
