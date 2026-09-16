import { describe, expect, it } from "vitest";
import { GlyphGrid, padGlyph } from "../../src/core/glyph-grid";
import { layoutWordCloud } from "../../src/core/layout";
import { DEFAULT_PRESENTATION } from "../../src/app/editor-state";

describe("glyph occupancy", () => {
  it("matches pixel occupancy across shifted 32-bit boundaries and rows", () => {
    const sprite = {
      width: 65,
      height: 3,
      pixels: new Uint32Array([0, 31, 32, 64, 65, 97, 129, 194]),
    };
    const dot = { width: 1, height: 1, pixels: new Uint32Array([0]) };
    for (const offset of [0, 1, 17, 31, 32, 63]) {
      const grid = new GlyphGrid(160, 8);
      grid.add(sprite, offset, 2);
      const expected = new Set(
        Array.from(
          sprite.pixels,
          (pixel) => `${offset + (pixel % 65)}:${2 + Math.floor(pixel / 65)}`,
        ),
      );
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 160; x++) {
          expect(grid.collides(dot, x, y)).toBe(expected.has(`${x}:${y}`));
        }
    }
  });
  it("fits a small glyph inside a hollow glyph without crossing its strokes", () => {
    const ring = new Uint8Array(100);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 10; x++) {
        if (x === 0 || y === 0 || x === 9 || y === 9) ring[y * 10 + x] = 1;
      }
    const grid = new GlyphGrid(30, 30);
    grid.add(
      { width: 10, height: 10, pixels: padGlyph(ring, 10, 10, 0) },
      10,
      10,
    );
    const dot = { width: 1, height: 1, pixels: new Uint32Array([0]) };
    expect(grid.collides(dot, 15, 15)).toBe(false);
    expect(grid.collides(dot, 10, 15)).toBe(true);
  });

  it("expands spacing and permits explicit negative-spacing erosion", () => {
    const solid = new Uint8Array(25).fill(1);
    expect(padGlyph(solid, 5, 5, -1)).toHaveLength(9);
    const dot = new Uint8Array(25);
    dot[12] = 1;
    expect(padGlyph(dot, 5, 5, 1)).toHaveLength(9);
    expect(padGlyph(dot, 5, 5, 0)).toHaveLength(1);
  });

  it("packs overlapping word boxes using non-overlapping pixels deterministically", () => {
    const ring = new Uint8Array(10000);
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++) {
        if (x < 3 || y < 3 || x > 96 || y > 96) ring[y * 100 + x] = 1;
      }
    const words = ["outer", "inner"].map((term, index) => ({
      term,
      count: 2 - index,
      rank: index + 1,
      firstSeen: index,
      locale: "en",
    }));
    const wordSet = {
      words,
      locale: "en",
      totalTokens: 3,
      tokenizerVersion: "test",
    };
    const metrics = {
      baseFontSize: 16,
      fingerprint: "glyph-test",
      words: {},
      sprites: {
        outer: {
          0: { width: 100, height: 100, pixels: padGlyph(ring, 100, 100, 0) },
        },
        inner: {
          0: {
            width: 10,
            height: 10,
            pixels: Uint32Array.from({ length: 100 }, (_, i) => i),
          },
        },
      },
    };
    const style = {
      ...DEFAULT_PRESENTATION,
      padding: 0,
      canvas: { width: 120, height: 120 },
    };
    const scene = layoutWordCloud(wordSet, style, metrics);
    expect(scene.words.every((word) => word.status === "placed")).toBe(true);
    expect(scene.words[1].x).toBeGreaterThan(scene.words[0].x);
    expect(scene.words[1].x + 10).toBeLessThan(scene.words[0].x + 100);
    expect(layoutWordCloud(wordSet, style, metrics)).toEqual(scene);
  });
});
