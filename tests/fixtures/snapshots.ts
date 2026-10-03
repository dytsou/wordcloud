import type { LayoutInput } from "../../src/app/engine-client";
import {
  encodeImageBytes,
  type UploadedShapeSettings,
} from "../../src/core/image-shape";
import type { LayoutStyle } from "../../src/core/layout";
import type { FontMetricsTable } from "../../src/core/metrics";
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

const uploadedShapePixels = Uint8Array.from([
  0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 1, 0, 2, 2, 0, 1, 2, 2, 0, 0, 0, 1, 0, 0,
]);

export const snapshotUploadedShape: UploadedShapeSettings = {
  id: "uploaded",
  widthScale: 0.72,
  heightScale: 0.86,
  image: {
    version: 1,
    width: 5,
    height: 5,
    palette: ["#6a4c93", "#1982c4"],
    encoding: "raw",
    pixels: encodeImageBytes(uploadedShapePixels),
  },
  colorMode: "original",
  colorBoundary: true,
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

export const snapshotMetrics: FontMetricsTable = {
  baseFontSize: 16,
  fingerprint: "font:test",
  words: { hello: { width: 80, height: 40 } },
};

export const snapshotLayoutInput: LayoutInput = {
  wordSet: snapshotWordSet,
  style: snapshotStyle,
  metrics: snapshotMetrics,
};
