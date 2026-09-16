import { describe, expect, it } from "vitest";
import {
  layoutWordCloud,
  layoutWordCloudAsync,
  SpatialGrid,
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
  it("indexes every crossed cell so touching words cannot overlap across grid lines", () => {
    const grid = new SpatialGrid();
    grid.add({ x: 60, y: 60, width: 12, height: 12 });

    expect(grid.collides({ x: 65, y: 65, width: 12, height: 12 })).toBe(true);
    expect(grid.collides({ x: 72, y: 72, width: 12, height: 12 })).toBe(false);
  });

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

  it("keeps prominent words horizontal and rotates a small word into a gap", () => {
    const fallbackWordSet: WordSet = {
      locale: "en",
      tokenizerVersion: "test",
      totalTokens: 101,
      words: [
        { term: "alpha", count: 100, firstSeen: 0, rank: 1, locale: "en" },
        { term: "beta", count: 1, firstSeen: 1, rank: 2, locale: "en" },
      ],
    };
    const scene = layoutWordCloud(
      fallbackWordSet,
      {
        ...style,
        canvas: { width: 301, height: 150 },
        minFontSize: 40,
        maxFontSize: 64,
        padding: 0,
        rotations: [0, 90],
      },
      metrics,
    );

    expect(scene.words[0]?.angle).toBe(0);
    expect(Math.abs(scene.words[1]?.angle ?? 0)).toBe(90);
    expect(scene.words[1]?.width).toBeLessThan(scene.words[1]?.height ?? 0);
  });

  it("keeps rendered bounds stable while negative padding tightens placement", () => {
    const spaced = layoutWordCloud(
      wordSet,
      { ...style, padding: 0, rotations: [0] },
      metrics,
    );
    const tight = layoutWordCloud(
      wordSet,
      { ...style, padding: -4, rotations: [0] },
      metrics,
    );

    expect(tight.words[0]).toEqual(
      expect.objectContaining({
        width: spaced.words[0]?.width,
        height: spaced.words[0]?.height,
      }),
    );
  });

  it("never rotates a newly laid-out word beyond ±120 degrees", () => {
    const scene = layoutWordCloud(
      wordSet,
      { ...style, rotations: [-170, 160] },
      metrics,
    );
    expect(
      scene.words.filter((word) => word.status === "placed"),
    ).not.toHaveLength(0);
    expect(scene.words.every((word) => Math.abs(word.angle) <= 120)).toBe(true);
  });

  it("keeps every placed word inside the canvas without intersecting another word", () => {
    const terms = Array.from({ length: 24 }, (_, index) => `詞語${index}`);
    const crowded: WordSet = {
      locale: "zh-TW",
      tokenizerVersion: "test",
      totalTokens: 300,
      words: terms.map((term, index) => ({
        term,
        count: 24 - index,
        firstSeen: index,
        rank: index + 1,
        locale: "zh-TW",
      })),
    };
    const scene = layoutWordCloud(
      crowded,
      {
        ...style,
        canvas: { width: 600, height: 400 },
        minFontSize: 12,
        maxFontSize: 48,
        rotations: [0, 30, 90],
      },
      {
        ...metrics,
        words: Object.fromEntries(
          terms.map((term) => [term, { width: 44, height: 18 }]),
        ),
      },
    );
    const placed = scene.words.filter((word) => word.status === "placed");
    expect(
      placed.length,
      JSON.stringify(
        scene.words.map((word) => [word.rank, word.reason, word.status]),
      ),
    ).toBeGreaterThan(8);
    for (const [index, word] of placed.entries()) {
      expect(word.x).toBeGreaterThanOrEqual(0);
      expect(word.y).toBeGreaterThanOrEqual(0);
      expect(word.x + word.width).toBeLessThanOrEqual(scene.canvas.width);
      expect(word.y + word.height).toBeLessThanOrEqual(scene.canvas.height);
      for (const other of placed.slice(index + 1)) {
        expect(
          word.x < other.x + other.width &&
            word.x + word.width > other.x &&
            word.y < other.y + other.height &&
            word.y + word.height > other.y,
        ).toBe(false);
      }
    }
  });

  it("packs a many-word cloud tightly without dropping words", () => {
    const terms = Array.from({ length: 67 }, (_, index) => `term${index + 1}`);
    const crowded: WordSet = {
      locale: "en",
      tokenizerVersion: "test",
      totalTokens: 160,
      words: terms.map((term, index) => ({
        term,
        count: index < 3 ? 20 - index * 4 : index < 15 ? 4 : 1,
        firstSeen: index,
        rank: index + 1,
        locale: "en",
      })),
    };
    const scene = layoutWordCloud(
      crowded,
      {
        ...style,
        canvas: { width: 1000, height: 650 },
        minFontSize: 12,
        maxFontSize: 49,
        padding: 0,
        rotations: [0],
      },
      {
        ...metrics,
        words: Object.fromEntries(
          terms.map((term) => [term, { width: 58, height: 18 }]),
        ),
      },
    );
    const placed = scene.words.filter((word) => word.status === "placed");
    expect(placed).toHaveLength(67);
    const left = Math.min(...placed.map((word) => word.x));
    const top = Math.min(...placed.map((word) => word.y));
    const right = Math.max(...placed.map((word) => word.x + word.width));
    const bottom = Math.max(...placed.map((word) => word.y + word.height));
    expect((right - left) * (bottom - top)).toBeLessThan(190_000);
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
