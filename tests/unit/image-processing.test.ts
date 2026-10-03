import { describe, expect, it } from "vitest";
import { inspectImageBytes } from "../../src/app/image-processing";
import { IMAGE_SHAPE_LIMITS } from "../../src/core/image-shape";

function markerOnlyJpegAtUploadLimit(): Uint8Array {
  const bytes = new Uint8Array(IMAGE_SHAPE_LIMITS.maxUploadBytes);
  bytes.set([0xff, 0xd8]);

  const markerBlock = new Uint8Array(4096);
  for (let index = 0; index < markerBlock.length; index += 2) {
    markerBlock[index] = 0xff;
    markerBlock[index + 1] = 0x01;
  }
  for (let offset = 2; offset < bytes.length; offset += markerBlock.length) {
    const end = Math.min(offset + markerBlock.length, bytes.length);
    bytes.set(markerBlock.subarray(0, end - offset), offset);
  }

  return bytes;
}

describe("uploaded image header inspection", () => {
  it("accepts a JPEG with metadata and a supported frame header", () => {
    const bytes = Uint8Array.from([
      0xff,
      0xd8, // SOI
      0xff,
      0xe0,
      0x00,
      0x04,
      0x12,
      0x34, // APP0
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x10,
      0x00,
      0x20,
      0x01,
      0x01,
      0x11,
      0x00, // SOF0
    ]);

    expect(inspectImageBytes(bytes)).toEqual({
      type: "image/jpeg",
      width: 32,
      height: 16,
    });
  });

  it("rejects restart markers before the scan header", () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd0]);

    expect(() => inspectImageBytes(bytes)).toThrow(
      "Invalid JPEG restart marker before scan.",
    );
  });

  it("bounds marker-only JPEG header work at the upload limit", () => {
    const bytes = markerOnlyJpegAtUploadLimit();

    expect(bytes).toHaveLength(IMAGE_SHAPE_LIMITS.maxUploadBytes);
    expect(() => inspectImageBytes(bytes)).toThrow(
      "JPEG image header contains too many markers.",
    );
  });
});
