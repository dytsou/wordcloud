import { describe, expect, it } from "vitest";
import { encodeLegacyJsonFragment } from "../../src/core/codec";
import {
  decodeSnapshotFile,
  encodeSnapshotFile,
} from "../../src/core/file-snapshot";
import { LIMITS, utf8ByteLength } from "../../src/core/limits";
import {
  createSnapshot,
  decodeSnapshotFragment,
  encodeSnapshotPayload,
} from "../../src/core/snapshot";
import type { SceneModel } from "../../src/core/scene";
import type { WordSet } from "../../src/core/types";
import {
  snapshotScene,
  snapshotStyle,
  snapshotWordSet,
} from "../fixtures/snapshots";

function highEntropyTerm(rank: number): string {
  let state = Math.imul(rank, 0x45d9f3b) >>> 0;
  let term = "";
  for (let index = 0; index < 124; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    term += String.fromCharCode(97 + ((state >>> 0) % 26));
  }
  return `${term}${rank.toString(26).padStart(4, "a")}`;
}

function largeSnapshot() {
  const wordSet: WordSet = {
    ...snapshotWordSet,
    totalTokens: LIMITS.maxUniqueTerms,
    words: Array.from({ length: LIMITS.maxUniqueTerms }, (_, index) => ({
      term: highEntropyTerm(index + 1),
      count: 1,
      firstSeen: index,
      rank: index + 1,
      locale: "en",
    })),
  };
  const template = snapshotScene.words[0];
  if (!template) throw new Error("Expected a scene word fixture.");
  const scene: SceneModel = {
    ...snapshotScene,
    words: wordSet.words.map((word) => ({
      term: word.term,
      count: word.count,
      rank: word.rank,
      locale: word.locale,
      fontSize: 12,
      angle: 0,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      color: template.color,
      status: "unplaceable",
      reason: "no-fit",
    })),
  };
  return createSnapshot(wordSet, snapshotStyle, scene);
}

describe("ScenePack large snapshot stress", () => {
  it("shrinks a maximum-words high-entropy cloud and keeps it in a .wc file", () => {
    const snapshot = largeSnapshot();
    const legacy = encodeLegacyJsonFragment(
      snapshot,
      LIMITS.maxSnapshotFileBytes,
    );
    const encoded = encodeSnapshotPayload(
      snapshot,
      LIMITS.maxSnapshotFileBytes,
    );

    expect(encoded.fragment).toMatch(/^#wc-pako:v1:/u);
    expect(utf8ByteLength(encoded.fragment)).toBeGreaterThan(
      LIMITS.maxEncodedFragmentBytes,
    );
    expect(encoded.fragment.length).toBeLessThan(legacy.fragment.length * 0.7);
    expect(encoded.jsonBytes).toBeLessThan(LIMITS.maxInflatedJsonBytes);
    expect(
      decodeSnapshotFragment(encoded.fragment, LIMITS.maxSnapshotFileBytes),
    ).toEqual(snapshot);

    const file = encodeSnapshotFile(
      snapshot.wordSet,
      snapshot.presentation,
      snapshot.scene,
    );
    expect(file.byteLength).toBeLessThanOrEqual(LIMITS.maxSnapshotFileBytes);
    expect(decodeSnapshotFile(file)).toEqual(snapshot);
  });
});
