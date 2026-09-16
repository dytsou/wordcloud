import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION } from "../../src/app/editor-state";
import { LIMITS } from "../../src/core/limits";
import {
  clearCachedSource,
  LOCAL_DICTIONARY_STORAGE_KEY,
  LOCAL_DRAFT_STORAGE_KEY,
  LOCAL_STOP_WORDS_STORAGE_KEY,
  LOCAL_STYLE_STORAGE_KEY,
  TOKEN_INPUT_CACHE_TTL_MS,
  readCachedDictionary,
  readCachedEditorPreferences,
  readCachedStopWords,
  readCachedSource,
  writeCachedDictionary,
  writeCachedStopWords,
  writeCachedStylePreferences,
  writeCachedSource,
} from "../../src/app/local-draft";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("local source draft", () => {
  it("round-trips multilingual source text", () => {
    const storage = createStorage();
    const source = "成功大學 · café · ภาษาไทย";

    writeCachedSource(source, storage);

    expect(readCachedSource(storage)).toBe(source);
    expect(storage.getItem(LOCAL_DRAFT_STORAGE_KEY)).toContain('"version":1');
  });

  it("ignores malformed or oversized cached values", () => {
    const storage = createStorage();
    storage.setItem(LOCAL_DRAFT_STORAGE_KEY, "not-json");
    expect(readCachedSource(storage)).toBe("");

    storage.setItem(
      LOCAL_DRAFT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        sourceText: "x".repeat(LIMITS.maxSourceBytes + 1),
      }),
    );
    expect(readCachedSource(storage)).toBe("");
  });

  it("removes the draft when the source is emptied or reset", () => {
    const storage = createStorage();
    writeCachedSource("draft", storage);
    writeCachedSource("", storage);
    expect(storage.getItem(LOCAL_DRAFT_STORAGE_KEY)).toBeNull();

    writeCachedSource("draft", storage);
    clearCachedSource(storage);
    expect(readCachedSource(storage)).toBe("");
  });

  it("treats unavailable storage as an in-memory-only fallback", () => {
    const storage = {
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("storage blocked");
      },
      removeItem: () => {
        throw new Error("storage blocked");
      },
    };

    expect(readCachedSource(storage)).toBe("");
    expect(() => writeCachedSource("draft", storage)).not.toThrow();
    expect(() => clearCachedSource(storage)).not.toThrow();
  });
});

describe("local editor preferences", () => {
  it("expires stop words and dictionary entries after 24 hours", () => {
    const storage = createStorage();
    const now = 1_000;

    writeCachedStopWords(["的", "the"], storage, now);
    writeCachedDictionary(["人工智慧"], storage, now);

    expect(
      readCachedStopWords(storage, now + TOKEN_INPUT_CACHE_TTL_MS - 1),
    ).toEqual(["的", "the"]);
    expect(
      readCachedDictionary(storage, now + TOKEN_INPUT_CACHE_TTL_MS - 1),
    ).toEqual(["人工智慧"]);
    expect(
      readCachedStopWords(storage, now + TOKEN_INPUT_CACHE_TTL_MS),
    ).toBeUndefined();
    expect(
      readCachedDictionary(storage, now + TOKEN_INPUT_CACHE_TTL_MS),
    ).toBeUndefined();
    expect(storage.getItem(LOCAL_STOP_WORDS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(LOCAL_DICTIONARY_STORAGE_KEY)).toBeNull();
  });

  it("keeps style preferences without a TTL", () => {
    const storage = createStorage();
    const presentation = {
      ...DEFAULT_PRESENTATION,
      minFontSize: 16,
      maxFontSize: 96,
      padding: -4,
      rotations: [0, -45, 45],
      palette: ["#123456"],
    };

    writeCachedStylePreferences(presentation, storage);

    const expected = {
      minFontSize: 16,
      maxFontSize: 96,
      padding: -4,
      rotations: [0, -45, 45],
      palette: ["#123456"],
    };
    expect(readCachedEditorPreferences(storage).presentation).toEqual(expected);
    expect(
      readCachedEditorPreferences(storage, Number.MAX_SAFE_INTEGER)
        .presentation,
    ).toEqual(expected);
    expect(storage.getItem(LOCAL_STYLE_STORAGE_KEY)).toContain('"version":1');
  });

  it("removes empty token caches and ignores invalid preference values", () => {
    const storage = createStorage();

    writeCachedStopWords(["the"], storage);
    writeCachedDictionary(["Cloudflare Workers"], storage);
    writeCachedStopWords([], storage);
    writeCachedDictionary([], storage);
    expect(storage.getItem(LOCAL_STOP_WORDS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(LOCAL_DICTIONARY_STORAGE_KEY)).toBeNull();

    storage.setItem(
      LOCAL_STYLE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        minFontSize: 160,
        maxFontSize: 8,
        padding: 0,
        rotationAngle: 121,
        palette: ["#123456"],
      }),
    );
    expect(readCachedEditorPreferences(storage).presentation).toBeUndefined();
    expect(storage.getItem(LOCAL_STYLE_STORAGE_KEY)).toBeNull();
  });

  it("treats preference storage failures as an in-memory-only fallback", () => {
    const storage = {
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("storage blocked");
      },
      removeItem: () => {
        throw new Error("storage blocked");
      },
    };

    expect(readCachedStopWords(storage)).toBeUndefined();
    expect(readCachedDictionary(storage)).toBeUndefined();
    expect(readCachedEditorPreferences(storage)).toEqual({
      stopWords: undefined,
      dictionary: undefined,
      presentation: undefined,
    });
    expect(() => writeCachedStopWords(["the"], storage)).not.toThrow();
    expect(() => writeCachedDictionary(["人工智慧"], storage)).not.toThrow();
    expect(() =>
      writeCachedStylePreferences(DEFAULT_PRESENTATION, storage),
    ).not.toThrow();
  });
});
