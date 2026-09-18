import { describe, expect, it } from "vitest";
import {
  detectUiLocale,
  normalizeUiLocale,
  translate,
  UI_LOCALE_OPTIONS,
} from "../../src/i18n";

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
});
