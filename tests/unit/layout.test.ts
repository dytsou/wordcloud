import { describe, expect, it } from "vitest";
import {
  layoutWordCloud,
  layoutWordCloudAsync,
  type LayoutStyle,
} from "../../src/core/layout";
import type { FontMetricsTable } from "../../src/core/metrics";
import type { WordSet } from "../../src/core/types";

const wordSet: WordSet = {
  locale: "en",
  tokenizerVersion: "test",
  totalTokens: 6,
  words: [
    { term: "alpha", count: 4, firstSeen: 0, rank: 1, locale: "en" },
    { term: "beta", count: 2, firstSeen: 1, rank: 2, locale: "en" },
  ],
};

const metrics: FontMetricsTable = {
  baseFontSize: 16,
  fingerprint: "test-font",
  words: {
    alpha: { width: 42, height: 18 },
    beta: { width: 34, height: 18 },
  },
};

const style: LayoutStyle = {
  canvas: { width: 320, height: 220 },
  minFontSize: 18,
  maxFontSize: 64,
  scale: "sqrt",
  padding: 4,
  rotations: [0, 90],
  palette: ["#ff6b5f", "#24324a"],
  background: "#f8f3e8",
  fontFamily: "system-ui",
  seed: "seed-1",
  version: "layout-v1",
};

describe("layoutWordCloud", () => {
  it("maps frequency to size while preserving rank order", () => {
    const scene = layoutWordCloud(wordSet, style, metrics);

    expect(scene.words.map((word) => word.rank)).toEqual([1, 2]);
    expect(scene.words[0]?.fontSize).toBeGreaterThan(
      scene.words[1]?.fontSize ?? 0,
    );
    expect(scene.words.every((word) => word.status === "placed")).toBe(true);
  });

  it("is byte-stable for the same inputs and reports terms that do not fit", () => {
    const first = layoutWordCloud(wordSet, style, metrics);
    const second = layoutWordCloud(wordSet, style, metrics);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    const tiny = layoutWordCloud(
      wordSet,
      { ...style, canvas: { width: 24, height: 24 }, maxFontSize: 120 },
      metrics,
    );
    expect(tiny.words.some((word) => word.status !== "placed")).toBe(true);
    expect(tiny.words.find((word) => word.status !== "placed")).toEqual(
      expect.objectContaining({
        rank: expect.any(Number),
        reason: expect.any(String),
      }),
    );
  });

  it("supports linear and logarithmic mappings without changing rank order", () => {
    for (const scale of ["linear", "log"] as const) {
      const scene = layoutWordCloud(wordSet, { ...style, scale }, metrics);
      expect(scene.words.map((word) => word.rank)).toEqual([1, 2]);
    }
  });

  it("uses axis-aligned bounds for arbitrary rotation angles", () => {
    const scene = layoutWordCloud(
      wordSet,
      { ...style, rotations: [30] },
      metrics,
    );

    expect(scene.words[0]?.width).toBeGreaterThan(115);
    expect(scene.words[0]?.height).toBeGreaterThan(54);
  });

  it("checks cancellation while consuming the async layout steps", async () => {
    const crowded: WordSet = {
      ...wordSet,
      words: Array.from({ length: 20 }, (_, index) => ({
        term: `word-${index}`,
        count: 20 - index,
        firstSeen: index,
        rank: index + 1,
        locale: "en",
      })),
    };
    let checks = 0;
    const scene = await layoutWordCloudAsync(
      crowded,
      { ...style, canvas: { width: 120, height: 120 } },
      metrics,
      { maxProbes: 1000, shouldCancel: () => ++checks > 4 },
    );

    expect(scene.layoutStatus).toBe("cancelled");
    expect(scene.words.some((word) => word.reason === "cancelled")).toBe(true);
  });

  it("bounds oversized unplaceable geometry for rendering", () => {
    const scene = layoutWordCloud(
      {
        ...wordSet,
        words: [
          {
            ...wordSet.words[0],
            term: "a".repeat(128),
          },
        ],
      },
      { ...style, canvas: { width: 120, height: 120 } },
      metrics,
      { maxProbes: 2 },
    );

    expect(scene.words[0]?.width).toBeLessThanOrEqual(4096);
    expect(scene.words[0]?.height).toBeLessThanOrEqual(4096);
  });
});
