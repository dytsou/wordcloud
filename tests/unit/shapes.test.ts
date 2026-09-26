import { describe, expect, it } from "vitest";
import {
  BUILT_IN_SHAPES,
  compileShapeMask,
  type BuiltInShapeId,
} from "../../src/core/shapes";

const expectedIds: BuiltInShapeId[] = [
  "circle",
  "ellipse",
  "square",
  "rectangle",
  "triangle",
  "diamond",
  "hexagon",
  "star",
  "heart",
  "speech-bubble",
  "crescent-moon",
  "lightning-bolt",
  "music-note",
  "smiling-face",
  "cloud",
  "sun",
  "flower",
  "leaf",
  "mountain",
  "wave",
  "cat",
  "dog",
  "bird",
  "fish",
  "butterfly",
  "house",
  "book",
  "light-bulb",
  "trophy",
  "game-controller",
];

describe("built-in shape catalog", () => {
  it("has the 30 stable IDs in their five established categories", () => {
    expect(BUILT_IN_SHAPES.map((shape) => shape.id)).toEqual(expectedIds);
    expect(new Set(BUILT_IN_SHAPES.map((shape) => shape.id)).size).toBe(30);
    expect(new Set(BUILT_IN_SHAPES.map((shape) => shape.category))).toEqual(
      new Set(["basic", "symbols", "nature", "animals", "everyday"]),
    );
  });

  it("compiles every normalized mask into valid deterministic row spans", () => {
    for (const definition of BUILT_IN_SHAPES) {
      const first = compileShapeMask(
        { id: definition.id, widthScale: 1, heightScale: 1 },
        { width: 320, height: 220 },
      );
      const second = compileShapeMask(
        { id: definition.id, widthScale: 1, heightScale: 1 },
        { width: 320, height: 220 },
      );

      expect(first.rows).toEqual(second.rows);
      expect(first.rows.length).toBe(220);
      expect(first.rows.some((spans) => spans.length > 0)).toBe(true);
      for (const spans of first.rows) {
        let previousEnd = 0;
        for (const span of spans) {
          expect(span.start).toBeGreaterThanOrEqual(previousEnd);
          expect(span.end).toBeGreaterThan(span.start);
          expect(span.end).toBeLessThanOrEqual(320);
          previousEnd = span.end;
        }
      }
    }
  });

  it("uses max-fit native proportions and honors the 20% to 100% scale bounds", () => {
    const full = compileShapeMask(
      { id: "circle", widthScale: 1, heightScale: 1 },
      { width: 300, height: 100 },
    );
    const small = compileShapeMask(
      { id: "circle", widthScale: 0.2, heightScale: 0.2 },
      { width: 300, height: 100 },
    );

    expect(full.bounds.width).toBe(100);
    expect(full.bounds.height).toBe(100);
    expect(full.containsPoint(150, 50)).toBe(true);
    expect(full.containsPoint(50, 50)).toBe(false);
    expect(small.bounds.width).toBe(20);
    expect(small.bounds.height).toBe(20);
    expect(small.containsPoint(150, 50)).toBe(true);
    expect(small.containsPoint(165, 50)).toBe(false);
    expect(() =>
      compileShapeMask(
        { id: "circle", widthScale: 0.19, heightScale: 1 },
        { width: 100, height: 100 },
      ),
    ).toThrow(RangeError);
    expect(() =>
      compileShapeMask(
        { id: "circle", widthScale: 1, heightScale: Number.NaN },
        { width: 100, height: 100 },
      ),
    ).toThrow(RangeError);
  });

  it("preserves edge and concave boundaries for sparse mask membership", () => {
    const rectangle = compileShapeMask(
      { id: "rectangle", widthScale: 1, heightScale: 1 },
      { width: 100, height: 100 },
    );
    const heart = compileShapeMask(
      { id: "heart", widthScale: 1, heightScale: 1 },
      { width: 200, height: 200 },
    );

    expect(rectangle.containsPoint(50, 50)).toBe(true);
    expect(rectangle.containsSpan(50, 3, 97)).toBe(true);
    expect(rectangle.containsSpan(50, -1, 10)).toBe(false);
    expect(heart.containsPoint(100, 40)).toBe(false);
    expect(heart.containsPoint(55, 45)).toBe(true);

    // A narrow rotated footprint can fit at the pointed top where a horizontal
    // footprint of the same area crosses the triangle's edge.
    const triangle = compileShapeMask(
      { id: "triangle", widthScale: 1, heightScale: 1 },
      { width: 100, height: 100 },
    );
    const verticalSpans = Array.from({ length: 8 }, (_, index) => ({
      y: index + 5,
      start: 49,
      end: 51,
    }));
    expect(
      verticalSpans.every(({ y, start, end }) =>
        triangle.containsSpan(y, start, end),
      ),
    ).toBe(true);
    expect(triangle.containsSpan(0, 40, 60)).toBe(false);
  });
});
