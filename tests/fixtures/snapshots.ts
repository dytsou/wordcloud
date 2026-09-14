import type { LayoutStyle } from "../../src/core/layout";
import type { SceneModel } from "../../src/core/scene";
import type { WordSet } from "../../src/core/types";

export const snapshotWordSet: WordSet = {
  locale: "en",
  tokenizerVersion: "wc-tokenizer-v1",
  totalTokens: 2,
  words: [{ term: "hello", count: 2, firstSeen: 0, rank: 1, locale: "en" }],
};

export const snapshotStyle: LayoutStyle = {
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

export const snapshotScene: SceneModel = {
  version: "scene-v1",
  layoutVersion: "layout-v1",
  canvas: { width: 320, height: 220 },
  background: "#f8f3e8",
  fontFamily: "system-ui",
  fontMetricsFingerprint: "font:test",
  seed: "seed-1",
  layoutStatus: "complete",
  words: [
    {
      term: "hello",
      count: 2,
      rank: 1,
      locale: "en",
      fontSize: 40,
      angle: 0,
      x: 120,
      y: 80,
      width: 80,
      height: 40,
      color: "#ff6b5f",
      status: "placed",
    },
  ],
};
