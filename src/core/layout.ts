import { LIMITS } from "./limits";
import {
  metricsFingerprint,
  SCENE_VERSION,
  type SceneModel,
  type SceneWord,
} from "./scene";
import type { FontMetricsTable } from "./metrics";
import type { Word, WordSet } from "./types";

export type FrequencyScale = "sqrt" | "linear" | "log";

export interface LayoutStyle {
  canvas: { width: number; height: number };
  minFontSize: number;
  maxFontSize: number;
  scale: FrequencyScale;
  padding: number;
  rotations: number[];
  palette: string[];
  background: string;
  fontFamily: string;
  seed: string;
  version: string;
}

export interface LayoutOptions {
  maxProbes?: number;
  maxLayoutMs?: number;
  shouldCancel?: () => boolean;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CELL_SIZE = 64;

function hashSeed(seed: string): number {
  let hash = 2_166_136_261;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function random(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = Math.imul(1_664_525, state) + 1_013_904_223;
    return (state >>> 0) / 4_294_967_296;
  };
}

function quantize(value: number): number {
  return Math.round(value * 2) / 2;
}

export function mapFrequency(
  count: number,
  minimum: number,
  maximum: number,
  scale: FrequencyScale,
  minFontSize: number,
  maxFontSize: number,
): number {
  if (minimum === maximum) return quantize((minFontSize + maxFontSize) / 2);
  const safeCount = Math.max(minimum, Math.min(maximum, count));
  const ratio = (safeCount - minimum) / (maximum - minimum);
  const mapped =
    scale === "linear"
      ? ratio
      : scale === "log"
        ? Math.log1p(ratio * 9) / Math.log(10)
        : Math.sqrt(ratio);
  return quantize(minFontSize + mapped * (maxFontSize - minFontSize));
}

function rotatedSize(
  width: number,
  height: number,
  angle: number,
): { width: number; height: number } {
  const normalized = Math.abs(angle) % 180;
  return normalized === 90
    ? { width: height, height: width }
    : { width, height };
}

function keyForCell(x: number, y: number): string {
  return `${Math.floor(x / CELL_SIZE)}:${Math.floor(y / CELL_SIZE)}`;
}

class SpatialGrid {
  private readonly cells = new Map<string, Rect[]>();

  add(rect: Rect): void {
    for (let x = rect.x; x <= rect.x + rect.width; x += CELL_SIZE) {
      for (let y = rect.y; y <= rect.y + rect.height; y += CELL_SIZE) {
        const key = keyForCell(x, y);
        const values = this.cells.get(key) ?? [];
        values.push(rect);
        this.cells.set(key, values);
      }
    }
  }

  collides(rect: Rect): boolean {
    const seen = new Set<Rect>();
    for (let x = rect.x; x <= rect.x + rect.width; x += CELL_SIZE) {
      for (let y = rect.y; y <= rect.y + rect.height; y += CELL_SIZE) {
        for (const other of this.cells.get(keyForCell(x, y)) ?? []) {
          if (seen.has(other)) continue;
          seen.add(other);
          if (
            rect.x < other.x + other.width &&
            rect.x + rect.width > other.x &&
            rect.y < other.y + other.height &&
            rect.y + rect.height > other.y
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }
}

function withinCanvas(rect: Rect, canvas: LayoutStyle["canvas"]): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= canvas.width &&
    rect.y + rect.height <= canvas.height
  );
}

function metricFor(
  term: string,
  metrics: FontMetricsTable,
): { width: number; height: number } {
  return (
    metrics.words[term] ?? {
      width: Math.max(8, term.length * metrics.baseFontSize * 0.58),
      height: metrics.baseFontSize,
    }
  );
}

function makeUnplaceable(
  word: Word,
  fontSize: number,
  size: { width: number; height: number },
  color: string,
  reason: SceneWord["reason"],
): SceneWord {
  return {
    term: word.term,
    count: word.count,
    rank: word.rank,
    locale: word.locale,
    fontSize,
    angle: 0,
    x: 0,
    y: 0,
    width: quantize(size.width),
    height: quantize(size.height),
    color,
    status:
      reason === "probe-budget" || reason === "cancelled"
        ? "budget-limited"
        : "unplaceable",
    reason,
  };
}

export function layoutWordCloud(
  wordSet: WordSet,
  style: LayoutStyle,
  metrics: FontMetricsTable,
  options: LayoutOptions = {},
): SceneModel {
  const maxProbes = Math.min(
    options.maxProbes ?? LIMITS.maxLayoutProbes ?? 100_000,
    100_000,
  );
  const maxLayoutMs = options.maxLayoutMs ?? 2_000;
  const startedAt = globalThis.performance?.now() ?? 0;
  const palette = style.palette.length > 0 ? style.palette : ["#111111"];
  const counts = wordSet.words.map((word) => word.count);
  const minimum = Math.min(...counts, 0);
  const maximum = Math.max(...counts, 0);
  const generator = random(hashSeed(style.seed));
  const grid = new SpatialGrid();
  const words: SceneWord[] = [];
  let probes = 0;
  let layoutStatus: SceneModel["layoutStatus"] = "complete";

  for (const word of [...wordSet.words].sort((a, b) => a.rank - b.rank)) {
    const fontSize = mapFrequency(
      word.count,
      minimum,
      maximum,
      style.scale,
      style.minFontSize,
      style.maxFontSize,
    );
    const base = metricFor(word.term, metrics);
    const scale = fontSize / metrics.baseFontSize;
    const baseSize = { width: base.width * scale, height: base.height * scale };
    const color = palette[(word.rank - 1) % palette.length];
    const angle =
      style.rotations.length > 0
        ? style.rotations[Math.floor(generator() * style.rotations.length)]
        : 0;
    const size = rotatedSize(
      baseSize.width + style.padding * 2,
      baseSize.height + style.padding * 2,
      angle,
    );

    if (
      style.canvas.width <= 0 ||
      style.canvas.height <= 0 ||
      style.canvas.width > 4096 ||
      style.canvas.height > 4096 ||
      style.canvas.width * style.canvas.height > 16_000_000
    ) {
      words.push(
        makeUnplaceable(word, fontSize, size, color, "invalid-canvas"),
      );
      layoutStatus = "budget-limited";
      continue;
    }

    let placed: Rect | undefined;
    for (let probe = 0; probe < maxProbes; probe += 1) {
      probes += 1;
      if (options.shouldCancel?.()) {
        words.push(makeUnplaceable(word, fontSize, size, color, "cancelled"));
        layoutStatus = "cancelled";
        break;
      }
      if (
        probes > 100_000 ||
        (globalThis.performance?.now() ?? 0) - startedAt > maxLayoutMs
      ) {
        words.push(
          makeUnplaceable(word, fontSize, size, color, "probe-budget"),
        );
        layoutStatus = "budget-limited";
        break;
      }
      const radius = 3 + probe * 1.35;
      const theta = probe * 0.37 + (word.rank % 3) * 0.11;
      const centerX = style.canvas.width / 2 + Math.cos(theta) * radius;
      const centerY = style.canvas.height / 2 + Math.sin(theta) * radius * 0.72;
      const rect: Rect = {
        x: quantize(centerX - size.width / 2),
        y: quantize(centerY - size.height / 2),
        width: quantize(size.width),
        height: quantize(size.height),
      };
      if (withinCanvas(rect, style.canvas) && !grid.collides(rect)) {
        placed = rect;
        break;
      }
    }

    if (layoutStatus === "cancelled" || layoutStatus === "budget-limited") {
      continue;
    }
    if (!placed) {
      words.push(makeUnplaceable(word, fontSize, size, color, "no-fit"));
      continue;
    }
    grid.add(placed);
    words.push({
      term: word.term,
      count: word.count,
      rank: word.rank,
      locale: word.locale,
      fontSize,
      angle,
      x: placed.x,
      y: placed.y,
      width: placed.width,
      height: placed.height,
      color,
      status: "placed",
    });
  }

  return {
    version: SCENE_VERSION,
    layoutVersion: style.version,
    canvas: { ...style.canvas },
    background: style.background,
    fontFamily: style.fontFamily,
    fontMetricsFingerprint: metricsFingerprint(metrics),
    seed: style.seed,
    layoutStatus,
    words,
  };
}

export async function layoutWordCloudAsync(
  wordSet: WordSet,
  style: LayoutStyle,
  metrics: FontMetricsTable,
  options: LayoutOptions = {},
): Promise<SceneModel> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return layoutWordCloud(wordSet, style, metrics, options);
}
