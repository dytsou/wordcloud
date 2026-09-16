import { describe, expect, it } from "vitest";
import { buildWordSet } from "../../src/core/word-model";
import type { Token } from "../../src/core/types";

const tokens = (terms: string[]): Token[] =>
  terms.map((term, index) => ({
    term,
    locale: "en",
    sourceIndex: index,
  }));

describe("buildWordSet", () => {
  it("aggregates counts and gives unique stable ranks", () => {
    const wordSet = buildWordSet(tokens(["Beta", "alpha", "beta", "ALPHA"]), {
      caseMode: "lower",
      caseInsensitive: false,
      locale: "en",
      tokenizerVersion: "test",
    });

    expect(wordSet.words).toEqual([
      expect.objectContaining({
        term: "beta",
        count: 2,
        firstSeen: 0,
        rank: 1,
      }),
      expect.objectContaining({
        term: "alpha",
        count: 2,
        firstSeen: 1,
        rank: 2,
      }),
    ]);
    expect(new Set(wordSet.words.map((word) => word.rank)).size).toBe(2);
  });

  it("keeps first occurrence before Unicode order for equal frequencies", () => {
    const wordSet = buildWordSet(tokens(["z", "a"]), {
      caseMode: "preserve",
      caseInsensitive: false,
      locale: "en",
      tokenizerVersion: "test",
    });

    expect(wordSet.words.map((word) => word.term)).toEqual(["z", "a"]);
  });

  it("keeps case variants separate when ignore case is disabled", () => {
    const wordSet = buildWordSet(tokens(["Apple", "apple"]), {
      caseMode: "preserve",
      caseInsensitive: false,
      locale: "en",
      tokenizerVersion: "test",
    });

    expect(wordSet.words.map((word) => [word.term, word.count])).toEqual([
      ["Apple", 1],
      ["apple", 1],
    ]);
  });

  it("merges case variants while keeping the first display form", () => {
    const wordSet = buildWordSet(
      tokens(["Apple", "apple", "APPLE", "banana"]),
      {
        caseMode: "preserve",
        caseInsensitive: true,
        locale: "en",
        tokenizerVersion: "test",
      },
    );

    expect(wordSet.words).toEqual([
      expect.objectContaining({
        term: "Apple",
        count: 3,
        firstSeen: 0,
        rank: 1,
      }),
      expect.objectContaining({
        term: "banana",
        count: 1,
        firstSeen: 3,
        rank: 2,
      }),
    ]);
  });
});
