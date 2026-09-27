import { describe, expect, it } from "vitest";
import {
  detectUiLocale,
  normalizeUiLocale,
  translate,
  UI_LOCALE_OPTIONS,
} from "../../src/i18n";
import { SHAPE_CATEGORIES, BUILT_IN_SHAPES } from "../../src/core/shapes";
import { DE_MESSAGES } from "../../src/i18n/messages/de";
import { EN_MESSAGES } from "../../src/i18n/messages/en";
import { ES_MESSAGES } from "../../src/i18n/messages/es";
import { FR_MESSAGES } from "../../src/i18n/messages/fr";
import { JA_MESSAGES } from "../../src/i18n/messages/ja";
import { KO_MESSAGES } from "../../src/i18n/messages/ko";
import { TH_MESSAGES } from "../../src/i18n/messages/th";
import { ZH_HANS_MESSAGES } from "../../src/i18n/messages/zh-Hans";
import { ZH_HANT_MESSAGES } from "../../src/i18n/messages/zh-Hant";

const SHAPE_LOCALE_MODULES = {
  de: DE_MESSAGES,
  en: EN_MESSAGES,
  es: ES_MESSAGES,
  fr: FR_MESSAGES,
  ja: JA_MESSAGES,
  ko: KO_MESSAGES,
  th: TH_MESSAGES,
  "zh-Hans": ZH_HANS_MESSAGES,
  "zh-Hant": ZH_HANT_MESSAGES,
} as const;

const shapeNameKey = (id: string) =>
  `shapeName${id.replace(/(^|-)([a-z])/gu, (_match, _hyphen, letter: string) =>
    letter.toUpperCase(),
  )}`;

const shapeCategoryKey = (category: string) =>
  `shapeCategory${category[0].toUpperCase()}${category.slice(1)}`;

const SHAPE_CONTROL_KEYS = [
  "shapeGalleryLabel",
  "shapeCategoryNavigation",
  "shapeNoShape",
  "shapeLockRatio",
  "shapeSize",
  "shapeWidth",
  "shapeHeight",
  "shapeReset",
  "shapeOneWordNoFit",
  "shapeNoWordsFit",
  "shapeAdjustSize",
  "shapeRemoveMask",
];

describe("i18n", () => {
  it("normalizes regional browser languages to supported UI locales", () => {
    expect(normalizeUiLocale("zh-TW")).toBe("zh-Hant");
    expect(normalizeUiLocale("zh-CN")).toBe("zh-Hans");
    expect(normalizeUiLocale("en-US")).toBe("en");
    expect(normalizeUiLocale("xx-YY")).toBe("en");
  });

  it("lists many selectable UI languages and translates interpolated labels", () => {
    expect(UI_LOCALE_OPTIONS.length).toBeGreaterThanOrEqual(12);
    expect(translate("zh-Hant", "sourceLabel")).toBe("原文");
    expect(translate("en", "sourceHeading")).toBe("Bring the words in.");
    expect(translate("en", "wordCount", { count: 12 })).toBe("12 words");
  });

  it("falls back to a stable locale when browser APIs are unavailable", () => {
    const previousNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { language: "fr-FR", languages: ["fr-FR"] },
    });

    expect(detectUiLocale()).toBe("fr");

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: previousNavigator,
    });
  });

  it("defines localized category, shape, and recovery labels in all nine message modules", () => {
    const keys = [
      ...SHAPE_CATEGORIES.map(shapeCategoryKey),
      ...BUILT_IN_SHAPES.map((shape) => shapeNameKey(shape.id)),
      ...SHAPE_CONTROL_KEYS,
    ];

    expect(BUILT_IN_SHAPES).toHaveLength(30);
    for (const [locale, messages] of Object.entries(SHAPE_LOCALE_MODULES)) {
      const messageMap = messages as Record<string, string | undefined>;
      for (const key of keys) {
        const message = messageMap[key];
        expect(typeof message, `${locale} is missing ${key}`).toBe("string");
        expect(message?.trim(), `${locale} has an empty ${key}`).not.toBe("");
        expect(message, `${locale} exposes the key instead of ${key}`).not.toBe(
          key,
        );
      }
    }
  });
});
