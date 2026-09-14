import { describe, expect, it } from "vitest";
import { DEFAULT_TOKENIZER_SETTINGS, tokenize } from "../../src/core/tokenizer";
import {
  customRuleFixture,
  multilingualFixture,
} from "../fixtures/tokenizer-cases";

describe("tokenize", () => {
  it("segments multilingual word-like terms and counts candidate tokens", () => {
    const result = tokenize(multilingualFixture, {
      ...DEFAULT_TOKENIZER_SETTINGS,
      locale: "en",
    });

    expect(result.status).toBe("ok");
    expect(result.tokens.map((token) => token.term)).toEqual([
      "Cloud",
      "cloud",
      "cloud",
      "雲端",
      "雲端",
      "データ",
      "データ",
      "ภาษา",
      "ไทย",
      "ภาษา",
      "ไทย",
      "ภาษา",
      "ไทย",
    ]);
    expect(result.capabilities).toEqual(
      expect.objectContaining({ selectedLocale: "en", supported: true }),
    );
  });

  it("applies case, stop-word, number, and symbol policies", () => {
    const result = tokenize("The THE 123 !!! keep", {
      ...DEFAULT_TOKENIZER_SETTINGS,
      locale: "en",
      caseMode: "lower",
      stopWords: ["the"],
      numberPolicy: "exclude",
      symbolPolicy: "exclude",
    });

    expect(result.tokens.map((token) => token.term)).toEqual(["keep"]);
    expect(result.filtered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "stop-word" }),
        expect.objectContaining({ reason: "number" }),
      ]),
    );
  });

  it("honors protected, split, and merge literals without recursive expansion", () => {
    const result = tokenize(customRuleFixture, {
      ...DEFAULT_TOKENIZER_SETTINGS,
      locale: "en",
      rules: [
        { id: "protect", kind: "protected", phrase: "data cloud", priority: 5 },
        {
          id: "split",
          kind: "split",
          source: "cloudnative",
          terms: ["cloud", "native"],
        },
        {
          id: "merge",
          kind: "merge",
          source: "cloud native",
          term: "cloud-native",
        },
      ],
    });

    expect(result.tokens.map((token) => token.term)).toEqual([
      "The",
      "data cloud",
      "is",
      "data cloud",
      "cloud",
      "native",
      "makes",
      "a",
      "cloud-native",
      "poster",
    ]);
  });

  it("stops before tokenization for unsupported locales", () => {
    const result = tokenize("hello", {
      ...DEFAULT_TOKENIZER_SETTINGS,
      locale: "xx-invalid",
    });

    expect(result.status).toBe("error");
    expect(result.tokens).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe("UNSUPPORTED_LOCALE");
  });

  it("returns explicit empty diagnostics", () => {
    expect(tokenize("   !!!", DEFAULT_TOKENIZER_SETTINGS)).toMatchObject({
      status: "empty",
      tokens: [],
      diagnostics: [{ code: "NO_WORDS" }],
    });
  });

  it("routes fixed language lanes and does not classify Traditional 個 as simplified", () => {
    const result = tokenize("English 雲端 データ ภาษาไทย 個 这个", {
      ...DEFAULT_TOKENIZER_SETTINGS,
      locale: "en",
    });

    expect(result.status).toBe("ok");
    expect(result.tokens.map((token) => token.term)).toEqual([
      "English",
      "雲端",
      "データ",
      "ภาษา",
      "ไทย",
      "個",
      "这个",
    ]);
    expect(result.tokens.map((token) => token.locale)).toEqual([
      "en",
      "zh-Hant",
      "ja",
      "th",
      "th",
      "zh-Hant",
      "zh-Hans",
    ]);
  });

  it("retains symbol segments when symbol policy is include", () => {
    const result = tokenize("alpha !!!", {
      ...DEFAULT_TOKENIZER_SETTINGS,
      locale: "en",
      symbolPolicy: "include",
    });

    expect(result.tokens.map((token) => token.term)).toEqual([
      "alpha",
      "!",
      "!",
      "!",
    ]);
  });

  it("never lets a merge rule consume a protected token", () => {
    const result = tokenize("alpha beta", {
      ...DEFAULT_TOKENIZER_SETTINGS,
      locale: "en",
      rules: [
        { id: "protect-beta", kind: "protected", phrase: "beta" },
        {
          id: "merge-alpha-beta",
          kind: "merge",
          source: "alpha beta",
          term: "joined",
        },
      ],
    });

    expect(result.tokens.map((token) => token.term)).toEqual(["alpha", "beta"]);
  });
});
