import {
  detectForeground,
  type SubjectSelection,
  segmentSubject,
} from "../core/image-segmentation";
import {
  IMAGE_SHAPE_LIMITS,
  type RasterImage,
  validateRasterImage,
} from "../core/image-shape";

export interface ForegroundOptions {
  tolerance?: number;
  includeEnclosedBackground?: boolean;
}
export type ImageProcessingJob =
  | { kind: "foreground"; raster: RasterImage; options: ForegroundOptions }
  | { kind: "subject"; raster: RasterImage; options: SubjectSelection };
export interface ImageProcessingResult {
  ok: boolean;
  mask?: Uint8Array;
  error?: string;
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException("Image processing was cancelled.", "AbortError");
}
function sourceDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > IMAGE_SHAPE_LIMITS.maxSourcePixels ||
    height > IMAGE_SHAPE_LIMITS.maxSourcePixels ||
    width * height > IMAGE_SHAPE_LIMITS.maxSourcePixels
  ) {
    throw new RangeError("Image dimensions exceed the 16 million pixel limit.");
  }
  return { width, height };
}
function text(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
function pngDimensions(bytes: Uint8Array, view: DataView) {
  if (
    bytes.length < 33 ||
    view.getUint32(8) !== 13 ||
    text(bytes, 12, 4) !== "IHDR"
  ) {
    throw new TypeError("Invalid PNG image header.");
  }
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = view.getUint32(offset);
    if (offset + length + 12 > bytes.length)
      throw new TypeError("Incomplete PNG image chunk.");
    if (text(bytes, offset + 4, 4) === "acTL")
      throw new TypeError("Animated images are not supported as image shapes.");
    offset += length + 12;
  }
  return sourceDimensions(view.getUint32(16), view.getUint32(20));
}
const MAX_JPEG_HEADER_MARKER_WORK = 4096;

function jpegDimensions(bytes: Uint8Array, view: DataView) {
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2]);
  let offset = 2;
  let markerWork = 0;
  let dimensions: { width: number; height: number } | undefined;
  while (offset < bytes.length) {
    if (markerWork >= MAX_JPEG_HEADER_MARKER_WORK)
      throw new TypeError("JPEG image header contains too many markers.");
    markerWork += 1;
    if (bytes[offset++] !== 0xff)
      throw new TypeError("Invalid JPEG image header.");
    while (bytes[offset] === 0xff) {
      markerWork += 1;
      if (markerWork > MAX_JPEG_HEADER_MARKER_WORK)
        throw new TypeError("JPEG image header contains too many markers.");
      offset += 1;
    }
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01) continue;
    if (marker >= 0xd0 && marker <= 0xd7)
      throw new TypeError("Invalid JPEG restart marker before scan.");
    if (offset + 2 > bytes.length) break;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length)
      throw new TypeError("Incomplete JPEG image segment.");
    if (frameMarkers.has(marker)) {
      if (length < 8 || bytes[offset + 2] !== 8)
        throw new TypeError("Unsupported JPEG image frame.");
      if (dimensions)
        throw new TypeError("Multiple JPEG frames are not supported.");
      dimensions = sourceDimensions(
        view.getUint16(offset + 5),
        view.getUint16(offset + 3),
      );
    }
    offset += length;
  }
  if (!dimensions) throw new TypeError("JPEG image dimensions are missing.");
  return dimensions;
}
function webpDimensions(bytes: Uint8Array, view: DataView) {
  if (view.getUint32(4, true) + 8 !== bytes.length)
    throw new TypeError("Invalid WebP image length.");
  let dimensions: { width: number; height: number } | undefined;
  let frame: { width: number; height: number } | undefined;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const kind = text(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.length)
      throw new TypeError("Incomplete WebP image chunk.");
    if (kind === "ANIM" || kind === "ANMF")
      throw new TypeError("Animated images are not supported as image shapes.");
    if (kind === "VP8X") {
      if (length !== 10 || dimensions)
        throw new TypeError("Invalid WebP extended image header.");
      if ((bytes[start] & 2) !== 0)
        throw new TypeError(
          "Animated images are not supported as image shapes.",
        );
      dimensions = sourceDimensions(
        1 +
          bytes[start + 4] +
          (bytes[start + 5] << 8) +
          (bytes[start + 6] << 16),
        1 +
          bytes[start + 7] +
          (bytes[start + 8] << 8) +
          (bytes[start + 9] << 16),
      );
    }
    if (kind === "VP8L" || kind === "VP8 ") {
      if (frame) throw new TypeError("Multiple WebP frames are not supported.");
      if (kind === "VP8L" && length >= 5 && bytes[start] === 0x2f) {
        frame = sourceDimensions(
          1 + bytes[start + 1] + ((bytes[start + 2] & 63) << 8),
          1 +
            (bytes[start + 2] >>> 6) +
            (bytes[start + 3] << 2) +
            ((bytes[start + 4] & 15) << 10),
        );
      } else if (
        kind === "VP8 " &&
        length >= 10 &&
        bytes[start + 3] === 0x9d &&
        bytes[start + 4] === 1 &&
        bytes[start + 5] === 0x2a
      ) {
        frame = sourceDimensions(
          view.getUint16(start + 6, true) & 0x3fff,
          view.getUint16(start + 8, true) & 0x3fff,
        );
      } else throw new TypeError("Invalid WebP image frame.");
    }
    offset = start + length + (length % 2);
  }
  if (!frame) throw new TypeError("WebP image dimensions are missing.");
  if (
    dimensions &&
    (dimensions.width !== frame.width || dimensions.height !== frame.height)
  )
    throw new TypeError("WebP frame dimensions do not match its canvas.");
  return dimensions ?? frame;
}

/** Validate encoded headers before asking a browser decoder to allocate pixels. */
export function inspectImageBytes(bytes: Uint8Array): {
  type: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
} {
  if (bytes.length === 0 || bytes.length > IMAGE_SHAPE_LIMITS.maxUploadBytes)
    throw new RangeError("Image upload must be at most 8 MiB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 8 &&
    view.getUint32(0) === 0x89504e47 &&
    view.getUint32(4) === 0x0d0a1a0a
  )
    return { type: "image/png", ...pngDimensions(bytes, view) };
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8)
    return { type: "image/jpeg", ...jpegDimensions(bytes, view) };
  if (
    bytes.length >= 20 &&
    text(bytes, 0, 4) === "RIFF" &&
    text(bytes, 8, 4) === "WEBP"
  )
    return { type: "image/webp", ...webpDimensions(bytes, view) };
  throw new TypeError("Upload a raster PNG, JPEG, or WebP image.");
}

function imageElement(
  file: File,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const finish = (error?: Error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancelled);
      URL.revokeObjectURL(url);
      image.onload = null;
      image.onerror = null;
      if (error) {
        image.src = "";
        reject(error);
      } else resolve(image);
    };
    const cancelled = () =>
      finish(new DOMException("Image decoding was cancelled.", "AbortError"));
    const timer = setTimeout(
      () => finish(new Error("Image decoding timed out.")),
      15_000,
    );
    signal?.addEventListener("abort", cancelled, { once: true });
    image.onload = () => finish();
    image.onerror = () =>
      finish(new TypeError("The image could not be decoded."));
    image.src = url;
  });
}

function bitmapImage(file: File, signal?: AbortSignal): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (bitmap?: ImageBitmap, error?: Error) => {
      if (settled) {
        bitmap?.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancelled);
      if (error) reject(error);
      else if (bitmap) resolve(bitmap);
    };
    const cancelled = () =>
      finish(
        undefined,
        new DOMException("Image decoding was cancelled.", "AbortError"),
      );
    const timer = setTimeout(
      () =>
        finish(
          undefined,
          new DOMException("Image decoding timed out.", "TimeoutError"),
        ),
      15_000,
    );
    signal?.addEventListener("abort", cancelled, { once: true });
    createImageBitmap(file).then(
      (bitmap) => finish(bitmap),
      (error: unknown) =>
        finish(
          undefined,
          new TypeError("The image could not be decoded.", { cause: error }),
        ),
    );
  });
}

export async function loadImageRaster(
  file: File,
  signal?: AbortSignal,
): Promise<RasterImage> {
  abortIfNeeded(signal);
  if (file.size === 0 || file.size > IMAGE_SHAPE_LIMITS.maxUploadBytes)
    throw new RangeError("Image upload must be at most 8 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  abortIfNeeded(signal);
  const header = inspectImageBytes(bytes);
  if (file.type && file.type !== header.type)
    throw new TypeError("Image content does not match its file type.");
  let decoded: ImageBitmap | HTMLImageElement;
  try {
    decoded =
      typeof createImageBitmap === "function"
        ? await bitmapImage(file, signal)
        : await imageElement(file, signal);
  } catch (error) {
    abortIfNeeded(signal);
    if (error instanceof DOMException && error.name === "TimeoutError")
      throw error;
    if (typeof Image !== "function" || typeof createImageBitmap !== "function")
      throw new TypeError("The image could not be decoded.", { cause: error });
    decoded = await imageElement(file, signal);
  }
  try {
    abortIfNeeded(signal);
    const sourceWidth =
      "close" in decoded ? decoded.width : decoded.naturalWidth;
    const sourceHeight =
      "close" in decoded ? decoded.height : decoded.naturalHeight;
    sourceDimensions(sourceWidth, sourceHeight);
    const scale = Math.min(
      1,
      IMAGE_SHAPE_LIMITS.maxDimension / Math.max(sourceWidth, sourceHeight),
    );
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas =
      typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(width, height)
        : document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!context) throw new Error("Image processing canvas is unavailable.");
    try {
      context.drawImage(decoded, 0, 0, width, height);
      return {
        width,
        height,
        rgba: context.getImageData(0, 0, width, height).data,
      };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    if ("close" in decoded) decoded.close();
    else decoded.src = "";
  }
}

export function runImageProcessingJob(job: ImageProcessingJob): Uint8Array {
  return job.kind === "foreground"
    ? detectForeground(
        job.raster,
        job.options.tolerance,
        job.options.includeEnclosedBackground,
      )
    : segmentSubject(job.raster, job.options);
}

async function processImage(
  job: ImageProcessingJob,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  validateRasterImage(job.raster);
  abortIfNeeded(signal);
  if (typeof Worker !== "function") {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    abortIfNeeded(signal);
    const mask = runImageProcessingJob(job);
    abortIfNeeded(signal);
    return mask;
  }
  const worker = new Worker(
    new URL("./image-processing.worker.ts", import.meta.url),
    { type: "module" },
  );
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (mask?: Uint8Array, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancelled);
      worker.terminate();
      if (error) reject(error);
      else if (mask) resolve(mask);
    };
    const cancelled = () =>
      finish(
        undefined,
        new DOMException("Image processing was cancelled.", "AbortError"),
      );
    const timer = setTimeout(
      () => finish(undefined, new Error("Image processing timed out.")),
      15_000,
    );
    signal?.addEventListener("abort", cancelled, { once: true });
    worker.onmessage = (event: MessageEvent<ImageProcessingResult>) => {
      const result = event.data;
      if (
        result.ok &&
        result.mask instanceof Uint8Array &&
        result.mask.length === job.raster.width * job.raster.height
      )
        finish(result.mask);
      else
        finish(
          undefined,
          new Error(
            result.error ?? "Image processing returned invalid pixel data.",
          ),
        );
    };
    worker.onerror = () =>
      finish(undefined, new Error("Image processing worker failed."));
    try {
      worker.postMessage(job);
    } catch (error) {
      finish(
        undefined,
        new Error("Image processing could not start.", { cause: error }),
      );
    }
  });
}

export function processForeground(
  raster: RasterImage,
  options: ForegroundOptions = {},
  signal?: AbortSignal,
): Promise<Uint8Array> {
  return processImage({ kind: "foreground", raster, options }, signal);
}
export function processSubject(
  raster: RasterImage,
  options: SubjectSelection,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  return processImage({ kind: "subject", raster, options }, signal);
}
