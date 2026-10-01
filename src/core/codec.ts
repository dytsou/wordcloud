import { Unzlib, zlibSync } from "fflate";
import { canonicalStringify, parseStrictJson } from "./canonical-json";
import { LIMITS, utf8ByteLength } from "./limits";

export const SNAPSHOT_PREFIX = "#wc-pako:v2:";
export const CODEC_VERSION = "wc-pako-v2";

export type CodecErrorCode =
  | "PREFIX"
  | "BASE64"
  | "PAYLOAD_LIMIT"
  | "INFLATE_LIMIT"
  | "UTF8"
  | "JSON"
  | "NONCANONICAL"
  | "URL_LIMIT";

export class CodecError extends Error {
  public constructor(
    public readonly code: CodecErrorCode,
    message: string,
    options?: ErrorOptions,
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
  prefix: string,
): EncodedJsonFragment {
  const json = canonicalStringify(value);
  const jsonBytes = new TextEncoder().encode(json);
  const compressed = zlibSync(jsonBytes, { level: 9 });
  const fragment = `${prefix}${bytesToBase64Url(compressed)}`;
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

export function encodeScenePackFragment(
  value: unknown,
  maxEncodedBytes: number = LIMITS.maxEncodedFragmentBytes,
): EncodedJsonFragment {
  return encodeJson(value, maxEncodedBytes, SNAPSHOT_PREFIX);
}

function decodeJson(
  fragment: string,
  prefix: string,
  maxEncodedBytes: number = LIMITS.maxEncodedFragmentBytes,
): unknown {
  if (!fragment.startsWith(prefix)) {
    throw new CodecError("PREFIX", "V URL prefix or version is not supported.");
  }
  if (utf8ByteLength(fragment) > maxEncodedBytes) {
    throw new CodecError(
      "PAYLOAD_LIMIT",
      `V fragment exceeds the ${maxEncodedBytes}-byte limit.`,
    );
  }
  const payload = fragment.slice(prefix.length);
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

export function decodeScenePackFragment(
  fragment: string,
  maxEncodedBytes: number = LIMITS.maxEncodedFragmentBytes,
): unknown {
  return decodeJson(fragment, SNAPSHOT_PREFIX, maxEncodedBytes);
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
  url.searchParams.set("wc-codec", CODEC_VERSION);
  url.hash = fragment.slice(1);
  const result = url.toString();
  if (utf8ByteLength(result) > LIMITS.maxShareUrlBytes) {
    throw new CodecError(
      "URL_LIMIT",
      `Share URL exceeds the ${LIMITS.maxShareUrlBytes}-byte limit.`,
    );
  }
  return result;
}
