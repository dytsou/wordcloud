import { describe, expect, it } from "vitest";
import {
  detectForeground,
  paintSeeds,
  segmentSubject,
} from "../../src/core/image-segmentation";
import type { RasterImage } from "../../src/core/image-shape";

type Pixel = readonly [red: number, green: number, blue: number, alpha: number];

function rasterFromPixels(rows: readonly (readonly Pixel[])[]): RasterImage {
  const height = rows.length;
  const width = rows[0].length;
  const rgba = new Uint8ClampedArray(width * height * 4);

  rows.forEach((row, y) =>
    row.forEach((pixel, x) => rgba.set(pixel, (y * width + x) * 4)),
  );

  return { width, height, rgba };
}

function maskRows(mask: Uint8Array, width: number): string[] {
  return Array.from({ length: mask.length / width }, (_, y) =>
    Array.from(mask.subarray(y * width, (y + 1) * width)).join(""),
  );
}

describe("uploaded-image foreground segmentation", () => {
  it("keeps visible pixels and excludes transparent pixels by alpha", () => {
    const opaqueRed: Pixel = [220, 40, 40, 255];
    const semiTransparent: Pixel = [40, 180, 80, 128];
    const faint: Pixel = [20, 30, 40, 15];
    const transparent: Pixel = [0, 0, 0, 0];
    const barelyVisible: Pixel = [80, 90, 100, 16];
    const mostlyTransparent: Pixel = [80, 90, 100, 249];
    const raster = rasterFromPixels([
      [transparent, opaqueRed, faint],
      [semiTransparent, transparent, opaqueRed],
      [barelyVisible, transparent, mostlyTransparent],
    ]);

    expect(maskRows(detectForeground(raster), raster.width)).toEqual([
      "010",
      "101",
      "101",
    ]);
  });

  it("keeps enclosed background unless hole removal is enabled", () => {
    const white: Pixel = [255, 255, 255, 255];
    const black: Pixel = [0, 0, 0, 255];
    const rows: Pixel[][] = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => white),
    );
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) {
        if (x !== 2 || y !== 2) rows[y][x] = black;
      }
    }
    const raster = rasterFromPixels(rows);

    expect(maskRows(detectForeground(raster, 24, false), raster.width)).toEqual(
      ["00000", "01110", "01110", "01110", "00000"],
    );
    expect(maskRows(detectForeground(raster, 24, true), raster.width)).toEqual([
      "00000",
      "01110",
      "01010",
      "01110",
      "00000",
    ]);
  });

  it("uses the selected tolerance for pixels close to the border color", () => {
    const white: Pixel = [255, 255, 255, 255];
    const nearWhite: Pixel = [237, 237, 237, 255];
    const rows: Pixel[][] = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => white),
    );
    rows[2][2] = nearWhite;
    const raster = rasterFromPixels(rows);

    expect(maskRows(detectForeground(raster, 24), raster.width)).toEqual([
      "00000",
      "00000",
      "00000",
      "00000",
      "00000",
    ]);
    expect(maskRows(detectForeground(raster, 8), raster.width)).toEqual([
      "00000",
      "00000",
      "00100",
      "00000",
      "00000",
    ]);
  });

  it("preserves exact foreground and background marks in the segmented mask", () => {
    const emptySeeds = new Int8Array(25);
    const keepSeeds = paintSeeds(emptySeeds, 5, 5, {
      points: [{ x: 2, y: 2 }],
      radius: 0.5,
      mode: "keep",
    });
    const seeds = paintSeeds(keepSeeds, 5, 5, {
      points: [{ x: 3, y: 2 }],
      radius: 0.5,
      mode: "remove",
    });
    const raster = rasterFromPixels(
      Array.from({ length: 5 }, (_, y) =>
        Array.from({ length: 5 }, (_, x) => {
          if (y === 2 && x === 2) return [220, 40, 40, 255] as const;
          if (y === 2 && x === 3) return [30, 30, 30, 255] as const;
          return [0, 0, 0, 0] as const;
        }),
      ),
    );

    expect(Array.from(seeds)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0,
    ]);
    expect(maskRows(segmentSubject(raster, { seeds }), raster.width)).toEqual([
      "00000",
      "00000",
      "00100",
      "00000",
      "00000",
    ]);
  });
});
