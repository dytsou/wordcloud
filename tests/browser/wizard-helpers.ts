import { expect, type Page } from "@playwright/test";

const STEP_PATHS = {
  source: "/create/source",
  words: "/create/words",
  style: "/create/style",
  result: "/create/result",
} as const;

export async function openWizard(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("wordcloud-studio:ui-locale:v1", "zh-Hant");
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect.poll(() => new URL(page.url()).pathname).toBe(STEP_PATHS.source);
}

export async function advanceWizard(
  page: Page,
  step: keyof typeof STEP_PATHS,
  label = "下一步",
) {
  const continueButton = page.getByRole("button", {
    name: label,
    exact: true,
  });
  await expect(continueButton).toBeEnabled();
  await continueButton.evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  await expect.poll(() => new URL(page.url()).pathname).toBe(STEP_PATHS[step]);
}

export async function createCloudAtStyle(page: Page, sourceText: string) {
  await openWizard(page);
  await page.locator("#source-text").fill(sourceText);
  await advanceWizard(page, "words");
  await advanceWizard(page, "style");
  await expect(page.locator(".cloud-svg text").first()).toBeVisible({
    timeout: 30_000,
  });
}
