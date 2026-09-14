export interface FontMetric {
  width: number;
  height: number;
}

export interface FontMetricsTable {
  baseFontSize: number;
  fingerprint: string;
  words: Record<string, FontMetric>;
}

export interface FontProfile {
  id: string;
  family: string;
  weight: number;
  style: "normal" | "italic";
}

export type WordMeasurer = (term: string, font: string) => FontMetric;

export function createFontMetricsTable(
  terms: string[],
  profile: FontProfile,
  baseFontSize: number,
  measure: WordMeasurer,
): FontMetricsTable {
  const font = `${profile.style} ${profile.weight} ${baseFontSize}px ${profile.family}`;
  const words: Record<string, FontMetric> = {};
  for (const term of terms) {
    words[term] = measure(term, font);
  }
  return {
    baseFontSize,
    fingerprint: `${profile.id}:${font}`,
    words,
  };
}

export async function waitForFonts(
  fonts: FontFaceSet | undefined,
): Promise<void> {
  if (fonts) await fonts.ready;
}
