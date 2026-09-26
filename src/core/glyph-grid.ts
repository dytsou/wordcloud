import type { GlyphSprite } from "./metrics";

/** Pixel occupancy preserves the empty spaces inside glyphs, unlike word boxes. */
export class GlyphGrid {
  private readonly occupied: Uint32Array;
  private readonly stride: number;
  private readonly masks = new WeakMap<
    GlyphSprite,
    { offsets: Uint32Array; bits: Uint32Array }
  >();

  constructor(width: number, height: number) {
    this.stride = Math.ceil(width / 32);
    this.occupied = new Uint32Array(this.stride * height);
  }

  private mask(sprite: GlyphSprite) {
    const cached = this.masks.get(sprite);
    if (cached) return cached;
    const stride = Math.ceil(sprite.width / 32);
    const packed = new Uint32Array(stride * sprite.height);
    for (const pixel of sprite.pixels) {
      const x = pixel % sprite.width;
      packed[Math.floor(pixel / sprite.width) * stride + (x >>> 5)] |=
        1 << (x & 31);
    }
    const offsets: number[] = [];
    const bits: number[] = [];
    for (let i = 0; i < packed.length; i++) {
      if (!packed[i]) continue;
      offsets.push(Math.floor(i / stride) * this.stride + (i % stride));
      bits.push(packed[i]);
    }
    const result = {
      offsets: Uint32Array.from(offsets),
      bits: Uint32Array.from(bits),
    };
    this.masks.set(sprite, result);
    return result;
  }

  collides(sprite: GlyphSprite, x: number, y: number): boolean {
    const mask = this.mask(sprite);
    const origin = y * this.stride + (x >>> 5);
    const shift = x & 31;
    for (let i = 0; i < mask.bits.length; i++) {
      const index = origin + mask.offsets[i];
      const bits = mask.bits[i];
      if (
        this.occupied[index] & (bits << shift) ||
        (shift !== 0 && this.occupied[index + 1] & (bits >>> (32 - shift)))
      )
        return true;
    }
    return false;
  }

  add(sprite: GlyphSprite, x: number, y: number): void {
    const mask = this.mask(sprite);
    const origin = y * this.stride + (x >>> 5);
    const shift = x & 31;
    for (let i = 0; i < mask.bits.length; i++) {
      const index = origin + mask.offsets[i];
      const bits = mask.bits[i];
      this.occupied[index] |= bits << shift;
      if (shift !== 0) this.occupied[index + 1] |= bits >>> (32 - shift);
    }
  }
}

/** Encodes contiguous, unpadded alpha runs as compact [row, start, end) triples. */
export function glyphInkSpans(
  alpha: Uint8Array,
  width: number,
  height: number,
): Uint16Array {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 65_535 ||
    height > 65_535 ||
    alpha.length !== width * height
  ) {
    throw new RangeError("Glyph dimensions must match a 16-bit alpha raster");
  }

  const spans: number[] = [];
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      while (x < width && !alpha[y * width + x]) x++;
      if (x >= width) break;
      const start = x;
      while (x < width && alpha[y * width + x]) x++;
      spans.push(y, start, x);
    }
  }
  return Uint16Array.from(spans);
}

/** Square dilation/erosion via a summed-area table, bounded independently of radius. */
export function padGlyph(
  alpha: Uint8Array,
  width: number,
  height: number,
  padding: number,
): Uint32Array {
  const radius = Math.ceil(Math.abs(padding));
  const stride = width + 1;
  const sums = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += alpha[y * width + x] ? 1 : 0;
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  const pixels: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height, y + radius + 1);
      const sum =
        sums[bottom * stride + right] -
        sums[top * stride + right] -
        sums[bottom * stride + left] +
        sums[top * stride + left];
      if (padding >= 0 ? sum > 0 : sum === (radius * 2 + 1) ** 2)
        pixels.push(y * width + x);
    }
  }
  return Uint32Array.from(pixels);
}
