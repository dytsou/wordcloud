import {
  mapFrequency,
  rotationCandidates,
  type LayoutStyle,
} from "../core/layout";
import { padGlyph } from "../core/glyph-grid";
import type { FontMetricsTable } from "../core/metrics";
import type { WordSet } from "../core/types";
import { LIMITS } from "../core/limits";

/** Rasterize on the main thread, where the actual web fonts have been loaded. */
export async function createGlyphSprites(
  wordSet: WordSet,
  style: LayoutStyle,
  shouldCancel: () => boolean,
): Promise<FontMetricsTable["sprites"]> {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  const sprites: NonNullable<FontMetricsTable["sprites"]> = Object.create(null);
  const counts = wordSet.words.map((word) => word.count);
  const minimum = Math.min(...counts);
  const maximum = Math.max(...counts);
  const padding = Math.max(
    LIMITS.minPadding,
    Math.min(LIMITS.maxPadding, style.padding),
  );
  let totalPixels = 0;
  for (const [index, word] of wordSet.words.entries()) {
    if (shouldCancel()) throw new Error("排版已取消");
    const fontSize = mapFrequency(
      word.count,
      minimum,
      maximum,
      style.scale,
      style.minFontSize,
      style.maxFontSize,
    );
    const font = `500 ${fontSize}px ${style.fontFamily}`;
    context.font = font;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const measured = context.measureText(word.term);
    context.textBaseline = "alphabetic";
    const alphabetic = context.measureText(word.term);
    const svgBaseline =
      (alphabetic.fontBoundingBoxAscent - alphabetic.fontBoundingBoxDescent) /
      2;
    if (!Number.isFinite(svgBaseline)) return undefined;
    const halfWidth = Math.max(
      Math.abs(measured.actualBoundingBoxLeft),
      Math.abs(measured.actualBoundingBoxRight),
      measured.width / 2,
    );
    const halfHeight = Math.max(
      Math.abs(measured.actualBoundingBoxAscent),
      Math.abs(measured.actualBoundingBoxDescent),
      Math.abs(alphabetic.actualBoundingBoxAscent - svgBaseline),
      Math.abs(alphabetic.actualBoundingBoxDescent + svgBaseline),
      fontSize / 2,
    );
    const range = Math.max(0, style.maxFontSize - style.minFontSize);
    const eligible =
      range === 0
        ? word.rank > Math.ceil(wordSet.words.length * 0.6)
        : fontSize <= style.minFontSize + range * 0.42;
    const variants: NonNullable<FontMetricsTable["sprites"]>[string] = {};
    for (const angle of rotationCandidates(style.rotations, eligible)) {
      const radians = (angle * Math.PI) / 180;
      const cosine = Math.abs(Math.cos(radians));
      const sine = Math.abs(Math.sin(radians));
      const margin = Math.max(0, Math.ceil(padding)) + 2;
      const width = Math.ceil(
        2 * (halfWidth * cosine + halfHeight * sine + margin),
      );
      const height = Math.ceil(
        2 * (halfWidth * sine + halfHeight * cosine + margin),
      );
      if (width > style.canvas.width || height > style.canvas.height) {
        variants[angle] = { width, height, pixels: new Uint32Array() };
        continue;
      }
      totalPixels += width * height;
      // Fall back as one complete set rather than mixing incompatible collision models.
      if (totalPixels > 32_000_000) return undefined;
      canvas.width = width;
      canvas.height = height;
      context.translate(width / 2, height / 2);
      context.rotate(radians);
      context.font = font;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(word.term, 0, 0);
      // SVG central and Canvas middle baselines differ between font profiles.
      // Reserve the union so both preview/SVG and PNG strokes remain protected.
      context.textBaseline = "alphabetic";
      context.fillText(word.term, 0, svgBaseline);
      const rgba = context.getImageData(0, 0, width, height).data;
      const alpha = new Uint8Array(width * height);
      for (let pixel = 0; pixel < alpha.length; pixel++)
        alpha[pixel] = rgba[pixel * 4 + 3] > 0 ? 1 : 0;
      // One pixel of raster tolerance at non-negative spacing protects antialiased edges.
      variants[angle] = {
        width,
        height,
        pixels: padGlyph(
          alpha,
          width,
          height,
          padding >= 0 ? padding + 1 : padding,
        ),
      };
    }
    sprites[word.term] = variants;
    if (index % 8 === 7)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return sprites;
}
