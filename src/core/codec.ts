import { Unzlib, zlibSync } from "fflate";
import { canonicalStringify, parseStrictJson } from "./canonical-json";
import { LIMITS, utf8ByteLength } from "./limits";

export const SNAPSHOT_PREFIX = "#wc-pako:v1:";
export const BROTLI_SNAPSHOT_PREFIX = "#wc-br:v2:";
export const CODEC_VERSION = "wc-pako-v1";
export const SHARE_URL_LENGTH_PARAM = "wc_chars";

export type CodecErrorCode =
  | "PREFIX"
  | "BASE64"
  | "PAYLOAD_LIMIT"
  | "INFLATE_LIMIT"
  | "UTF8"
  | "JSON"
  | "NONCANONICAL"
  | "URL_LIMIT"
  | "TRUNCATED";

export class CodecError extends Error {
  public constructor(
    public readonly code: CodecErrorCode,
    message: string,
    options?: ErrorOptions,
    public readonly shareUrlLengths?: {
      actualChars: number;
      expectedChars: number;
    },
  ) {
    super(message, options);
    this.name = "CodecError";
  }
}

export interface EncodedJsonFragment {
  fragment: string;
  jsonBytes: number;
  compressedBytes: number;
}

export type SnapshotFormat = "v1" | "v2";

export function snapshotFormatFromFragment(
  fragment: string,
): SnapshotFormat | undefined {
  if (fragment.startsWith(SNAPSHOT_PREFIX)) return "v1";
  if (fragment.startsWith(BROTLI_SNAPSHOT_PREFIX)) return "v2";
  return undefined;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCodePoint(...bytes.subarray(index, index + chunkSize));
  }
  const encoded = btoa(binary);
  const paddingIndex = encoded.indexOf("=");
  const unpadded =
    paddingIndex === -1 ? encoded : encoded.slice(0, paddingIndex);
  return unpadded.replaceAll("+", "-").replaceAll("/", "_");
}

function base64UrlToBytes(payload: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(payload) || payload.length % 4 === 1) {
    throw new CodecError("BASE64", "V payload is not valid URL-safe Base64.");
  }
  const padded =
    payload.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (payload.length % 4)) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(
      binary,
      (character) => character.codePointAt(0) ?? 0,
    );
  } catch {
    throw new CodecError(
      "BASE64",
      "V payload Base64 encoding could not be decoded.",
    );
  }
}

function adler32(bytes: Uint8Array): number {
  const modulus = 65_521;
  let a = 1;
  let b = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += 5_552) {
    const end = Math.min(offset + 5_552, bytes.byteLength);
    for (let index = offset; index < end; index += 1) {
      a += bytes[index]!;
      b += a;
    }
    a %= modulus;
    b %= modulus;
  }
  return ((b << 16) | a) >>> 0;
}

function inflateBounded(compressed: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const ratioLimit = Math.max(
    compressed.byteLength * LIMITS.maxInflateRatio,
    1,
  );
  const inflater = new Unzlib();
  inflater.ondata = (chunk) => {
    total += chunk.byteLength;
    if (total > LIMITS.maxInflatedJsonBytes || total > ratioLimit) {
      throw new CodecError(
        "INFLATE_LIMIT",
        "V payload exceeds the safe decompressed size or expansion ratio limit.",
      );
    }
    chunks.push(chunk);
  };
  try {
    const compressedChunkSize = 256;
    for (
      let offset = 0;
      offset < compressed.byteLength;
      offset += compressedChunkSize
    ) {
      const end = Math.min(offset + compressedChunkSize, compressed.byteLength);
      inflater.push(
        compressed.subarray(offset, end),
        end === compressed.byteLength,
      );
    }
    if (compressed.byteLength === 0) inflater.push(compressed, true);
  } catch (error) {
    if (error instanceof CodecError) throw error;
    // biome-ignore lint/style/useErrorCause: CodecError forwards ErrorOptions to Error.
    throw new CodecError("INFLATE_LIMIT", "V payload decompression failed.", {
      cause: error,
    });
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const trailerOffset = compressed.byteLength - 4;
  const expectedChecksum =
    ((compressed[trailerOffset]! << 24) |
      (compressed[trailerOffset + 1]! << 16) |
      (compressed[trailerOffset + 2]! << 8) |
      compressed[trailerOffset + 3]!) >>>
    0;
  if (adler32(result) !== expectedChecksum) {
    throw new CodecError(
      "INFLATE_LIMIT",
      "V payload decompression checksum does not match.",
    );
  }
  return result;
}

function encodeJson(
  value: unknown,
  maxEncodedBytes: number,
): EncodedJsonFragment {
  const json = canonicalStringify(value);
  const jsonBytes = new TextEncoder().encode(json);
  const compressed = zlibSync(jsonBytes, { level: 9 });
  const fragment = `${SNAPSHOT_PREFIX}${bytesToBase64Url(compressed)}`;
  if (utf8ByteLength(fragment) > maxEncodedBytes) {
    throw new CodecError(
      "PAYLOAD_LIMIT",
      `V fragment exceeds the ${maxEncodedBytes}-byte limit.`,
    );
  }
  return {
    fragment,
    jsonBytes: jsonBytes.byteLength,
    compressedBytes: compressed.byteLength,
  };
}

export function encodeJsonFragment(
  value: unknown,
  maxEncodedBytes: number = LIMITS.maxEncodedFragmentBytes,
): EncodedJsonFragment {
  return encodeJson(value, maxEncodedBytes);
}

let brotliApiPromise: Promise<import("brotli-wasm").BrotliWasmType> | undefined;

async function getBrotliApi(): Promise<import("brotli-wasm").BrotliWasmType> {
  brotliApiPromise ??= import("brotli-wasm").then((module) => module.default);
  return brotliApiPromise;
}

export async function encodeBrotliJsonFragment(
  value: unknown,
  maxEncodedBytes: number = LIMITS.maxEncodedFragmentBytes,
): Promise<EncodedJsonFragment> {
  const json = canonicalStringify(value);
  const jsonBytes = new TextEncoder().encode(json);
  const brotli = await getBrotliApi();
  const compressed = brotli.compress(jsonBytes, { quality: 11 });
  const fragment = `${BROTLI_SNAPSHOT_PREFIX}${bytesToBase64Url(compressed)}`;
  if (utf8ByteLength(fragment) > maxEncodedBytes) {
    throw new CodecError(
      "PAYLOAD_LIMIT",
      `V2 fragment exceeds the ${maxEncodedBytes}-byte limit.`,
    );
  }
  return {
    fragment,
    jsonBytes: jsonBytes.byteLength,
    compressedBytes: compressed.byteLength,
  };
}

export function decodeJsonFragment(
  fragment: string,
  maxEncodedBytes: number = LIMITS.maxEncodedFragmentBytes,
): unknown {
  if (!fragment.startsWith(SNAPSHOT_PREFIX)) {
    throw new CodecError("PREFIX", "V URL prefix or version is not supported.");
  }
  if (utf8ByteLength(fragment) > maxEncodedBytes) {
    throw new CodecError(
      "PAYLOAD_LIMIT",
      `V fragment exceeds the ${maxEncodedBytes}-byte limit.`,
    );
  }
  const payload = fragment.slice(SNAPSHOT_PREFIX.length);
  if (!payload) throw new CodecError("BASE64", "V payload must not be empty.");
  const compressed = base64UrlToBytes(payload);
  const inflated = inflateBounded(compressed);
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(inflated);
  } catch {
    throw new CodecError("UTF8", "V payload is not valid UTF-8 JSON.");
  }
  let value: unknown;
  try {
    value = parseStrictJson(json);
  } catch (error) {
    // biome-ignore lint/style/useErrorCause: CodecError forwards ErrorOptions to Error.
    throw new CodecError(
      "JSON",
      error instanceof Error ? error.message : "V payload JSON is invalid.",
      { cause: error },
    );
  }
  if (canonicalStringify(value) !== json) {
    throw new CodecError(
      "NONCANONICAL",
      "V payload is not in canonical JSON form.",
    );
  }
  return value;
}

function isBrotliStreamComplete(
  resultCode: number,
  resultCodes: {
    ResultSuccess: number;
    NeedsMoreInput: number;
    NeedsMoreOutput: number;
  },
  inputOffset: number,
  compressedByteLength: number,
): boolean {
  if (resultCode === resultCodes.ResultSuccess) {
    if (inputOffset !== compressedByteLength) {
      throw new CodecError(
        "INFLATE_LIMIT",
        "V2 payload has trailing compressed data.",
      );
    }
    return true;
  }
  if (resultCode === resultCodes.NeedsMoreInput) {
    throw new CodecError(
      "INFLATE_LIMIT",
      "V2 payload decompression failed because the compressed stream is incomplete.",
    );
  }
  if (resultCode !== resultCodes.NeedsMoreOutput) {
    throw new CodecError("INFLATE_LIMIT", "V2 payload decompression failed.");
  }
  return false;
}

async function inflateBrotliBounded(
  compressed: Uint8Array,
): Promise<Uint8Array> {
  const brotli = await getBrotliApi();
  const decoder = new brotli.DecompressStream();
  const chunks: Uint8Array[] = [];
  const ratioLimit = Math.max(
    compressed.byteLength * LIMITS.maxInflateRatio,
    1,
  );
  let total = 0;
  let inputOffset = 0;
  let completed = false;

  try {
    while (!completed) {
      const result = decoder.decompress(
        compressed.subarray(inputOffset),
        4_096,
      );
      try {
        const output = result.buf;
        inputOffset += result.input_offset;
        total += output.byteLength;
        if (total > LIMITS.maxInflatedJsonBytes || total > ratioLimit) {
          throw new CodecError(
            "INFLATE_LIMIT",
            "V2 payload exceeds the safe decompressed size or expansion ratio limit.",
          );
        }
        if (output.byteLength > 0) chunks.push(output);

        completed = isBrotliStreamComplete(
          result.code,
          brotli.BrotliStreamResultCode,
          inputOffset,
          compressed.byteLength,
        );
      } finally {
        result.free();
      }
    }
  } catch (error) {
    if (error instanceof CodecError) throw error;
    // biome-ignore lint/style/useErrorCause: CodecError forwards ErrorOptions to Error.
    throw new CodecError("INFLATE_LIMIT", "V2 payload decompression failed.", {
      cause: error,
    });
  } finally {
    decoder.free();
  }

  const inflated = new Uint8Array(total);
  let outputOffset = 0;
  for (const chunk of chunks) {
    inflated.set(chunk, outputOffset);
    outputOffset += chunk.byteLength;
  }
  return inflated;
}

export async function decodeBrotliJsonFragment(
  fragment: string,
  maxEncodedBytes: number = LIMITS.maxEncodedFragmentBytes,
): Promise<unknown> {
  if (!fragment.startsWith(BROTLI_SNAPSHOT_PREFIX)) {
    throw new CodecError(
      "PREFIX",
      "V2 URL prefix or version is not supported.",
    );
  }
  if (utf8ByteLength(fragment) > maxEncodedBytes) {
    throw new CodecError(
      "PAYLOAD_LIMIT",
      `V2 fragment exceeds the ${maxEncodedBytes}-byte limit.`,
    );
  }
  const payload = fragment.slice(BROTLI_SNAPSHOT_PREFIX.length);
  if (!payload) throw new CodecError("BASE64", "V2 payload must not be empty.");
  const inflated = await inflateBrotliBounded(base64UrlToBytes(payload));
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(inflated);
  } catch {
    throw new CodecError("UTF8", "V2 payload is not valid UTF-8 JSON.");
  }
  let value: unknown;
  try {
    value = parseStrictJson(json);
  } catch (error) {
    // biome-ignore lint/style/useErrorCause: CodecError forwards ErrorOptions to Error.
    throw new CodecError(
      "JSON",
      error instanceof Error ? error.message : "V2 payload JSON is invalid.",
      { cause: error },
    );
  }
  if (canonicalStringify(value) !== json) {
    throw new CodecError(
      "NONCANONICAL",
      "V2 payload is not in canonical JSON form.",
    );
  }
  return value;
}

export async function decodeJsonFragmentAsync(
  fragment: string,
  maxEncodedBytes: number = LIMITS.maxEncodedFragmentBytes,
): Promise<unknown> {
  if (fragment.startsWith(BROTLI_SNAPSHOT_PREFIX)) {
    return decodeBrotliJsonFragment(fragment, maxEncodedBytes);
  }
  return decodeJsonFragment(fragment, maxEncodedBytes);
}

export function buildShareUrl(baseUrl: string, fragment: string): string {
  if (!fragment.startsWith("#"))
    throw new CodecError("PREFIX", "Fragment must start with #.");
  if (utf8ByteLength(fragment) > LIMITS.maxEncodedFragmentBytes)
    throw new CodecError(
      "PAYLOAD_LIMIT",
      `V fragment exceeds the ${LIMITS.maxEncodedFragmentBytes}-byte limit.`,
    );
  const url = new URL(baseUrl);
  url.searchParams.delete(SHARE_URL_LENGTH_PARAM);
  url.searchParams.set(SHARE_URL_LENGTH_PARAM, "0");
  url.hash = fragment.slice(1);
  let result = url.toString();
  let expectedChars = result.length;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    url.searchParams.set(SHARE_URL_LENGTH_PARAM, String(expectedChars));
    result = url.toString();
    if (result.length === expectedChars) break;
    expectedChars = result.length;
  }
  if (utf8ByteLength(result) > LIMITS.maxShareUrlBytes) {
    throw new CodecError(
      "URL_LIMIT",
      `Share URL exceeds the ${LIMITS.maxShareUrlBytes}-byte limit.`,
    );
  }
  return result;
}

export function assertShareUrlNotTruncated(shareUrl: string): void {
  const url = new URL(shareUrl);
  const expectedValue = url.searchParams.get(SHARE_URL_LENGTH_PARAM);
  if (!expectedValue || !/^\d+$/u.test(expectedValue)) return;
  const expectedChars = Number(expectedValue);
  const actualChars = shareUrl.length;
  if (Number.isSafeInteger(expectedChars) && actualChars < expectedChars) {
    throw new CodecError(
      "TRUNCATED",
      `Share URL was truncated: expected ${expectedChars} characters, but received ${actualChars}. Copy the complete link or reduce the word count before sharing.`,
      undefined,
      { actualChars, expectedChars },
    );
  }
}
