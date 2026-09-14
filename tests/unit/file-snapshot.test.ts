import { describe, expect, it } from "vitest";
import {
  decodeSnapshotFile,
  encodeSnapshotFile,
} from "../../src/core/file-snapshot";
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
