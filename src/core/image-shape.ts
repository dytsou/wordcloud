/** Portable, bounded foreground rasters. Index zero never contains foreground. */
export const IMAGE_SHAPE_LIMITS = Object.freeze({
  maxDimension: 192,
  maxPixels: 192 * 192,
  maxPaletteColors: 96,
  maxUploadBytes: 8 * 1024 * 1024,
  maxSourcePixels: 16_000_000,
});

export interface RasterImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface UploadedShapeImage {
  version: 1;
  width: number;
  height: number;
  palette: string[];
  encoding: "raw" | "rle";
  pixels: string;
}

export interface UploadedShapeSettings {
  id: "uploaded";
  widthScale: number;
  heightScale: number;
  image: UploadedShapeImage;
  colorMode: "original" | "readable" | "palette";
  colorBoundary: boolean;
}

export interface ImageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Ink spans are offsets from the occupied rectangle, with an exclusive end. */
export interface ImageInkSpan {
  y: number;
  start: number;
  end: number;
}

export interface UploadedColorSample {
  color: string;
  variance: number;
  samples: number;
}

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const HEX_COLOR = /^#[\da-f]{6}$/i;
interface CachedImage {
  fingerprint: string;
  encodedPixels: string;
  pixels: Uint8Array;
  colors: number[][];
  path?: string;
}
const imageCache = new WeakMap<UploadedShapeImage, CachedImage>();

function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Uploaded image must be an object.");
  }
  const result = value as Record<string, unknown>;
  const allowed = new Set(keys);
  if (
    Object.keys(result).length !== keys.length ||
    Object.keys(result).some((key) => !allowed.has(key))
  ) {
    throw new TypeError(
      "Uploaded image contains missing or unsupported fields.",
    );
  }
  return result;
}

function imageDimension(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > IMAGE_SHAPE_LIMITS.maxDimension
  ) {
    throw new RangeError(
      "Uploaded image dimensions exceed the supported limit.",
    );
  }
  return value;
}

export function validateRasterImage(raster: RasterImage): void {
  const width = imageDimension(raster.width);
  const height = imageDimension(raster.height);
  if (
    !(raster.rgba instanceof Uint8ClampedArray) ||
    raster.rgba.length !== width * height * 4
  ) {
    throw new TypeError("Image pixel data does not match its dimensions.");
  }
}

export function encodeImageBytes(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const value =
      (bytes[offset] << 16) |
      ((bytes[offset + 1] ?? 0) << 8) |
      (bytes[offset + 2] ?? 0);
    chunks.push(
      BASE64[(value >>> 18) & 63] +
        BASE64[(value >>> 12) & 63] +
        (offset + 1 < bytes.length ? BASE64[(value >>> 6) & 63] : "=") +
        (offset + 2 < bytes.length ? BASE64[value & 63] : "="),
    );
  }
  return chunks.join("");
}

export function decodeImageBytes(value: string, maximum: number): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > Math.ceil(maximum / 3) * 4 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(value)
  ) {
    throw new TypeError(
      "Uploaded image pixels must use bounded canonical base64.",
    );
  }
  const padding = value.endsWith("==") ? 2 : Number(value.endsWith("="));
  const bytes = new Uint8Array((value.length / 4) * 3 - padding);
  if (bytes.length > maximum) {
    throw new RangeError(
      "Uploaded image pixel data exceeds the supported limit.",
    );
  }
  for (let offset = 0, target = 0; offset < value.length; offset += 4) {
    const combined =
      (BASE64.indexOf(value[offset]) << 18) |
      (BASE64.indexOf(value[offset + 1]) << 12) |
      (Math.max(0, BASE64.indexOf(value[offset + 2])) << 6) |
      Math.max(0, BASE64.indexOf(value[offset + 3]));
    bytes[target++] = combined >>> 16;
    if (target < bytes.length) bytes[target++] = combined >>> 8;
    if (target < bytes.length) bytes[target++] = combined;
  }
  if (encodeImageBytes(bytes) !== value) {
    throw new TypeError("Uploaded image pixels must use canonical base64.");
  }
  return bytes;
}

function unpackPixels(image: UploadedShapeImage): Uint8Array {
  const area = image.width * image.height;
  const encoded = decodeImageBytes(image.pixels, area);
  const pixels = new Uint8Array(area);
  if (image.encoding === "raw") {
    if (encoded.length !== area) {
      throw new RangeError(
        "Uploaded image pixels do not match its dimensions.",
      );
    }
    pixels.set(encoded);
  } else {
    if (encoded.length % 3 !== 0) {
      throw new RangeError("Uploaded image runs are incomplete.");
    }
    let cursor = 0;
    for (let offset = 0; offset < encoded.length; offset += 3) {
      const count = encoded[offset] | (encoded[offset + 1] << 8);
      if (count === 0 || cursor + count > area) {
        throw new RangeError("Uploaded image runs exceed its dimensions.");
      }
      pixels.fill(encoded[offset + 2], cursor, cursor + count);
      cursor += count;
    }
    if (cursor !== area) {
      throw new RangeError("Uploaded image runs do not match its dimensions.");
    }
  }
  if (pixels.some((pixel) => pixel > image.palette.length)) {
    throw new RangeError("Uploaded image pixels reference an unknown color.");
  }
  if (!pixels.some((pixel) => pixel > 0)) {
    throw new RangeError("Uploaded image must contain some foreground pixels.");
  }
  return pixels;
}

export function validateUploadedShapeImage(value: unknown): UploadedShapeImage {
  assertImageHeader(value);
  const input = value;
  const image: UploadedShapeImage = {
    version: 1,
    width: input.width,
    height: input.height,
    palette: input.palette.map((color) => color.toLowerCase()),
    encoding: input.encoding,
    pixels: input.pixels,
  };
  cacheImage(image, unpackPixels(image));
  return image;
}

function uploadedShapeSettingsRecord(value: unknown) {
  const input = record(value, [
    "id",
    "widthScale",
    "heightScale",
    "image",
    "colorMode",
    "colorBoundary",
  ]);
  if (input.id !== "uploaded") {
    throw new TypeError("Unsupported uploaded image shape.");
  }
  for (const key of ["widthScale", "heightScale"] as const) {
    if (
      typeof input[key] !== "number" ||
      !Number.isFinite(input[key]) ||
      input[key] < 0.2 ||
      input[key] > 1
    ) {
      throw new RangeError("Uploaded image scale must be between 0.2 and 1.");
    }
  }
  if (
    input.colorMode !== "original" &&
    input.colorMode !== "readable" &&
    input.colorMode !== "palette"
  ) {
    throw new TypeError("Unsupported uploaded image color mode.");
  }
  if (typeof input.colorBoundary !== "boolean") {
    throw new TypeError(
      "Uploaded image color boundary setting must be a boolean.",
    );
  }
  return input;
}

export function assertUploadedShapeSettings(
  value: unknown,
): asserts value is UploadedShapeSettings {
  const input = uploadedShapeSettingsRecord(value);
  assertUploadedShapeImage(input.image);
}

export function validateUploadedShapeSettings(
  value: unknown,
): UploadedShapeSettings {
  const input = uploadedShapeSettingsRecord(value);
  return {
    id: "uploaded",
    widthScale: input.widthScale as number,
    heightScale: input.heightScale as number,
    image: validateUploadedShapeImage(input.image),
    colorMode: input.colorMode as UploadedShapeSettings["colorMode"],
    colorBoundary: input.colorBoundary as boolean,
  };
}

function rgb(color: string): number[] {
  return [1, 3, 5].map((offset) =>
    Number.parseInt(color.slice(offset, offset + 2), 16),
  );
}

function hex(channels: readonly number[]): string {
  return `#${channels
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function fingerprint(image: UploadedShapeImage): string {
  return `${image.width}:${image.height}:${image.encoding}:${image.palette.join(",")}`;
}

function assertImageHeader(
  value: unknown,
): asserts value is UploadedShapeImage {
  const image = record(value, [
    "version",
    "width",
    "height",
    "palette",
    "encoding",
    "pixels",
  ]);
  if (image.version !== 1)
    throw new RangeError("Unsupported uploaded image version.");
  const width = imageDimension(image.width);
  const height = imageDimension(image.height);
  if (
    !Array.isArray(image.palette) ||
    image.palette.length < 1 ||
    image.palette.length > IMAGE_SHAPE_LIMITS.maxPaletteColors ||
    image.palette.some(
      (color) => typeof color !== "string" || !HEX_COLOR.test(color),
    )
  ) {
    throw new TypeError("Uploaded image palette contains unsupported colors.");
  }
  if (image.encoding !== "raw" && image.encoding !== "rle")
    throw new TypeError("Unsupported uploaded image pixel encoding.");
  const maxEncodedLength = Math.ceil((width * height) / 3) * 4;
  if (
    typeof image.pixels !== "string" ||
    image.pixels.length > maxEncodedLength
  )
    throw new RangeError(
      "Uploaded image pixel data exceeds the supported limit.",
    );
}

function cacheImage(
  image: UploadedShapeImage,
  pixels: Uint8Array,
): CachedImage {
  const entry: CachedImage = {
    fingerprint: fingerprint(image),
    encodedPixels: image.pixels,
    pixels,
    colors: [[0, 0, 0], ...image.palette.map(rgb)],
  };
  imageCache.set(image, entry);
  return entry;
}

function validatedCachedImage(image: UploadedShapeImage) {
  const entry = imageCache.get(image);
  return entry?.encodedPixels === image.pixels &&
    entry.fingerprint === fingerprint(image)
    ? entry
    : cacheImage(image, unpackPixels(image));
}

function cachedImage(image: UploadedShapeImage) {
  assertImageHeader(image);
  return validatedCachedImage(image);
}

export function assertUploadedShapeImage(
  value: unknown,
): asserts value is UploadedShapeImage {
  assertImageHeader(value);
  validatedCachedImage(value);
}

/** SVG path of the confirmed foreground, in source raster pixel coordinates. */
export function uploadedShapePath(image: UploadedShapeImage): string {
  const cached = cachedImage(image);
  if (cached.path !== undefined) return cached.path;
  const runs: string[] = [];
  for (let y = 0; y < image.height; y += 1) {
    let x = 0;
    while (x < image.width) {
      if (cached.pixels[y * image.width + x] === 0) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < image.width && cached.pixels[y * image.width + x] > 0) x += 1;
      runs.push(`M${start} ${y}h${x - start}v1H${start}z`);
    }
  }
  cached.path = runs.join("");
  return cached.path;
}

/** A copy protects the immutable shared asset from mask editing. */
export function decodeImagePixels(image: UploadedShapeImage): Uint8Array {
  return cachedImage(image).pixels.slice();
}

export function decodeUploadedShapeImage(image: UploadedShapeImage): {
  raster: RasterImage;
  mask: Uint8Array;
  pixels: Uint8Array;
} {
  const { pixels, colors } = cachedImage(image);
  const rgba = new Uint8ClampedArray(pixels.length * 4);
  const mask = new Uint8Array(pixels.length);
  pixels.forEach((value, index) => {
    if (value === 0) return;
    const offset = index * 4;
    rgba.set(colors[value], offset);
    rgba[offset + 3] = 255;
    mask[index] = 1;
  });
  return {
    raster: { width: image.width, height: image.height, rgba },
    mask,
    pixels: pixels.slice(),
  };
}

interface ColorBin {
  id: number;
  count: number;
  sums: number[];
}

function colorBins(raster: RasterImage, mask: Uint8Array): ColorBin[] {
  const bins = new Map<number, ColorBin>();
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    if (mask[index] === 0 || raster.rgba[offset + 3] < 16) continue;
    const channels = [
      raster.rgba[offset],
      raster.rgba[offset + 1],
      raster.rgba[offset + 2],
    ];
    const id =
      ((channels[0] >>> 3) << 10) |
      ((channels[1] >>> 3) << 5) |
      (channels[2] >>> 3);
    const bin = bins.get(id) ?? { id, count: 0, sums: [0, 0, 0] };
    bin.count += 1;
    channels.forEach((channel, component) => {
      bin.sums[component] += channel;
    });
    bins.set(id, bin);
  }
  return [...bins.values()];
}

function splitChannel(bins: ColorBin[]): { channel: number; range: number } {
  const minimum = [255, 255, 255];
  const maximum = [0, 0, 0];
  bins.forEach((bin) =>
    bin.sums.forEach((sum, channel) => {
      const value = sum / bin.count;
      minimum[channel] = Math.min(minimum[channel], value);
      maximum[channel] = Math.max(maximum[channel], value);
    }),
  );
  const ranges = maximum.map((value, channel) => value - minimum[channel]);
  const range = Math.max(...ranges);
  return { channel: ranges.indexOf(range), range };
}

function quantizeColors(bins: ColorBin[]): number[][] {
  const boxes = [bins];
  while (boxes.length < IMAGE_SHAPE_LIMITS.maxPaletteColors) {
    let selected = -1;
    let highest = 0;
    let channel = 0;
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      const split = splitChannel(box);
      const weight =
        split.range * Math.sqrt(box.reduce((sum, bin) => sum + bin.count, 0));
      if (weight > highest) {
        selected = index;
        highest = weight;
        channel = split.channel;
      }
    });
    if (selected < 0) break;
    const box = boxes[selected]
      .slice()
      .sort((a, b) => a.sums[channel] / a.count - b.sums[channel] / b.count);
    const half = box.reduce((sum, bin) => sum + bin.count, 0) / 2;
    let count = 0;
    let middle = 1;
    for (; middle < box.length; middle += 1) {
      count += box[middle - 1].count;
      if (count >= half) break;
    }
    middle = Math.min(box.length - 1, middle);
    boxes.splice(selected, 1, box.slice(0, middle), box.slice(middle));
  }
  return boxes.map((box) => {
    const count = box.reduce((sum, bin) => sum + bin.count, 0);
    return [0, 1, 2].map((channel) =>
      Math.round(box.reduce((sum, bin) => sum + bin.sums[channel], 0) / count),
    );
  });
}

function encodeRuns(pixels: Uint8Array): Uint8Array {
  const runs: number[] = [];
  for (let offset = 0; offset < pixels.length; ) {
    const color = pixels[offset];
    let end = offset + 1;
    while (end < pixels.length && pixels[end] === color && end - offset < 65535)
      end += 1;
    const count = end - offset;
    runs.push(count & 255, count >>> 8, color);
    offset = end;
  }
  return new Uint8Array(runs);
}

export function encodeUploadedShapeImage(
  raster: RasterImage,
  mask: Uint8Array,
): UploadedShapeImage {
  validateRasterImage(raster);
  if (
    !(mask instanceof Uint8Array) ||
    mask.length !== raster.width * raster.height
  ) {
    throw new RangeError(
      "Foreground mask does not match the image dimensions.",
    );
  }
  const bins = colorBins(raster, mask);
  if (bins.length === 0) {
    throw new RangeError(
      "Select some visible foreground before applying the image shape.",
    );
  }
  const colors = quantizeColors(bins);
  const nearest = new Map<number, number>();
  bins.forEach((bin) => {
    let chosen = 0;
    let distance = Number.POSITIVE_INFINITY;
    const source = bin.sums.map((sum) => sum / bin.count);
    colors.forEach((color, index) => {
      const candidate = color.reduce(
        (sum, value, channel) => sum + (value - source[channel]) ** 2,
        0,
      );
      if (candidate < distance) {
        distance = candidate;
        chosen = index;
      }
    });
    nearest.set(bin.id, chosen + 1);
  });
  const pixels = new Uint8Array(mask.length);
  mask.forEach((selected, index) => {
    const offset = index * 4;
    if (selected === 0 || raster.rgba[offset + 3] < 16) return;
    const id =
      ((raster.rgba[offset] >>> 3) << 10) |
      ((raster.rgba[offset + 1] >>> 3) << 5) |
      (raster.rgba[offset + 2] >>> 3);
    pixels[index] = nearest.get(id) ?? 0;
  });
  const runs = encodeRuns(pixels);
  const encoding = runs.length < pixels.length ? "rle" : "raw";
  const image: UploadedShapeImage = {
    version: 1,
    width: raster.width,
    height: raster.height,
    palette: colors.map(hex),
    encoding,
    pixels: encodeImageBytes(encoding === "rle" ? runs : pixels),
  };
  cacheImage(image, pixels);
  return image;
}

export function fitUploadedImageBounds(
  image: UploadedShapeImage,
  canvas: { width: number; height: number },
  widthScale: number,
  heightScale: number,
): ImageRect {
  const baseWidth = Math.min(
    canvas.width,
    (canvas.height * image.width) / image.height,
  );
  const width = baseWidth * widthScale;
  const height = ((baseWidth * image.height) / image.width) * heightScale;
  return {
    x: (canvas.width - width) / 2,
    y: (canvas.height - height) / 2,
    width,
    height,
  };
}

function rasterIndex(
  image: UploadedShapeImage,
  bounds: ImageRect,
  x: number,
  y: number,
): number {
  const column = Math.floor(((x - bounds.x) / bounds.width) * image.width);
  const row = Math.floor(((y - bounds.y) / bounds.height) * image.height);
  return column >= 0 && column < image.width && row >= 0 && row < image.height
    ? row * image.width + column
    : -1;
}

export function sampleUploadedShapeRegion(
  image: UploadedShapeImage,
  bounds: ImageRect,
  occupied: ImageRect,
  inkSpans?: readonly ImageInkSpan[],
): UploadedColorSample {
  const { pixels, colors } = cachedImage(image);
  const sums = [0, 0, 0];
  const squares = [0, 0, 0];
  let samples = 0;
  const addSample = (x: number, y: number) => {
    const index = rasterIndex(image, bounds, x, y);
    const value = pixels[index] ?? 0;
    if (value === 0) return;
    colors[value].forEach((channel, component) => {
      sums[component] += channel;
      squares[component] += channel * channel;
    });
    samples += 1;
  };
  if (inkSpans?.length) {
    const stride = Math.max(1, Math.ceil(inkSpans.length / 64));
    for (let index = 0; index < inkSpans.length; index += stride) {
      const span = inkSpans[index];
      for (let offset = 0; offset < 4; offset += 1) {
        addSample(
          occupied.x +
            span.start +
            ((span.end - span.start) * (offset + 0.5)) / 4,
          occupied.y + span.y + 0.5,
        );
      }
    }
  } else {
    const columns = Math.max(
      1,
      Math.min(8, Math.ceil((occupied.width * image.width) / bounds.width)),
    );
    const rows = Math.max(
      1,
      Math.min(8, Math.ceil((occupied.height * image.height) / bounds.height)),
    );
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        addSample(
          occupied.x + (occupied.width * (column + 0.5)) / columns,
          occupied.y + (occupied.height * (row + 0.5)) / rows,
        );
      }
    }
  }
  if (samples === 0)
    return { color: image.palette[0], variance: 1, samples: 0 };
  const means = sums.map((sum) => sum / samples);
  const variance =
    squares.reduce(
      (sum, square, channel) =>
        sum + Math.max(0, square / samples - means[channel] ** 2),
      0,
    ) /
    (3 * 255 ** 2);
  return { color: hex(means), variance: Math.min(1, variance * 4), samples };
}

export function sampleUploadedShapeColor(
  image: UploadedShapeImage,
  bounds: ImageRect,
  occupied: ImageRect,
  inkSpans?: readonly ImageInkSpan[],
): string | undefined {
  const sample = sampleUploadedShapeRegion(image, bounds, occupied, inkSpans);
  return sample.samples ? sample.color : undefined;
}

export function uploadedShapeColorBoundaryPenalty(
  image: UploadedShapeImage,
  bounds: ImageRect,
  occupied: ImageRect,
): number {
  return sampleUploadedShapeRegion(image, bounds, occupied).variance;
}

function luminance(color: string): number {
  const linear = rgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function imageColorContrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function readableShapeColor(
  source: string,
  background: string,
  target = 4.5,
): string {
  if (!HEX_COLOR.test(source) || !HEX_COLOR.test(background)) return source;
  if (imageColorContrast(source, background) >= target) return source;
  const channels = rgb(source);
  const endpoint =
    imageColorContrast("#000000", background) >=
    imageColorContrast("#ffffff", background)
      ? 0
      : 255;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const amount = (low + high) / 2;
    const color = hex(
      channels.map((channel) => channel + (endpoint - channel) * amount),
    );
    if (imageColorContrast(color, background) >= target) high = amount;
    else low = amount;
  }
  return hex(channels.map((channel) => channel + (endpoint - channel) * high));
}

export function suggestImageBackgrounds(image: UploadedShapeImage): string[] {
  const { pixels } = cachedImage(image);
  const weights = new Uint32Array(image.palette.length + 1);
  pixels.forEach((index) => {
    weights[index] += 1;
  });
  return ["#ffffff", "#111827", "#f7f0df", "#0f172a", "#eff6ff"]
    .map((background) => ({
      background,
      score: image.palette.reduce((sum, color, index) => {
        const contrast = imageColorContrast(color, background);
        return (
          sum +
          weights[index + 1] *
            (Number(contrast >= 4.5) * 20 + Math.min(contrast, 10))
        );
      }, 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ background }) => background);
}
