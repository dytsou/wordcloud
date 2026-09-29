import {
  mapFrequency,
  rotationCandidates,
  type LayoutStyle,
} from "../core/layout";
import { glyphInkSpans, padGlyph } from "../core/glyph-grid";
import type { FontMetricsTable, GlyphSprite } from "../core/metrics";
import type { WordSet } from "../core/types";
import { LIMITS } from "../core/limits";

interface GlyphMeasurement {
  fontSize: number;
  font: string;
  svgBaseline: number;
  halfWidth: number;
  halfHeight: number;
}

interface RenderedGlyphSprite {
  sprite: GlyphSprite;
  pixelCost: number;
}

interface GlyphSpriteRenderOptions {
  term: string;
  angle: number;
  measurement: GlyphMeasurement;
  style: LayoutStyle;
  padding: number;
  totalPixels: number;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
}

function measureGlyph(
  term: string,
  fontSize: number,
  fontFamily: string,
  context: CanvasRenderingContext2D,
): GlyphMeasurement | undefined {
  const font = "500 " + fontSize + "px " + fontFamily;
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const measured = context.measureText(term);
  context.textBaseline = "alphabetic";
  const alphabetic = context.measureText(term);
  const svgBaseline =
    (alphabetic.fontBoundingBoxAscent - alphabetic.fontBoundingBoxDescent) / 2;
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
  return { fontSize, font, svgBaseline, halfWidth, halfHeight };
}

function rotationEligible(
  rank: number,
  wordCount: number,
  fontSize: number,
  style: LayoutStyle,
): boolean {
  const range = Math.max(0, style.maxFontSize - style.minFontSize);
  if (range === 0) return rank > Math.ceil(wordCount * 0.6);
  return fontSize <= style.minFontSize + range * 0.42;
}

function renderGlyphSprite({
  term,
  angle,
  measurement,
  style,
  padding,
  totalPixels,
  canvas,
  context,
}: GlyphSpriteRenderOptions): RenderedGlyphSprite | undefined {
  const radians = (angle * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const margin = Math.max(0, Math.ceil(padding)) + 2;
  const width = Math.ceil(
    2 *
      (measurement.halfWidth * cosine + measurement.halfHeight * sine + margin),
  );
  const height = Math.ceil(
    2 *
      (measurement.halfWidth * sine + measurement.halfHeight * cosine + margin),
  );
  if (width > style.canvas.width || height > style.canvas.height) {
    return {
      sprite: { width, height, pixels: new Uint32Array() },
      pixelCost: 0,
    };
  }
  const rasterPixels = width * height;
  if (totalPixels + rasterPixels > LIMITS.maxGlyphSpritePixels)
    return undefined;

  canvas.width = width;
  canvas.height = height;
  context.translate(width / 2, height / 2);
  context.rotate(radians);
  context.font = measurement.font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(term, 0, 0);
  context.textBaseline = "alphabetic";
  context.fillText(term, 0, measurement.svgBaseline);
  const rgba = context.getImageData(0, 0, width, height).data;
  const alpha = new Uint8Array(width * height);
  for (let pixel = 0; pixel < alpha.length; pixel++) {
    alpha[pixel] = rgba[pixel * 4 + 3] > 0 ? 1 : 0;
  }
  const inkSpans = style.shape
    ? glyphInkSpans(alpha, width, height)
    : undefined;
  const pixels = padGlyph(
    alpha,
    width,
    height,
    padding >= 0 ? padding + 1 : padding,
  );
  const shapePixels = style.shape ? pixels.length + (inkSpans?.length ?? 0) : 0;
  if (totalPixels + rasterPixels + shapePixels > LIMITS.maxGlyphSpritePixels)
    return undefined;
  return {
    sprite: { width, height, pixels, inkSpans },
    pixelCost: rasterPixels + shapePixels,
  };
}

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
    if (shouldCancel()) throw new Error("Layout was cancelled.");
    const fontSize = mapFrequency(
      word.count,
      minimum,
      maximum,
      style.scale,
      style.minFontSize,
      style.maxFontSize,
    );
    const measurement = measureGlyph(
      word.term,
      fontSize,
      style.fontFamily,
      context,
    );
    if (!measurement) return undefined;
    const eligible = rotationEligible(
      word.rank,
      wordSet.words.length,
      fontSize,
      style,
    );
    const variants: NonNullable<FontMetricsTable["sprites"]>[string] = {};
    for (const angle of rotationCandidates(style.rotations, eligible)) {
      const rendered = renderGlyphSprite({
        term: word.term,
        angle,
        measurement,
        style,
        padding,
        totalPixels,
        canvas,
        context,
      });
      if (!rendered) return undefined;
      variants[angle] = rendered.sprite;
      totalPixels += rendered.pixelCost;
    }
    sprites[word.term] = variants;
    if (index % 8 === 7)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return sprites;
}
