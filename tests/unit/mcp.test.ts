import { describe, expect, it } from "vitest";
import { encodeSnapshot } from "../../src/core/snapshot";
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
      totalTokens: 3,
      wordCount: 2,
      topWords: [
        { term: "Apple", count: 2, rank: 1 },
        { term: "Cloudflare", count: 1, rank: 2 },
      ],
    });
    expect(generated.svg).toContain(">Apple</text>");
    expect(generated.svg).toContain(">Cloudflare</text>");
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
