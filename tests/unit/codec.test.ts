import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { zlibSync } from "fflate";
import {
  buildShareUrl,
  decodeScenePackFragment,
  encodeScenePackFragment,
  SNAPSHOT_PREFIX,
} from "../../src/core/codec";
import { LIMITS } from "../../src/core/limits";

describe("snapshot codec", () => {
  it("round-trips ScenePack canonical JSON using URL-safe Base64", () => {
    const value = ["wc-scene-pack", { z: "最後", a: [1, true] }];
    const encoded = encodeScenePackFragment(value);

    expect(encoded.fragment.startsWith(SNAPSHOT_PREFIX)).toBe(true);
    expect(encoded.fragment).toMatch(/^#wc-pako:v2:[A-Za-z0-9_-]+$/);
    expect(decodeScenePackFragment(encoded.fragment)).toEqual(value);
  });

  it("reads zlib fragments with the v2 marker and rejects a damaged checksum", () => {
    const json = new TextEncoder().encode('{"a":[1,true],"z":"最後"}');
    const compressed = deflateSync(json);
    const fragment = `${SNAPSHOT_PREFIX}${compressed.toString("base64url")}`;
    expect(decodeScenePackFragment(fragment)).toEqual({
      a: [1, true],
      z: "最後",
    });

    const damagedCompressed = zlibSync(json).slice();
    damagedCompressed[damagedCompressed.byteLength - 1] =
      damagedCompressed[damagedCompressed.byteLength - 1]! ^ 1;
    const damagedFragment = `${SNAPSHOT_PREFIX}${Buffer.from(damagedCompressed).toString("base64url")}`;
    expect(() => decodeScenePackFragment(damagedFragment)).toThrow(
      /checksum|inflate/i,
    );
  });

  it("rejects V1 fragments after the ScenePack format upgrade", () => {
    const fragment = encodeScenePackFragment(["wc-scene-pack", {}]).fragment;
    const v1Fragment = fragment.replace(SNAPSHOT_PREFIX, "#wc-pako:v1:");

    expect(() => decodeScenePackFragment(v1Fragment)).toThrow(
      /prefix|version/i,
    );
  });

  it("versions share URLs so a new codec loads the matching app build", () => {
    const fragment = `${SNAPSHOT_PREFIX}payload`;
    const shareUrl = new URL(
      buildShareUrl("https://wordcloud.example/view?campaign=test", fragment),
    );

    expect(shareUrl.searchParams.get("campaign")).toBe("test");
    expect(shareUrl.searchParams.get("wc-codec")).toBe("wc-pako-v2");
    expect(shareUrl.hash).toBe(fragment);
  });

  it("rejects malformed, noncanonical, and oversized payloads", () => {
    expect(() => decodeScenePackFragment("#wc-pack:abc")).toThrow(
      /prefix|version/i,
    );
    expect(() => decodeScenePackFragment(`${SNAPSHOT_PREFIX}a`)).toThrow(
      /Base64/i,
    );
    expect(() => decodeScenePackFragment(`${SNAPSHOT_PREFIX}e30`)).toThrow(
      /canonical|JSON|inflate|decompress/i,
    );

    const oversized = "a".repeat(LIMITS.maxEncodedFragmentBytes);
    expect(() =>
      decodeScenePackFragment(`${SNAPSHOT_PREFIX}${oversized}`),
    ).toThrow(/exceeds|size|large/i);
  });

  it("terminates decompression when the inflated bytes or ratio exceed the cap", () => {
    const json = JSON.stringify("x".repeat(LIMITS.maxInflatedJsonBytes + 1));
    const compressed = zlibSync(new TextEncoder().encode(json), { level: 9 });
    const bytes = Buffer.from(compressed).toString("base64url");
    expect(() => decodeScenePackFragment(`${SNAPSHOT_PREFIX}${bytes}`)).toThrow(
      /inflate|decompress|size|ratio/i,
    );
  });
});
