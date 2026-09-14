import { LIMITS, scalarLength } from "./limits";

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu;
const FONT_FAMILY_PATTERN = /^[\p{L}\p{N}\s,'"-]+$/u;

export function isSafeHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

export function isSafeFontFamily(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    scalarLength(value) <= LIMITS.maxLiteralScalars &&
    FONT_FAMILY_PATTERN.test(value)
  );
}

export function safePalette(
  palette: readonly string[],
  fallback = "#111111",
): string[] {
  const valid = palette.filter(isSafeHexColor);
  return valid.length > 0 ? [...valid] : [fallback];
}

export function safeBackground(value: string, fallback = "#f7f0df"): string {
  return isSafeHexColor(value) ? value : fallback;
}

export function safeFontFamily(value: string, fallback = "system-ui"): string {
  return isSafeFontFamily(value) ? value : fallback;
}
