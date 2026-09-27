import { describe, expect, it } from "vitest";
import { fromSnapshot } from "../../src/app/editor-state";
import { compileShapeMask, BUILT_IN_SHAPES } from "../../src/core/shapes";
import {
  decodeSnapshotFragment,
  encodeSnapshot,
} from "../../src/core/snapshot";
import {
  decodeSnapshotInput,
  extractSnapshotFragment,
  generateWordcloudFromText,
  renderSnapshotSvg,
  summarizeSnapshot,
} from "../../src/mcp/wordcloud";
import {
  snapshotScene,
  snapshotStyle,
  snapshotWordSet,
} from "../fixtures/snapshots";

const fragment = encodeSnapshot(
  snapshotWordSet,
  snapshotStyle,
  snapshotScene,
).fragment;

describe("MCP wordcloud helpers", () => {
  it("extracts a V fragment from either a fragment or a full URL", () => {
    expect(extractSnapshotFragment(fragment)).toBe(fragment);
    expect(
      extractSnapshotFragment(`https://wordcloud.example/share${fragment}`),
    ).toBe(fragment);
  });

  it("rejects non-V inputs without treating them as source text", () => {
    expect(() => extractSnapshotFragment("原始文字內容")).toThrow(
      /V URL or fragment/i,
    );
    expect(() => extractSnapshotFragment("https://wordcloud.example/")).toThrow(
      /V URL or fragment/i,
    );
  });

  it("summarizes derived snapshot data without a source-text field", () => {
    const summary = summarizeSnapshot(fragment, 10);

    expect(summary).toMatchObject({
      schemaVersion: "wc-snapshot-v1",
      wordCount: 1,
      totalTokens: 2,
      placedCount: 1,
      unplaceableCount: 0,
      topWords: [{ term: "hello", count: 2, rank: 1, status: "placed" }],
    });
    expect(summary).not.toHaveProperty("sourceText");
  });

  it("renders only the validated scene as escaped SVG", () => {
    const svg = renderSnapshotSvg(fragment);

    expect(svg).toContain("<svg");
    expect(svg).toContain('data-count="2"');
    expect(svg).toContain(">hello</text>");
    expect(svg).not.toContain("<script");
  });

  it("generates a V fragment and SVG from source text", () => {
    const generated = generateWordcloudFromText({
      sourceText: "Apple apple Cloudflare",
      locale: "en",
      caseInsensitive: true,
    });

    expect(generated.vFragment).toMatch(/^#wc-pako:v1:/);
    expect(generated.summary).toMatchObject({
      schemaVersion: "wc-snapshot-v1",
      layoutVersion: "layout-v1",
      totalTokens: 3,
      wordCount: 2,
      topWords: [
        { term: "Apple", count: 2, rank: 1 },
        { term: "Cloudflare", count: 1, rank: 2 },
      ],
    });
    expect(generated.svg).toContain(">Apple</text>");
    expect(generated.svg).toContain(">Cloudflare</text>");
    expect(generated.vFragment).not.toContain("Apple apple Cloudflare");
  });

  it("defaults omitted shape dimensions and writes a shaped v2 snapshot", () => {
    const generated = generateWordcloudFromText({
      sourceText: "shape settings are stored with the generated cloud",
      locale: "en",
      style: { shape: { id: "heart" } },
    });
    const snapshot = decodeSnapshotInput(generated.vFragment);

    expect(generated.vFragment).toMatch(/^#wc-pako:v1:/);
    expect(generated.summary).toMatchObject({
      schemaVersion: "wc-snapshot-v2",
      layoutVersion: "layout-v2",
    });
    expect(snapshot).toMatchObject({
      schemaVersion: "wc-snapshot-v2",
      layoutVersion: "layout-v2",
      presentation: {
        shape: { id: "heart", widthScale: 1, heightScale: 1 },
      },
    });
    expect(snapshot).not.toHaveProperty("sourceText");
    expect(generated.vFragment).not.toContain(
      "shape settings are stored with the generated cloud",
    );
    expect(
      fromSnapshot(decodeSnapshotFragment(generated.vFragment)).presentation
        .shape,
    ).toEqual({
      id: "heart",
      widthScale: 1,
      heightScale: 1,
    });
  });

  it("preserves independent shape scales and contains MCP metric footprints", () => {
    const generated = generateWordcloudFromText({
      sourceText: "alpha beta gamma delta epsilon zeta eta theta iota kappa",
      locale: "en",
      style: { shape: { id: "ellipse", widthScale: 0.8, heightScale: 0.6 } },
    });
    const snapshot = decodeSnapshotInput(generated.vFragment);

    expect(snapshot.schemaVersion).toBe("wc-snapshot-v2");
    if (snapshot.schemaVersion !== "wc-snapshot-v2") {
      throw new Error("Expected a shaped v2 snapshot.");
    }
    expect(snapshot.presentation.shape).toEqual({
      id: "ellipse",
      widthScale: 0.8,
      heightScale: 0.6,
    });

    const mask = compileShapeMask(
      snapshot.presentation.shape,
      snapshot.presentation.canvas,
    );
    const placed = snapshot.scene.words.filter(
      (word) => word.status === "placed",
    );
    expect(placed.length).toBeGreaterThan(0);
    for (const word of placed) {
      const start = Math.floor(word.x);
      const end = Math.ceil(word.x + word.width);
      for (
        let row = Math.floor(word.y);
        row < Math.ceil(word.y + word.height);
        row++
      ) {
        expect(mask.containsSpan(row, start, end)).toBe(true);
      }
    }
  });

  it("rejects invalid shape ids, missing ids, and dimensions without a shape", () => {
    expect(() =>
      generateWordcloudFromText({
        sourceText: "hello",
        style: { shape: { id: "not-a-built-in-shape" } },
      } as never),
    ).toThrow();
    expect(() =>
      generateWordcloudFromText({
        sourceText: "hello",
        style: { shape: { widthScale: 0.5 } },
      } as never),
    ).toThrow();
    expect(() =>
      generateWordcloudFromText({
        sourceText: "hello",
        style: { shape: { id: "circle", uploadedMask: "not-supported" } },
      } as never),
    ).toThrow();
    expect(() =>
      generateWordcloudFromText({
        sourceText: "hello",
        style: { shape: { id: "circle", widthScale: 0.19 } },
      } as never),
    ).toThrow();
    expect(() =>
      generateWordcloudFromText({
        sourceText: "hello",
        style: { shape: { id: "circle", heightScale: 1.01 } },
      } as never),
    ).toThrow();
    expect(() =>
      generateWordcloudFromText({
        sourceText: "hello",
        style: { widthScale: 0.5 },
      } as never),
    ).toThrow();
    expect(BUILT_IN_SHAPES).toHaveLength(30);
  });

  it("applies custom dictionary and presentation options", () => {
    const generated = generateWordcloudFromText({
      sourceText: "Cloudflare Workers machine learning Cloudflare",
      locale: "en",
      dictionary: ["Cloudflare Workers"],
      rules: [
        {
          id: "machine-learning",
          kind: "protected",
          phrase: "machine learning",
        },
      ],
      style: {
        palette: ["#112233"],
        background: "#010203",
        padding: -4,
        rotations: [120],
      },
    });
    const snapshot = decodeSnapshotInput(generated.vFragment);

    expect(snapshot.wordSet.words[0]).toMatchObject({
      term: "Cloudflare Workers",
      count: 1,
    });
    expect(snapshot.presentation).toMatchObject({
      palette: ["#112233"],
      background: "#010203",
      padding: -4,
      rotations: [120],
    });
    expect(generated.svg).toContain(">Cloudflare Workers</text>");
  });
});
