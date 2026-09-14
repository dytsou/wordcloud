import { describe, expect, it } from "vitest";
import { encodeJsonFragment } from "../../src/core/codec";
import {
  decodeSnapshotFragment,
  encodeSnapshot,
} from "../../src/core/snapshot";
import {
  snapshotScene,
  snapshotStyle,
  snapshotWordSet,
} from "../fixtures/snapshots";

const valid = () =>
  encodeSnapshot(snapshotWordSet, snapshotStyle, snapshotScene).fragment;

describe("snapshot validation", () => {
  it("round-trips derived terms without source text or rule bodies", () => {
    const fragment = valid();
    const snapshot = decodeSnapshotFragment(fragment);
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.wordSet).toEqual(snapshotWordSet);
    expect(serialized).not.toContain("sourceText");
    expect(serialized).not.toContain("protected phrase");
  });

  it("rejects unallowlisted styles and scene records atomically", () => {
    const fragment = valid();
    const snapshot = decodeSnapshotFragment(fragment);
    snapshot.presentation.fontFamily = "url(https://evil.example/font)";
    const tampered = encodeJsonFragment(snapshot).fragment;

    expect(() => decodeSnapshotFragment(tampered)).toThrow(/font|style|allow/i);
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
});
