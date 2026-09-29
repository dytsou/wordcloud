import { describe, expect, it } from "vitest";
import { encodeJsonFragment } from "../../src/core/codec";
import { decodeSnapshotFragment } from "../../src/core/snapshot";
import { renderSceneSvg } from "../../src/render/svg";
import {
  encodeHostileSnapshot,
  hostileSnapshotCases,
  validSnapshot,
  withMutation,
} from "../fixtures/hostile-snapshots";

describe("hostile snapshot corpus", () => {
  it.each(hostileSnapshotCases)("rejects $name atomically", ({ payload }) => {
    const fragment = encodeHostileSnapshot(payload);
    expect(() => decodeSnapshotFragment(fragment)).toThrow();
  });

  it("rejects an inflated payload before an attacker-sized object is returned", () => {
    const fragment = encodeJsonFragment({
      payload: "x".repeat(100_000),
    }).fragment;
    expect(() => decodeSnapshotFragment(fragment)).toThrow(
      /snapshot|schema|inflate|decompress|JSON/iu,
    );
  });

  it("does not execute XML-looking terms at the renderer boundary", () => {
    const term = `<img src=x onerror="alert(1)">`;
    const snapshot = withMutation((candidate) => {
      candidate.wordSet.words[0].term = term;
      candidate.scene.words[0].term = term;
    });
    const decoded = decodeSnapshotFragment(encodeHostileSnapshot(snapshot));
    const svg = renderSceneSvg(decoded.scene);

    expect(svg).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(svg).not.toContain("<img");
    expect(svg).not.toMatch(
      /<script\b|<img\b|<[^>]*\bon[a-z]+\s*=|foreignObject|url\(/iu,
    );
  });

  it("rejects malformed and truncated fragments without partial state", () => {
    expect(() => decodeSnapshotFragment("#wc-pako:v1:not-valid!!")).toThrow();
    expect(() =>
      decodeSnapshotFragment(validSnapshotFragment().slice(0, -3)),
    ).toThrow();
  });
});

function validSnapshotFragment(): string {
  return encodeHostileSnapshot(validSnapshot);
}
