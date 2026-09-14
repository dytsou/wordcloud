export const LIMITS = {
  maxSourceBytes: 1_048_576,
  maxCandidateTokens: 200_000,
  maxUniqueTerms: 500,
  maxCustomRules: 100,
  maxLiteralScalars: 128,
  maxLayoutProbes: 100_000,
  maxEncodedFragmentBytes: 8 * 1024,
  maxShareUrlBytes: 12 * 1024,
  maxSnapshotFileBytes: 512 * 1024,
  maxInflatedJsonBytes: 256 * 1024,
  maxInflateRatio: 64,
  maxCanvasDimension: 4096,
  maxExportPixels: 16_000_000,
} as const;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function scalarLength(value: string): number {
  return Array.from(value).length;
}

export function hasLetterOrNumber(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

export function isNumberOnly(value: string): boolean {
  return /^[\p{N}]+$/u.test(value);
}
