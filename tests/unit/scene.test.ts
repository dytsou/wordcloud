import { describe, expect, it } from "vitest";
import { recolorScene } from "../../src/core/scene";
import { layoutWordCloud, type LayoutStyle } from "../../src/core/layout";
import type { FontMetricsTable } from "../../src/core/metrics";
import type { WordSet } from "../../src/core/types";

const source: WordSet = {
  locale: "en",
  tokenizerVersion: "test",
  totalTokens: 1,
  words: [{ term: "hello", count: 1, firstSeen: 0, rank: 1, locale: "en" }],
};
const style: LayoutStyle = {
  canvas: { width: 200, height: 140 },
  minFontSize: 20,
  maxFontSize: 40,
  scale: "sqrt",
  padding: 2,
  rotations: [0],
  palette: ["#111111"],
  background: "#ffffff",
  fontFamily: "system-ui",
  seed: "scene",
  version: "layout-v1",
};
const metrics: FontMetricsTable = {
  baseFontSize: 16,
  fingerprint: "font",
  words: { hello: { width: 40, height: 18 } },
};

describe("SceneModel", () => {
  it("recolors without changing geometry or placement status", () => {
    const scene = layoutWordCloud(source, style, metrics);
    const recolored = recolorScene(scene, ["#ff0000"], "#000000");

    expect(recolored.words[0]).toEqual(
      expect.objectContaining({
        x: scene.words[0]?.x,
        y: scene.words[0]?.y,
        width: scene.words[0]?.width,
        height: scene.words[0]?.height,
        color: "#ff0000",
      }),
    );
    expect(recolored.background).toBe("#000000");
  });
});
