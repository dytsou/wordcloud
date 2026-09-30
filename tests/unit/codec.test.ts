import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { zlibSync } from "fflate";
import {
  decodeLegacyJsonFragment,
  decodeScenePackFragment,
  encodeLegacyJsonFragment,
  encodeScenePackFragment,
  SNAPSHOT_PREFIX,
} from "../../src/core/codec";
import { LIMITS } from "../../src/core/limits";

describe("snapshot codec", () => {
  it("round-trips ScenePack canonical JSON using URL-safe Base64", () => {
    const value = ["wc-scene-pack", { z: "最後", a: [1, true] }];
    const encoded = encodeScenePackFragment(value);

    expect(encoded.fragment.startsWith(SNAPSHOT_PREFIX)).toBe(true);
    expect(encoded.fragment).toMatch(/^#wc-pako:v1:[A-Za-z0-9_-]+$/);
    expect(decodeScenePackFragment(encoded.fragment)).toEqual(value);
  });

  it("reads legacy V1 zlib fragments and rejects a damaged checksum", () => {
    const json = new TextEncoder().encode('{"a":[1,true],"z":"最後"}');
    const legacyCompressed = deflateSync(json);
    const legacyFragment = `${SNAPSHOT_PREFIX}${legacyCompressed.toString("base64url")}`;
    expect(decodeLegacyJsonFragment(legacyFragment)).toEqual({
      a: [1, true],
      z: "最後",
    });

    const damagedCompressed = zlibSync(json).slice();
    damagedCompressed[damagedCompressed.byteLength - 1] =
      damagedCompressed[damagedCompressed.byteLength - 1]! ^ 1;
    const damagedFragment = `${SNAPSHOT_PREFIX}${Buffer.from(damagedCompressed).toString("base64url")}`;
    expect(() => decodeLegacyJsonFragment(damagedFragment)).toThrow(
      /checksum|inflate/i,
    );
  });

  it("rejects malformed, noncanonical, and oversized payloads", () => {
    expect(() => decodeLegacyJsonFragment("#wc-pack:abc")).toThrow(
      /prefix|version/i,
    );
    expect(() => decodeLegacyJsonFragment(`${SNAPSHOT_PREFIX}a`)).toThrow(
      /Base64/i,
    );
    expect(() => decodeLegacyJsonFragment(`${SNAPSHOT_PREFIX}e30`)).toThrow(
      /canonical|JSON|inflate|decompress/i,
    );

    const oversized = "a".repeat(LIMITS.maxEncodedFragmentBytes);
    expect(() =>
      decodeLegacyJsonFragment(`${SNAPSHOT_PREFIX}${oversized}`),
    ).toThrow(/exceeds|size|large/i);
  });

  it("terminates decompression when the inflated bytes or ratio exceed the cap", () => {
    const json = JSON.stringify("x".repeat(LIMITS.maxInflatedJsonBytes + 1));
    const compressed = zlibSync(new TextEncoder().encode(json), { level: 9 });
    const bytes = Buffer.from(compressed).toString("base64url");
    expect(() =>
      decodeLegacyJsonFragment(`${SNAPSHOT_PREFIX}${bytes}`),
    ).toThrow(/inflate|decompress|size|ratio/i);
  });
});
