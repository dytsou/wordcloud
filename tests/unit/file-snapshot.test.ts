import { describe, expect, it } from "vitest";
import {
  decodeSnapshotFile,
  encodeSnapshotFile,
} from "../../src/core/file-snapshot";
import { decodeUploadedShapeImage } from "../../src/core/image-shape";
import type { LayoutStyle } from "../../src/core/layout";
import { LIMITS } from "../../src/core/limits";
import {
  decodeSnapshotFragment,
  encodeSnapshot,
  type SnapshotPayload,
} from "../../src/core/snapshot";
import {
  snapshotScene,
  snapshotStyle,
  snapshotUploadedShape,
  snapshotWordSet,
} from "../fixtures/snapshots";

function expectUploadedShapeSnapshot(snapshot: SnapshotPayload) {
  expect(snapshot.schemaVersion).toBe("wc-snapshot-v3");
  if (snapshot.schemaVersion !== "wc-snapshot-v3")
    throw new Error("Expected an uploaded-shape v3 snapshot.");

  const shape = snapshot.presentation.shape;
  if (shape.id !== "uploaded") throw new Error("Expected an uploaded shape.");
  expect(shape).toEqual(snapshotUploadedShape);
  expect(shape).toMatchObject({
    id: "uploaded",
    widthScale: 0.72,
    heightScale: 0.86,
    colorMode: "original",
    colorBoundary: true,
    image: {
      width: 5,
      height: 5,
      palette: ["#6a4c93", "#1982c4"],
    },
  });
  expect(Object.keys(shape.image).sort()).toEqual(
    ["encoding", "height", "palette", "pixels", "version", "width"].sort(),
  );
  expect(JSON.stringify(snapshot)).not.toMatch(/data:image|sourcePhoto/iu);

  const { mask, pixels, raster } = decodeUploadedShapeImage(shape.image);
  expect(raster).toMatchObject({ width: 5, height: 5 });
  expect(mask[0]).toBe(0);
  expect(mask[12]).toBe(0);
  expect(mask[2]).toBe(1);
  expect(pixels).toContain(1);
  expect(pixels).toContain(2);
  expect(snapshot.presentation.canvas).toEqual({ width: 320, height: 220 });
  expect(snapshot.scene.shape).toEqual(shape);
  expect(snapshot.scene.words).toEqual([
    expect.objectContaining({ term: "hello", status: "placed" }),
  ]);
}

describe(".wc snapshot files", () => {
  it("uses the same semantic payload as the V fragment", () => {
    const shared = decodeSnapshotFragment(
      encodeSnapshot(snapshotWordSet, snapshotStyle, snapshotScene).fragment,
    );
    const file = encodeSnapshotFile(
      snapshotWordSet,
      snapshotStyle,
      snapshotScene,
    );
    const restored = decodeSnapshotFile(file);
    expect(shared.schemaVersion).toBe("wc-snapshot-v1");
    expect(restored.wordSet).toEqual(snapshotWordSet);
    expect(restored.scene).toEqual(snapshotScene);
    expect(restored.schemaVersion).toBe("wc-snapshot-v1");
    expect(restored.layoutVersion).toBe("layout-v1");
    expect(restored).toEqual(shared);
  });

  it("round-trips shape ID and dimensions in a v2 .wc file", () => {
    const presentation = {
      ...snapshotStyle,
      version: "layout-v2",
      shape: { id: "heart", widthScale: 0.68, heightScale: 0.82 },
    } satisfies LayoutStyle;
    const scene = { ...snapshotScene, layoutVersion: "layout-v2" };
    const shared = decodeSnapshotFragment(
      encodeSnapshot(snapshotWordSet, presentation, scene).fragment,
    );
    const restored = decodeSnapshotFile(
      encodeSnapshotFile(snapshotWordSet, presentation, scene),
    );

    expect(shared.schemaVersion).toBe("wc-snapshot-v2");
    expect(restored.schemaVersion).toBe("wc-snapshot-v2");
    expect(restored.layoutVersion).toBe("layout-v2");
    if (restored.schemaVersion !== "wc-snapshot-v2")
      throw new Error("Expected a v2 shaped snapshot.");
    expect(restored.presentation.shape).toEqual(presentation.shape);
    expect(restored.scene).toEqual({ ...scene, shape: presentation.shape });
    expect(restored).toEqual(shared);
  });

  it("round-trips uploaded foreground, colors, settings, and words through V3 and .wc", () => {
    const presentation = {
      ...snapshotStyle,
      version: "layout-v2",
      shape: snapshotUploadedShape,
    } satisfies LayoutStyle;
    const scene = {
      ...snapshotScene,
      layoutVersion: "layout-v2",
      shape: snapshotUploadedShape,
    };
    const fragment = encodeSnapshot(
      snapshotWordSet,
      presentation,
      scene,
    ).fragment;
    const shared = decodeSnapshotFragment(fragment);
    const restored = decodeSnapshotFile(
      encodeSnapshotFile(snapshotWordSet, presentation, scene),
    );

    expectUploadedShapeSnapshot(shared);
    expectUploadedShapeSnapshot(restored);
    expect(restored).toEqual(shared);
  });

  it("rejects oversized and invalid UTF-8 files before snapshot parsing", () => {
    expect(() =>
      decodeSnapshotFile(new Uint8Array(LIMITS.maxSnapshotFileBytes + 1)),
    ).toThrow(/exceeds/iu);
    expect(() => decodeSnapshotFile(new Uint8Array([0xc3, 0x28]))).toThrow(
      /UTF-8/iu,
    );
  });
});
