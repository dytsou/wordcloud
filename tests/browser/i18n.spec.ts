import { expect, test } from "@playwright/test";
import { advanceWizard, openWizard } from "./wizard-helpers";
import { translate } from "../../src/i18n";

const SHAPE_LOCALES = [
  "de",
  "en",
  "es",
  "fr",
  "ja",
  "ko",
  "th",
  "zh-Hans",
  "zh-Hant",
] as const;

const shapeMessage = (locale: string, key: string) =>
  translate(
    locale as Parameters<typeof translate>[0],
    key as Parameters<typeof translate>[1],
  );

test("uses the browser language as the initial tokenizer locale", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    locale: "en-US",
  });
  const page = await context.newPage();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect.poll(() => new URL(page.url()).pathname).toBe("/create/source");
  await page.locator("#source-text").fill("English language defaults");
  await advanceWizard(page, "words", "Continue");

  await expect(page.locator("#locale")).toHaveValue("en");
  await expect(page.getByLabel("Interface language")).toHaveValue("en");

  await context.close();
});

test("switches the interface without changing the tokenizer locale", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openWizard(page);
  await page.locator("#source-text").fill("繁體中文語系切分測試");
  await advanceWizard(page, "words");

  const tokenizerLocale = page.locator("#locale");
  await expect(tokenizerLocale).toHaveValue("zh-Hant");

  await page.getByLabel("介面語言").selectOption("en");

  await expect(
    page.getByRole("heading", { name: "Tune the vocabulary." }),
  ).toBeVisible();
  await expect(tokenizerLocale).toHaveValue("zh-Hant");

  const sourceStep = page.getByRole("button", { name: /Source/u });
  await sourceStep.evaluate((button) => (button as HTMLButtonElement).click());
  await expect.poll(() => new URL(page.url()).pathname).toBe("/create/source");
  await expect(page.getByLabel("Source text")).toBeVisible();
  await advanceWizard(page, "words", "Continue");
  await expect(tokenizerLocale).toHaveValue("zh-Hant");
});

test("shape gallery and controls expose localized accessible names", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openWizard(page);
  await page.locator("#source-text").fill("Shape gallery accessibility words");
  await advanceWizard(page, "words");
  await advanceWizard(page, "style");

  const localeSelect = page.locator("#ui-locale");
  for (const locale of SHAPE_LOCALES) {
    await localeSelect.selectOption(locale);
    const categories = shapeMessage(locale, "shapeCategoryNavigation");
    const gallery = shapeMessage(locale, "shapeGalleryLabel");
    const basic = shapeMessage(locale, "shapeCategoryBasic");
    const circle = shapeMessage(locale, "shapeNameCircle");
    const noShape = shapeMessage(locale, "shapeNoShape");

    await expect(page.getByRole("group", { name: categories })).toBeVisible();
    await expect(page.getByRole("group", { name: gallery })).toBeVisible();
    await expect(
      page.getByRole("button", { name: basic, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: circle, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: noShape, exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: circle, exact: true }).click();
    await expect(
      page.getByRole("slider", { name: shapeMessage(locale, "shapeSize") }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", {
        name: shapeMessage(locale, "shapeLockRatio"),
      }),
    ).toBeChecked();
  }
});
