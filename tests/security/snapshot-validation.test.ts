import { describe, expect, it } from "vitest";
import {
  CODEC_VERSION,
  decodeScenePackFragment,
  encodeLegacyJsonFragment,
  encodeScenePackFragment,
} from "../../src/core/codec";
import type { LayoutStyle } from "../../src/core/layout";
import {
  decodeSnapshotFragment,
  encodeSnapshot,
  validateSnapshot,
  type SnapshotPayload,
} from "../../src/core/snapshot";
import { buildShapeFillDots } from "../../src/core/shape-fill";
import { renderSceneSvg } from "../../src/render/svg";
import {
  snapshotScene,
  snapshotStyle,
  snapshotWordSet,
} from "../fixtures/snapshots";

const valid = () =>
  encodeSnapshot(snapshotWordSet, snapshotStyle, snapshotScene).fragment;

function encodeLegacySnapshot(snapshot: SnapshotPayload): string {
  return encodeLegacyJsonFragment(snapshot).fragment;
}

function shapedSnapshot(
  shape: unknown = {
    id: "heart",
    widthScale: 0.72,
    heightScale: 0.84,
  },
) {
  const legacy = decodeSnapshotFragment(valid());
  return {
    ...legacy,
    schemaVersion: "wc-snapshot-v2",
    layoutVersion: "layout-v2",
    presentation: {
      ...snapshotStyle,
      version: "layout-v2",
      shape,
    },
    scene: { ...snapshotScene, layoutVersion: "layout-v2" },
  };
}

describe("snapshot validation", () => {
  it("round-trips derived terms without source text or rule bodies", () => {
    const fragment = valid();
    const snapshot = decodeSnapshotFragment(fragment);
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.wordSet).toEqual(snapshotWordSet);
    expect(serialized).not.toContain("sourceText");
    expect(serialized).not.toContain("protected phrase");
  });

  it("reads original V1 snapshot payloads", () => {
    const snapshot = decodeSnapshotFragment(valid());
    const legacyFragment = encodeLegacySnapshot(snapshot);
    const restored = decodeSnapshotFragment(legacyFragment);

    expect(legacyFragment).toMatch(/^#wc-pako:v1:/u);
    expect(restored.codecVersion).toBe(CODEC_VERSION);
    expect(restored.scene).toEqual(snapshotScene);
  });

  it("keeps the existing v1 payload shape and saved layout for unshaped clouds", () => {
    const snapshot = decodeSnapshotFragment(valid());

    expect(snapshot.schemaVersion).toBe("wc-snapshot-v1");
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        "schemaVersion",
        "codecVersion",
        "tokenizerVersion",
        "layoutVersion",
        "sceneVersion",
        "wordSet",
        "presentation",
        "scene",
      ].sort(),
    );
    expect(snapshot.layoutVersion).toBe("layout-v1");
    expect(snapshot.presentation).toEqual(snapshotStyle);
    expect(snapshot.scene).toEqual(snapshotScene);
  });

  it("round-trips shape geometry in the V1 ScenePack format", () => {
    const presentation = {
      ...snapshotStyle,
      version: "layout-v2",
      shape: { id: "heart", widthScale: 0.72, heightScale: 0.84 },
    } satisfies LayoutStyle;
    const scene = { ...snapshotScene, layoutVersion: "layout-v2" };
    const encoded = encodeSnapshot(snapshotWordSet, presentation, scene);
    const snapshot = decodeSnapshotFragment(encoded.fragment);

    expect(encoded.fragment).toMatch(/^#wc-pako:v1:/u);
    expect(snapshot.schemaVersion).toBe("wc-snapshot-v2");
    expect(snapshot.layoutVersion).toBe("layout-v2");
    if (snapshot.schemaVersion !== "wc-snapshot-v2")
      throw new Error("Expected a v2 shaped snapshot.");
    expect(snapshot.presentation.shape).toEqual(presentation.shape);
    expect(snapshot.scene).toEqual({ ...scene, shape: presentation.shape });
    const originalScene = { ...scene, shape: presentation.shape };
    expect(buildShapeFillDots(snapshot.scene)).toEqual(
      buildShapeFillDots(originalScene),
    );
    expect(renderSceneSvg(snapshot.scene)).toContain('id="wordcloud-fill"');
  });

  it("rejects ScenePack words that reference an unknown term", () => {
    const packed = decodeScenePackFragment(valid());
    if (!Array.isArray(packed)) throw new Error("Expected a ScenePack tuple.");
    const packedSnapshot = packed[1] as { scene: { words: unknown[] } };
    const packedWord = packedSnapshot.scene.words[0];
    if (!Array.isArray(packedWord))
      throw new Error("Expected a packed word tuple.");
    packedWord[0] = snapshotWordSet.words.length;
    const tampered = encodeScenePackFragment(packed).fragment;

    expect(() => decodeSnapshotFragment(tampered)).toThrow(
      /invalid word index/iu,
    );
  });

  it("rejects scene shape settings that disagree with the presentation", () => {
    const mismatch = shapedSnapshot();
    mismatch.scene = {
      ...snapshotScene,
      layoutVersion: "layout-v2",
      shape: { id: "circle", widthScale: 0.72, heightScale: 0.84 },
    };
    expect(() => validateSnapshot(mismatch)).toThrow(/scene shape/iu);
  });

  it.each([
    ["unknown IDs", { id: "made-up", widthScale: 0.72, heightScale: 0.84 }],
    ["NaN scales", { id: "heart", widthScale: Number.NaN, heightScale: 0.84 }],
    [
      "infinite scales",
      { id: "heart", widthScale: 0.72, heightScale: Infinity },
    ],
    ["scales below 20%", { id: "heart", widthScale: 0.19, heightScale: 0.84 }],
    ["scales above 100%", { id: "heart", widthScale: 0.72, heightScale: 1.01 }],
    [
      "extra shape fields",
      { id: "heart", widthScale: 0.72, heightScale: 0.84, fill: "red" },
    ],
  ])("rejects shaped snapshots with %s", (_label, shape) => {
    expect(() => validateSnapshot(shapedSnapshot(shape))).toThrow();
  });

  it("requires v2 snapshots to have a shape and v1 snapshots to remain unshaped", () => {
    const v2WithoutShape = {
      ...shapedSnapshot(),
      presentation: { ...snapshotStyle, version: "layout-v2" },
    };
    expect(() => validateSnapshot(v2WithoutShape)).toThrow();

    const v1WithShape = decodeSnapshotFragment(valid());
    expect(() =>
      validateSnapshot({
        ...v1WithShape,
        presentation: {
          ...snapshotStyle,
          shape: { id: "heart", widthScale: 1, heightScale: 1 },
        },
      }),
    ).toThrow();
  });

  it("rejects unallowlisted styles and scene records atomically", () => {
    const fragment = valid();
    const snapshot = decodeSnapshotFragment(fragment);
    snapshot.presentation.fontFamily = "url(https://evil.example/font)";
    const tampered = encodeLegacySnapshot(snapshot);

    expect(() => decodeSnapshotFragment(tampered)).toThrow(/font|style|allow/i);
  });

  it("accepts negative padding for deliberate tight packing", () => {
    const snapshot = decodeSnapshotFragment(valid());
    snapshot.presentation.padding = -6;
    const tampered = encodeLegacySnapshot(snapshot);

    expect(decodeSnapshotFragment(tampered).presentation.padding).toBe(-6);
  });

  it("keeps XML-looking terms as inert data for the renderer boundary", () => {
    const scene = {
      ...snapshotScene,
      words: [{ ...snapshotScene.words[0], term: "<script>alert(1)</script>" }],
    };
    const wordSet = {
      ...snapshotWordSet,
      words: [
        { ...snapshotWordSet.words[0], term: "<script>alert(1)</script>" },
      ],
    };
    const fragment = encodeSnapshot(wordSet, snapshotStyle, scene).fragment;
    expect(decodeSnapshotFragment(fragment).scene.words[0]?.term).toBe(
      "<script>alert(1)</script>",
    );
  });

  it("rejects placed scene geometry outside the declared canvas", () => {
    const snapshot = decodeSnapshotFragment(valid());
    snapshot.scene.words[0] = {
      ...snapshot.scene.words[0],
      x: snapshot.scene.canvas.width,
    };
    const tampered = encodeLegacySnapshot(snapshot);

    expect(() => decodeSnapshotFragment(tampered)).toThrow(/canvas|bounds/iu);
  });
});
