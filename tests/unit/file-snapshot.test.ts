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
});
