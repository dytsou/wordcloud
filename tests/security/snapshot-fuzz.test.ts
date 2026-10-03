import { zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SNAPSHOT_PREFIX } from "../../src/core/codec";
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
    // Bypass the safe encoder to simulate an attacker-crafted compressed payload.
    const compressed = zlibSync(
      new TextEncoder().encode(
        JSON.stringify(["wc-scene-pack", { payload: "x".repeat(100_000) }]),
      ),
    );
    const fragment = `${SNAPSHOT_PREFIX}${Buffer.from(compressed).toString("base64url")}`;
    expect(() => decodeSnapshotFragment(fragment)).toThrow(
      /ScenePack|snapshot|schema|inflate|decompress|JSON/iu,
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
