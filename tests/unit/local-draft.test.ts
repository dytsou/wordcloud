import { describe, expect, it } from "vitest";
import { LIMITS } from "../../src/core/limits";
import {
  clearCachedSource,
  LOCAL_DRAFT_STORAGE_KEY,
  readCachedSource,
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
