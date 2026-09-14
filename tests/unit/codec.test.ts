import { describe, expect, it } from "vitest";
import { deflate } from "pako";
import {
  decodeJsonFragment,
  encodeJsonFragment,
  SNAPSHOT_PREFIX,
} from "../../src/core/codec";
import { LIMITS } from "../../src/core/limits";

describe("wc-pako codec", () => {
  it("round-trips canonical JSON using the fixed prefix and URL-safe Base64", () => {
    const encoded = encodeJsonFragment({ z: "最後", a: [1, true] });

    expect(encoded.fragment.startsWith(SNAPSHOT_PREFIX)).toBe(true);
    expect(encoded.fragment).toMatch(/^#wc-pako:v1:[A-Za-z0-9_-]+$/);
    expect(decodeJsonFragment(encoded.fragment)).toEqual({
      a: [1, true],
      z: "最後",
    });
  });

  it("rejects malformed, noncanonical, and oversized payloads", () => {
    expect(() => decodeJsonFragment("#wc-pako:v2:abc")).toThrow(
      /prefix|version/i,
    );
    expect(() => decodeJsonFragment(`${SNAPSHOT_PREFIX}a`)).toThrow(/Base64/i);
    expect(() => decodeJsonFragment(`${SNAPSHOT_PREFIX}e30`)).toThrow(
      /canonical|JSON|inflate/i,
    );

    const oversized = "a".repeat(LIMITS.maxEncodedFragmentBytes);
    expect(() => decodeJsonFragment(`${SNAPSHOT_PREFIX}${oversized}`)).toThrow(
      /size|large|上限/i,
    );
  });

  it("terminates decompression when the inflated bytes or ratio exceed the cap", () => {
    const json = JSON.stringify("x".repeat(LIMITS.maxInflatedJsonBytes + 1));
    const compressed = deflate(new TextEncoder().encode(json), { level: 9 });
    const bytes = Buffer.from(compressed).toString("base64url");
    expect(() => decodeJsonFragment(`${SNAPSHOT_PREFIX}${bytes}`)).toThrow(
      /inflate|decompress|大小|ratio/i,
    );
  });
});
