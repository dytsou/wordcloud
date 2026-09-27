import { LIMITS } from "./limits";
import { GlyphGrid } from "./glyph-grid";
import {
  compileShapeMask,
  type CompiledShapeMask,
  type ShapeSettings,
} from "./shapes";
import { safeBackground, safeFontFamily, safePalette } from "./style-safety";
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
  shape?: ShapeSettings;
}

export interface LayoutOptions {
  maxProbes?: number;
  maxLayoutMs?: number;
  shouldCancel?: () => boolean;
  maxShapeFitSpans?: number;
  maxShapeFitSpansPerCandidate?: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OrientedRect {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  angle: number;
}

interface GridEntry {
  bounds: Rect;
  shape: OrientedRect;
  seenAt: number;
}

interface WordPlacement {
  visual: Rect;
  collision: Rect;
  shape: OrientedRect;
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

function quantizeBound(value: number): number {
  return Math.ceil(value * 2) / 2;
}

export function mapFrequency(
  count: number,
  minimum: number,
  maximum: number,
  scale: FrequencyScale,
  minFontSize: number,
  maxFontSize: number,
): number {
  if (minimum === maximum) return quantize(minFontSize);
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
  if (normalized === 0) return { width, height };
  if (normalized === 90) return { width: height, height: width };
  const radians = (normalized * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return {
    width: width * cosine + height * sine,
    height: width * sine + height * cosine,
  };
}

function clampAngle(angle: number): number {
  return Math.max(-120, Math.min(120, Number.isFinite(angle) ? angle : 0));
}

export function rotationCandidates(
  rotations: number[],
  enabled: boolean,
): number[] {
  if (!enabled) return [0];
  const configured = new Set<number>();
  for (const rotation of rotations) {
    const angle = clampAngle(rotation);
    if (angle !== 0) configured.add(angle);
  }
  return [
    0,
    ...[...configured].sort(
      (first, second) => Math.abs(first) - Math.abs(second) || first - second,
    ),
  ];
}

function orientedRectsCollide(
  first: OrientedRect,
  second: OrientedRect,
): boolean {
  const firstRadians = (first.angle * Math.PI) / 180;
  const secondRadians = (second.angle * Math.PI) / 180;
  const firstCosine = Math.cos(firstRadians);
  const firstSine = Math.sin(firstRadians);
  const secondCosine = Math.cos(secondRadians);
  const secondSine = Math.sin(secondRadians);
  const distanceX = second.centerX - first.centerX;
  const distanceY = second.centerY - first.centerY;
  const overlapsOnAxis = (axisX: number, axisY: number) => {
    const firstRadius =
      Math.abs(axisX * firstCosine + axisY * firstSine) * first.width * 0.5 +
      Math.abs(axisX * -firstSine + axisY * firstCosine) * first.height * 0.5;
    const secondRadius =
      Math.abs(axisX * secondCosine + axisY * secondSine) * second.width * 0.5 +
      Math.abs(axisX * -secondSine + axisY * secondCosine) *
        second.height *
        0.5;
    return (
      Math.abs(distanceX * axisX + distanceY * axisY) <
      firstRadius + secondRadius
    );
  };
  return (
    overlapsOnAxis(firstCosine, firstSine) &&
    overlapsOnAxis(-firstSine, firstCosine) &&
    overlapsOnAxis(secondCosine, secondSine) &&
    overlapsOnAxis(-secondSine, secondCosine)
  );
}

function orientedRectFor(rect: Rect): OrientedRect {
  return {
    centerX: rect.x + rect.width * 0.5,
    centerY: rect.y + rect.height * 0.5,
    width: rect.width,
    height: rect.height,
    angle: 0,
  };
}

function keyForCell(x: number, y: number): string {
  return `${x}:${y}`;
}

export class SpatialGrid {
  private readonly cells = new Map<string, GridEntry[]>();
  private queryId = 0;

  add(rect: Rect, shape: OrientedRect = orientedRectFor(rect)): void {
    const entry = { bounds: rect, shape, seenAt: 0 };
    const minX = Math.floor(rect.x / CELL_SIZE);
    const maxX = Math.floor((rect.x + rect.width) / CELL_SIZE);
    const minY = Math.floor(rect.y / CELL_SIZE);
    const maxY = Math.floor((rect.y + rect.height) / CELL_SIZE);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = keyForCell(x, y);
        const values = this.cells.get(key) ?? [];
        values.push(entry);
        this.cells.set(key, values);
      }
    }
  }

  collides(rect: Rect, shape: OrientedRect = orientedRectFor(rect)): boolean {
    const queryId = (this.queryId += 1);
    const minX = Math.floor(rect.x / CELL_SIZE);
    const maxX = Math.floor((rect.x + rect.width) / CELL_SIZE);
    const minY = Math.floor(rect.y / CELL_SIZE);
    const maxY = Math.floor((rect.y + rect.height) / CELL_SIZE);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (const entry of this.cells.get(keyForCell(x, y)) ?? []) {
          if (entry.seenAt === queryId) continue;
          entry.seenAt = queryId;
          const other = entry.bounds;
          if (
            rect.x < other.x + other.width &&
            rect.x + rect.width > other.x &&
            rect.y < other.y + other.height &&
            rect.y + rect.height > other.y &&
            (shape.angle === 0 && entry.shape.angle === 0
              ? true
              : orientedRectsCollide(shape, entry.shape))
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
  const renderWidth = Math.min(
    LIMITS.maxCanvasDimension,
    Math.max(0, quantize(size.width)),
  );
  const renderHeight = Math.min(
    LIMITS.maxCanvasDimension,
    Math.max(0, quantize(size.height)),
  );
  return {
    term: word.term,
    count: word.count,
    rank: word.rank,
    locale: word.locale,
    fontSize,
    angle: 0,
    x: 0,
    y: 0,
    width: renderWidth,
    height: renderHeight,
    color,
    status:
      reason === "probe-budget" || reason === "cancelled"
        ? "budget-limited"
        : "unplaceable",
    reason,
  };
}

function makeWordPlacement(
  centerX: number,
  centerY: number,
  visualSize: { width: number; height: number },
  collisionSize: { width: number; height: number },
  collisionShape: { width: number; height: number },
  angle: number,
): WordPlacement {
  const collision: Rect = {
    x: quantize(centerX - collisionSize.width * 0.5),
    y: quantize(centerY - collisionSize.height * 0.5),
    width: Math.max(1, quantizeBound(collisionSize.width)),
    height: Math.max(1, quantizeBound(collisionSize.height)),
  };
  const actualCenterX = collision.x + collision.width * 0.5;
  const actualCenterY = collision.y + collision.height * 0.5;
  const visual: Rect = {
    x: quantize(actualCenterX - visualSize.width * 0.5),
    y: quantize(actualCenterY - visualSize.height * 0.5),
    width: Math.max(1, quantizeBound(visualSize.width)),
    height: Math.max(1, quantizeBound(visualSize.height)),
  };
  return {
    visual,
    collision,
    shape: {
      centerX: actualCenterX,
      centerY: actualCenterY,
      width: collisionShape.width,
      height: collisionShape.height,
      angle,
    },
  };
}

type ShapeFitResult = "inside" | "outside" | "probe-budget" | "cancelled";

interface ShapeFitWork {
  checked: number;
  maxLayoutSpans: number;
  maxCandidateSpans: number;
}

function checkShapeFootprint(
  mask: CompiledShapeMask,
  visual: Rect,
  inkSpans: Uint16Array | undefined,
  work: ShapeFitWork,
  options: LayoutOptions,
): ShapeFitResult {
  const hasInkSpans = Boolean(inkSpans?.length);
  const firstRow = Math.floor(visual.y);
  const lastRow = Math.ceil(visual.y + visual.height);
  const rectangleSpanCount = Math.max(0, lastRow - firstRow);
  const spanCount = hasInkSpans
    ? Math.floor((inkSpans?.length ?? 0) / 3)
    : rectangleSpanCount;

  if (
    (hasInkSpans && (inkSpans?.length ?? 0) % 3 !== 0) ||
    spanCount > work.maxCandidateSpans
  ) {
    return "probe-budget";
  }

  const chunkSize = LIMITS.shapeFitCheckChunkSize;
  const xStart = Math.floor(visual.x);
  const xEnd = Math.ceil(visual.x + visual.width);
  for (let index = 0; index < spanCount; index++) {
    if (index % chunkSize === 0 && options.shouldCancel?.()) return "cancelled";
    if (work.checked >= work.maxLayoutSpans) return "probe-budget";
    work.checked++;

    let row = firstRow + index;
    let start = xStart;
    let end = xEnd;
    if (hasInkSpans) {
      const offset = index * 3;
      row = Math.floor(visual.y) + (inkSpans?.[offset] ?? -1);
      start = Math.floor(visual.x) + (inkSpans?.[offset + 1] ?? -1);
      end = Math.floor(visual.x) + (inkSpans?.[offset + 2] ?? -1);
      if (
        row < Math.floor(visual.y) ||
        row >= Math.ceil(visual.y + visual.height) ||
        start < Math.floor(visual.x) ||
        end > Math.ceil(visual.x + visual.width) ||
        end <= start
      ) {
        return "outside";
      }
    }
    if (!mask.containsSpan(row, start, end)) return "outside";
  }
  return "inside";
}

function* layoutWordCloudSteps(
  wordSet: WordSet,
  style: LayoutStyle,
  metrics: FontMetricsTable,
  options: LayoutOptions = {},
): Generator<void, SceneModel, void> {
  const maxLayoutMs = options.maxLayoutMs ?? 8_000;
  const startedAt = globalThis.performance?.now() ?? 0;
  const palette = safePalette(style.palette);
  const counts = wordSet.words.map((word) => word.count);
  const minimum = Math.min(...counts);
  const maximum = Math.max(...counts);
  const generator = random(hashSeed(style.seed));
  const seedPhase = generator() * Math.PI * 2;
  const grid = new SpatialGrid();
  const placedRects: Rect[] = [];
  const words: SceneWord[] = [];
  const padding = Number.isFinite(style.padding)
    ? Math.max(LIMITS.minPadding, Math.min(LIMITS.maxPadding, style.padding))
    : 0;
  let probes = 0;
  let layoutStatus: SceneModel["layoutStatus"] = "complete";
  const invalidCanvas =
    style.canvas.width <= 0 ||
    style.canvas.height <= 0 ||
    style.canvas.width > LIMITS.maxCanvasDimension ||
    style.canvas.height > LIMITS.maxCanvasDimension ||
    style.canvas.width * style.canvas.height > LIMITS.maxExportPixels;
  const shapeMask =
    style.shape && !invalidCanvas
      ? compileShapeMask(style.shape, style.canvas)
      : undefined;
  const requestedLayoutSpanLimit = options.maxShapeFitSpans;
  const requestedCandidateSpanLimit = options.maxShapeFitSpansPerCandidate;
  const shapeWork: ShapeFitWork = {
    checked: 0,
    maxLayoutSpans:
      requestedLayoutSpanLimit === undefined ||
      !Number.isFinite(requestedLayoutSpanLimit)
        ? LIMITS.maxShapeFitSpansPerLayout
        : Math.max(
            0,
            Math.min(
              LIMITS.maxShapeFitSpansPerLayout,
              Math.floor(requestedLayoutSpanLimit),
            ),
          ),
    maxCandidateSpans:
      requestedCandidateSpanLimit === undefined ||
      !Number.isFinite(requestedCandidateSpanLimit)
        ? LIMITS.maxShapeFitSpansPerCandidate
        : Math.max(
            0,
            Math.min(
              LIMITS.maxShapeFitSpansPerCandidate,
              Math.floor(requestedCandidateSpanLimit),
            ),
          ),
  };
  const glyphGrid =
    metrics.sprites && !invalidCanvas
      ? new GlyphGrid(style.canvas.width, style.canvas.height)
      : undefined;

  for (const word of [...wordSet.words].sort((a, b) => a.rank - b.rank)) {
    const remainingWords = Math.max(1, wordSet.words.length - words.length);
    const fairShare = shapeMask
      ? Math.max(
          1,
          Math.floor((LIMITS.maxLayoutProbes - probes) / remainingWords),
        )
      : Math.max(
          1,
          Math.floor(
            LIMITS.maxLayoutProbes / Math.max(1, wordSet.words.length),
          ),
        );
    const maxProbes = Math.min(
      options.maxProbes ?? 2_000,
      fairShare,
      LIMITS.maxLayoutProbes,
    );
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
    const baseSize = {
      width: base.width * scale + fontSize * 0.2,
      height: Math.max(base.height * scale, fontSize * 1.5),
    };
    const color = palette[(word.rank - 1) % palette.length];
    const horizontalSize = rotatedSize(baseSize.width, baseSize.height, 0);

    if (options.shouldCancel?.()) {
      words.push(
        makeUnplaceable(word, fontSize, horizontalSize, color, "cancelled"),
      );
      layoutStatus = "cancelled";
      continue;
    }

    if (invalidCanvas) {
      words.push(
        makeUnplaceable(
          word,
          fontSize,
          horizontalSize,
          color,
          "invalid-canvas",
        ),
      );
      layoutStatus = "budget-limited";
      continue;
    }

    if (shapeMask && shapeWork.checked >= shapeWork.maxLayoutSpans) {
      words.push(
        makeUnplaceable(word, fontSize, horizontalSize, color, "probe-budget"),
      );
      layoutStatus = "budget-limited";
      continue;
    }

    const fontRange = Math.max(0, style.maxFontSize - style.minFontSize);
    const rotationEligible =
      fontRange === 0
        ? word.rank > Math.ceil(wordSet.words.length * 0.6)
        : fontSize <= style.minFontSize + fontRange * 0.42;
    const configuredAngles = rotationCandidates(
      style.rotations,
      rotationEligible,
    );
    // For small glyphs, try tilting inside the current ring before moving outward.
    const angles =
      glyphGrid && configuredAngles.length > 1
        ? Array.from({ length: 3 }, () => configuredAngles).flat()
        : configuredAngles;
    const probesPerAngle = angles.map((_, index) => {
      const baseBudget = Math.floor(maxProbes / angles.length);
      return baseBudget + (index < maxProbes % angles.length ? 1 : 0);
    });
    const collisionShape = {
      width: Math.max(1, baseSize.width + padding * 2),
      height: Math.max(1, baseSize.height + padding * 2),
    };
    let placed: WordPlacement | undefined;
    let renderSize = horizontalSize;
    let terminalReason: "probe-budget" | "cancelled" | undefined;

    for (const [angleIndex, selectedAngle] of angles.entries()) {
      if (placed || terminalReason) break;
      const angle = clampAngle(selectedAngle);
      const sprite = metrics.sprites?.[word.term]?.[angle];
      const visualSize =
        sprite ?? rotatedSize(baseSize.width, baseSize.height, angle);
      const collisionSize =
        sprite ??
        rotatedSize(collisionShape.width, collisionShape.height, angle);
      renderSize = visualSize;
      const fitWidth = Math.max(visualSize.width, collisionSize.width);
      const fitHeight = Math.max(visualSize.height, collisionSize.height);
      if (fitWidth > style.canvas.width || fitHeight > style.canvas.height)
        continue;

      const angleBudget = probesPerAngle[angleIndex] ?? 0;
      let angleProbes = 0;
      const tryPlacement = (candidateX: number, candidateY: number) => {
        const candidate = makeWordPlacement(
          candidateX,
          candidateY,
          visualSize,
          collisionSize,
          collisionShape,
          angle,
        );
        if (sprite) {
          candidate.visual.x = Math.round(candidateX - sprite.width / 2);
          candidate.visual.y = Math.round(candidateY - sprite.height / 2);
          candidate.collision = { ...candidate.visual };
          candidate.shape.centerX = candidate.visual.x + sprite.width / 2;
          candidate.shape.centerY = candidate.visual.y + sprite.height / 2;
        }
        if (
          !withinCanvas(candidate.visual, style.canvas) ||
          !withinCanvas(candidate.collision, style.canvas)
        ) {
          return;
        }
        if (
          glyphGrid && sprite
            ? glyphGrid.collides(sprite, candidate.visual.x, candidate.visual.y)
            : grid.collides(candidate.collision, candidate.shape)
        ) {
          return;
        }
        if (shapeMask) {
          const shapeFit = checkShapeFootprint(
            shapeMask,
            candidate.visual,
            sprite?.inkSpans,
            shapeWork,
            options,
          );
          if (shapeFit === "cancelled") {
            terminalReason = "cancelled";
            return;
          }
          if (shapeFit === "probe-budget") {
            terminalReason = "probe-budget";
            return;
          }
          if (shapeFit === "outside") return;
        }
        placed = candidate;
      };
      const checkBudget = () => {
        if (options.shouldCancel?.()) return "cancelled" as const;
        if (
          probes >= LIMITS.maxLayoutProbes ||
          (globalThis.performance?.now() ?? 0) - startedAt > maxLayoutMs
        ) {
          return "probe-budget" as const;
        }
        return undefined;
      };

      if (!shapeMask && !glyphGrid && placedRects.length > 0) {
        const canvasCenterX = style.canvas.width / 2;
        const canvasCenterY = style.canvas.height / 2;
        const candidates = placedRects.slice(0, 64).flatMap((other) => {
          const otherCenterX = other.x + other.width / 2;
          const otherCenterY = other.y + other.height / 2;
          return [
            [otherCenterX, other.y - collisionSize.height / 2],
            [otherCenterX, other.y + other.height + collisionSize.height / 2],
            [other.x - collisionSize.width / 2, otherCenterY],
            [other.x + other.width + collisionSize.width / 2, otherCenterY],
          ];
        });
        candidates.sort(([firstX, firstY], [secondX, secondY]) => {
          const firstRadius =
            (firstX - canvasCenterX) ** 2 + (firstY - canvasCenterY) ** 2;
          const secondRadius =
            (secondX - canvasCenterX) ** 2 + (secondY - canvasCenterY) ** 2;
          return firstRadius - secondRadius;
        });
        for (const [centerX, centerY] of candidates.slice(
          0,
          Math.min(256, angleBudget),
        )) {
          probes += 1;
          angleProbes += 1;
          const reason = checkBudget();
          if (reason) {
            terminalReason = reason;
            break;
          }
          tryPlacement(centerX, centerY);
          yield;
          if (placed || terminalReason) break;
        }
      }

      for (
        let probe = 0;
        !placed && !terminalReason && angleProbes < angleBudget;
        probe += 1
      ) {
        probes += 1;
        angleProbes += 1;
        const reason = checkBudget();
        if (reason) {
          terminalReason = reason;
          break;
        }
        let centerX: number;
        let centerY: number;
        if (shapeMask && wordSet.words.length === 1 && probe === 0) {
          centerX = style.canvas.width / 2;
          centerY = style.canvas.height / 2;
        } else if (shapeMask) {
          // Smaller words trace the silhouette before falling back to its
          // interior. Each contour target is retried with increasing inset so
          // sloped or concave edges can still accept a whole glyph.
          const contourBudget = Math.min(256, Math.floor(angleBudget / 3));
          const contourRetries = angleBudget < 512 ? 2 : 4;
          const traceBoundary =
            word.rank > Math.ceil(wordSet.words.length * 0.25) &&
            probe < contourBudget;
          const contourProbe = traceBoundary
            ? Math.floor(probe / contourRetries)
            : probe;
          const sample =
            word.rank - 1 + (contourProbe + angleIndex * angleBudget) * 97;
          const yFraction =
            (sample * 0.618033988749895 + seedPhase / (Math.PI * 2)) % 1;
          const xFraction =
            (sample * 0.754877666246693 + seedPhase / Math.PI) % 1;
          centerY =
            shapeMask.bounds.y +
            fitHeight / 2 +
            yFraction * Math.max(0, shapeMask.bounds.height - fitHeight);
          const spans = shapeMask.rows[Math.floor(centerY)] ?? [];
          const rowWidth = spans.reduce(
            (total, span) => total + span.end - span.start,
            0,
          );
          let offset = xFraction * rowWidth;
          let selectedSpan = spans[0];
          for (const span of spans) {
            selectedSpan = span;
            if (offset < span.end - span.start) break;
            offset -= span.end - span.start;
          }
          if (selectedSpan) {
            const spanWidth = selectedSpan.end - selectedSpan.start;
            const room = Math.max(0, spanWidth - fitWidth);
            const inset = Math.min(
              room / 2,
              (probe % contourRetries) * Math.min(12, fitHeight / 4),
            );
            const withinSpan = traceBoundary
              ? (word.rank + contourProbe) % 2 === 0
                ? inset
                : room - inset
              : (offset / spanWidth) * room;
            centerX = selectedSpan.start + fitWidth / 2 + withinSpan;
          } else {
            centerX = shapeMask.bounds.x + shapeMask.bounds.width / 2;
          }
        } else {
          // A dense, evenly distributed ellipse probes interior holes before the perimeter.
          const band = Math.floor(angleIndex / configuredAngles.length);
          const radialProbe =
            (probe + band * angleBudget) * configuredAngles.length;
          const radius = glyphGrid
            ? Math.sqrt(radialProbe) * 9
            : 3 + Math.sqrt(probe) * 10;
          const theta =
            probe * (glyphGrid ? 2.399963229728653 : 0.37) +
            (word.rank % 3) * 0.11 +
            seedPhase;
          centerX = style.canvas.width / 2 + Math.cos(theta) * radius;
          centerY = style.canvas.height / 2 + Math.sin(theta) * radius * 0.72;
        }
        tryPlacement(centerX, centerY);
        yield;
      }
    }

    if (terminalReason) {
      words.push(
        makeUnplaceable(word, fontSize, renderSize, color, terminalReason),
      );
      layoutStatus =
        terminalReason === "cancelled" ? "cancelled" : "budget-limited";
      continue;
    }
    if (!placed) {
      words.push(makeUnplaceable(word, fontSize, renderSize, color, "no-fit"));
      continue;
    }
    grid.add(placed.collision, placed.shape);
    const placedSprite = metrics.sprites?.[word.term]?.[placed.shape.angle];
    if (glyphGrid && placedSprite)
      glyphGrid.add(placedSprite, placed.visual.x, placed.visual.y);
    placedRects.push(placed.collision);
    words.push({
      term: word.term,
      count: word.count,
      rank: word.rank,
      locale: word.locale,
      fontSize,
      angle: placed.shape.angle,
      x: placed.visual.x,
      y: placed.visual.y,
      width: placed.visual.width,
      height: placed.visual.height,
      color,
      status: "placed",
    });
  }

  return {
    version: SCENE_VERSION,
    layoutVersion: style.version,
    canvas: { ...style.canvas },
    background: safeBackground(style.background),
    fontFamily: safeFontFamily(style.fontFamily),
    fontMetricsFingerprint: metricsFingerprint(metrics),
    seed: style.seed,
    layoutStatus,
    ...(style.shape ? { shape: { ...style.shape } } : {}),
    words,
  };
}

export function layoutWordCloud(
  wordSet: WordSet,
  style: LayoutStyle,
  metrics: FontMetricsTable,
  options: LayoutOptions = {},
): SceneModel {
  const steps = layoutWordCloudSteps(wordSet, style, metrics, options);
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}

export async function layoutWordCloudAsync(
  wordSet: WordSet,
  style: LayoutStyle,
  metrics: FontMetricsTable,
  options: LayoutOptions = {},
): Promise<SceneModel> {
  const steps = layoutWordCloudSteps(wordSet, style, metrics, options);
  let result = steps.next();
  let yieldedSteps = 0;
  while (!result.done) {
    yieldedSteps += 1;
    if (yieldedSteps % 256 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    result = steps.next();
  }
  return result.value;
}
