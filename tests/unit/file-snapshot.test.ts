import { describe, expect, it } from "vitest";
import {
  decodeSnapshotFile,
  encodeSnapshotFile,
} from "../../src/core/file-snapshot";
import type { LayoutStyle } from "../../src/core/layout";
import {
  snapshotScene,
  snapshotStyle,
  snapshotWordSet,
} from "../fixtures/snapshots";
import { LIMITS } from "../../src/core/limits";

describe(".wc snapshot files", () => {
  it("uses the same semantic payload as the V fragment", () => {
    const file = encodeSnapshotFile(
      snapshotWordSet,
      snapshotStyle,
      snapshotScene,
    );
    const restored = decodeSnapshotFile(file);
    expect(restored.wordSet).toEqual(snapshotWordSet);
    expect(restored.scene).toEqual(snapshotScene);
    expect(restored.schemaVersion).toBe("wc-snapshot-v1");
    expect(restored.layoutVersion).toBe("layout-v1");
  });

  it("round-trips shape ID and dimensions in a v2 .wc file", () => {
    const presentation = {
      ...snapshotStyle,
      version: "layout-v2",
      shape: { id: "heart", widthScale: 0.68, heightScale: 0.82 },
    } satisfies LayoutStyle;
    const scene = { ...snapshotScene, layoutVersion: "layout-v2" };
    const restored = decodeSnapshotFile(
      encodeSnapshotFile(snapshotWordSet, presentation, scene),
    );

    expect(restored.schemaVersion).toBe("wc-snapshot-v2");
    expect(restored.layoutVersion).toBe("layout-v2");
    if (restored.schemaVersion !== "wc-snapshot-v2")
      throw new Error("Expected a v2 shaped snapshot.");
    expect(restored.presentation.shape).toEqual(presentation.shape);
    expect(restored.scene).toEqual(scene);
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
