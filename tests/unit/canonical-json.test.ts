import { describe, expect, it } from "vitest";
import {
  canonicalStringify,
  parseStrictJson,
} from "../../src/core/canonical-json";

describe("canonical JSON", () => {
  it("sorts object keys while preserving array order", () => {
    expect(canonicalStringify({ z: 1, a: { y: true, x: [2, 1] } })).toBe(
      '{"a":{"x":[2,1],"y":true},"z":1}',
    );
  });

  it("rejects duplicate keys, trailing data, and nonfinite values", () => {
    expect(() => parseStrictJson('{"x":1,"x":2}')).toThrow(/duplicate/i);
    expect(() => parseStrictJson("{} garbage")).toThrow(/trailing/i);
    expect(() => canonicalStringify({ value: Number.NaN })).toThrow(/finite/i);
  });
});
