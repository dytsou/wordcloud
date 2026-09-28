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
import type { FontMetricsTable, GlyphSprite } from "./metrics";
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
  let mapped: number;
  switch (scale) {
    case "linear":
      mapped = ratio;
      break;
    case "log":
      mapped = Math.log1p(ratio * 9) / Math.log(10);
      break;
    case "sqrt":
      mapped = Math.sqrt(ratio);
      break;
  }
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
          if (collidesWithEntry(rect, shape, entry)) return true;
        }
      }
    }
    return false;
  }
}

function collidesWithEntry(
  rect: Rect,
  shape: OrientedRect,
  entry: GridEntry,
): boolean {
  const other = entry.bounds;
  const overlaps =
    rect.x < other.x + other.width &&
    rect.x + rect.width > other.x &&
    rect.y < other.y + other.height &&
    rect.y + rect.height > other.y;
  if (!overlaps) return false;
  if (shape.angle === 0 && entry.shape.angle === 0) return true;
  return orientedRectsCollide(shape, entry.shape);
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

interface ShapeSpan {
  row: number;
  start: number;
  end: number;
}

function shapeSpanForIndex(
  visual: Rect,
  inkSpans: Uint16Array | undefined,
  index: number,
  firstRow: number,
  xStart: number,
  xEnd: number,
): ShapeSpan | undefined {
  if (!inkSpans) return { row: firstRow + index, start: xStart, end: xEnd };
  const offset = index * 3;
  const row = Math.floor(visual.y) + (inkSpans[offset] ?? -1);
  const start = Math.floor(visual.x) + (inkSpans[offset + 1] ?? -1);
  const end = Math.floor(visual.x) + (inkSpans[offset + 2] ?? -1);
  if (
    row < Math.floor(visual.y) ||
    row >= Math.ceil(visual.y + visual.height) ||
    start < Math.floor(visual.x) ||
    end > Math.ceil(visual.x + visual.width) ||
    end <= start
  ) {
    return undefined;
  }
  return { row, start, end };
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
    const span = shapeSpanForIndex(
      visual,
      hasInkSpans ? inkSpans : undefined,
      index,
      firstRow,
      xStart,
      xEnd,
    );
    if (!span || !mask.containsSpan(span.row, span.start, span.end))
      return "outside";
  }
  return "inside";
}

interface LayoutContext {
  wordSet: WordSet;
  style: LayoutStyle;
  metrics: FontMetricsTable;
  options: LayoutOptions;
  maxLayoutMs: number;
  startedAt: number;
  palette: string[];
  minimum: number;
  maximum: number;
  seedPhase: number;
  grid: SpatialGrid;
  placedRects: Rect[];
  words: SceneWord[];
  padding: number;
  invalidCanvas: boolean;
  shapeMask: CompiledShapeMask | undefined;
  shapeWork: ShapeFitWork;
  glyphGrid: GlyphGrid | undefined;
  probes: number;
  layoutStatus: SceneModel["layoutStatus"];
}

interface PreparedWord {
  word: Word;
  fontSize: number;
  color: string;
  baseSize: { width: number; height: number };
  horizontalSize: { width: number; height: number };
  collisionShape: { width: number; height: number };
  maxProbes: number;
  angles: number[];
  probesPerAngle: number[];
}

interface AnglePlan {
  angle: number;
  sprite: GlyphSprite | undefined;
  visualSize: { width: number; height: number };
  collisionSize: { width: number; height: number };
  fitWidth: number;
  fitHeight: number;
}

interface CandidateAttempt {
  placement?: WordPlacement;
  terminalReason?: "probe-budget" | "cancelled";
}

interface PlacementSearchResult extends CandidateAttempt {
  renderSize: { width: number; height: number };
}

type CandidatePoint = readonly [number, number];
type ShapeRowSpan = CompiledShapeMask["rows"][number][number];

function layoutCanvasIsInvalid(style: LayoutStyle): boolean {
  return (
    style.canvas.width <= 0 ||
    style.canvas.height <= 0 ||
    style.canvas.width > LIMITS.maxCanvasDimension ||
    style.canvas.height > LIMITS.maxCanvasDimension ||
    style.canvas.width * style.canvas.height > LIMITS.maxExportPixels
  );
}

function shapeSpanLimit(
  requested: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (requested === undefined || !Number.isFinite(requested)) return fallback;
  return Math.max(0, Math.min(maximum, Math.floor(requested)));
}

function createLayoutContext(
  wordSet: WordSet,
  style: LayoutStyle,
  metrics: FontMetricsTable,
  options: LayoutOptions,
): LayoutContext {
  const counts = wordSet.words.map((word) => word.count);
  const invalidCanvas = layoutCanvasIsInvalid(style);
  const requestedLayoutSpanLimit = options.maxShapeFitSpans;
  const requestedCandidateSpanLimit = options.maxShapeFitSpansPerCandidate;
  return {
    wordSet,
    style,
    metrics,
    options,
    maxLayoutMs: options.maxLayoutMs ?? 8_000,
    startedAt: globalThis.performance?.now() ?? 0,
    palette: safePalette(style.palette),
    minimum: Math.min(...counts),
    maximum: Math.max(...counts),
    seedPhase: random(hashSeed(style.seed))() * Math.PI * 2,
    grid: new SpatialGrid(),
    placedRects: [],
    words: [],
    padding: Number.isFinite(style.padding)
      ? Math.max(LIMITS.minPadding, Math.min(LIMITS.maxPadding, style.padding))
      : 0,
    invalidCanvas,
    shapeMask:
      style.shape && !invalidCanvas
        ? compileShapeMask(style.shape, style.canvas)
        : undefined,
    shapeWork: {
      checked: 0,
      maxLayoutSpans: shapeSpanLimit(
        requestedLayoutSpanLimit,
        LIMITS.maxShapeFitSpansPerLayout,
        LIMITS.maxShapeFitSpansPerLayout,
      ),
      maxCandidateSpans: shapeSpanLimit(
        requestedCandidateSpanLimit,
        LIMITS.maxShapeFitSpansPerCandidate,
        LIMITS.maxShapeFitSpansPerCandidate,
      ),
    },
    glyphGrid:
      metrics.sprites && !invalidCanvas
        ? new GlyphGrid(style.canvas.width, style.canvas.height)
        : undefined,
    probes: 0,
    layoutStatus: "complete",
  };
}

function rotationEligible(
  word: Word,
  wordCount: number,
  fontSize: number,
  style: LayoutStyle,
): boolean {
  const fontRange = Math.max(0, style.maxFontSize - style.minFontSize);
  if (fontRange === 0) return word.rank > Math.ceil(wordCount * 0.6);
  return fontSize <= style.minFontSize + fontRange * 0.42;
}

function prepareWord(word: Word, context: LayoutContext): PreparedWord {
  const remainingWords = Math.max(
    1,
    context.wordSet.words.length - context.words.length,
  );
  const fairShare = context.shapeMask
    ? Math.max(
        1,
        Math.floor((LIMITS.maxLayoutProbes - context.probes) / remainingWords),
      )
    : Math.max(
        1,
        Math.floor(
          LIMITS.maxLayoutProbes / Math.max(1, context.wordSet.words.length),
        ),
      );
  const maxProbes = Math.min(
    context.options.maxProbes ?? 2_000,
    fairShare,
    LIMITS.maxLayoutProbes,
  );
  const fontSize = mapFrequency(
    word.count,
    context.minimum,
    context.maximum,
    context.style.scale,
    context.style.minFontSize,
    context.style.maxFontSize,
  );
  const base = metricFor(word.term, context.metrics);
  const scale = fontSize / context.metrics.baseFontSize;
  const baseSize = {
    width: base.width * scale + fontSize * 0.2,
    height: Math.max(base.height * scale, fontSize * 1.5),
  };
  const color = context.palette[(word.rank - 1) % context.palette.length];
  const horizontalSize = rotatedSize(baseSize.width, baseSize.height, 0);
  const configuredAngles = rotationCandidates(
    context.style.rotations,
    rotationEligible(
      word,
      context.wordSet.words.length,
      fontSize,
      context.style,
    ),
  );
  const angles =
    context.glyphGrid && configuredAngles.length > 1
      ? Array.from({ length: 3 }, () => configuredAngles).flat()
      : configuredAngles;
  const probesPerAngle = angles.map((_, index) => {
    const baseBudget = Math.floor(maxProbes / angles.length);
    return baseBudget + (index < maxProbes % angles.length ? 1 : 0);
  });
  const collisionShape = {
    width: Math.max(1, baseSize.width + context.padding * 2),
    height: Math.max(1, baseSize.height + context.padding * 2),
  };
  return {
    word,
    fontSize,
    color,
    baseSize,
    horizontalSize,
    collisionShape,
    maxProbes,
    angles,
    probesPerAngle,
  };
}

function unavailableReason(
  context: LayoutContext,
): "cancelled" | "invalid-canvas" | "probe-budget" | undefined {
  if (context.options.shouldCancel?.()) return "cancelled";
  if (context.invalidCanvas) return "invalid-canvas";
  if (
    context.shapeMask &&
    context.shapeWork.checked >= context.shapeWork.maxLayoutSpans
  ) {
    return "probe-budget";
  }
  return undefined;
}

function markLayoutLimited(
  context: LayoutContext,
  reason: "cancelled" | "invalid-canvas" | "probe-budget",
): void {
  context.layoutStatus =
    reason === "cancelled" ? "cancelled" : "budget-limited";
}

function anglePlan(
  prepared: PreparedWord,
  angleValue: number,
  context: LayoutContext,
): AnglePlan {
  const angle = clampAngle(angleValue);
  const sprite = context.metrics.sprites?.[prepared.word.term]?.[angle];
  const visualSize =
    sprite ??
    rotatedSize(prepared.baseSize.width, prepared.baseSize.height, angle);
  const collisionSize =
    sprite ??
    rotatedSize(
      prepared.collisionShape.width,
      prepared.collisionShape.height,
      angle,
    );
  return {
    angle,
    sprite,
    visualSize,
    collisionSize,
    fitWidth: Math.max(visualSize.width, collisionSize.width),
    fitHeight: Math.max(visualSize.height, collisionSize.height),
  };
}

function placementBudgetFailure(
  context: LayoutContext,
): "probe-budget" | "cancelled" | undefined {
  if (context.options.shouldCancel?.()) return "cancelled";
  if (
    context.probes >= LIMITS.maxLayoutProbes ||
    (globalThis.performance?.now() ?? 0) - context.startedAt >
      context.maxLayoutMs
  ) {
    return "probe-budget";
  }
  return undefined;
}

function nearbyCandidatePoints(
  context: LayoutContext,
  collisionSize: { width: number; height: number },
  angleBudget: number,
): CandidatePoint[] {
  if (
    context.shapeMask ||
    context.glyphGrid ||
    context.placedRects.length === 0
  ) {
    return [];
  }
  const canvasCenterX = context.style.canvas.width / 2;
  const canvasCenterY = context.style.canvas.height / 2;
  const candidates: CandidatePoint[] = context.placedRects
    .slice(0, 64)
    .flatMap((other): CandidatePoint[] => {
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
  return candidates.slice(0, Math.min(256, angleBudget));
}

function attemptPlacement(
  prepared: PreparedWord,
  plan: AnglePlan,
  candidateX: number,
  candidateY: number,
  context: LayoutContext,
): CandidateAttempt {
  const candidate = makeWordPlacement(
    candidateX,
    candidateY,
    plan.visualSize,
    plan.collisionSize,
    prepared.collisionShape,
    plan.angle,
  );
  if (plan.sprite) {
    candidate.visual.x = Math.round(candidateX - plan.sprite.width / 2);
    candidate.visual.y = Math.round(candidateY - plan.sprite.height / 2);
    candidate.collision = { ...candidate.visual };
    candidate.shape.centerX = candidate.visual.x + plan.sprite.width / 2;
    candidate.shape.centerY = candidate.visual.y + plan.sprite.height / 2;
  }
  if (
    !withinCanvas(candidate.visual, context.style.canvas) ||
    !withinCanvas(candidate.collision, context.style.canvas)
  ) {
    return {};
  }
  let collides: boolean;
  if (context.glyphGrid && plan.sprite) {
    collides = context.glyphGrid.collides(
      plan.sprite,
      candidate.visual.x,
      candidate.visual.y,
    );
  } else {
    collides = context.grid.collides(candidate.collision, candidate.shape);
  }
  if (collides) return {};
  if (context.shapeMask) {
    const shapeFit = checkShapeFootprint(
      context.shapeMask,
      candidate.visual,
      plan.sprite?.inkSpans,
      context.shapeWork,
      context.options,
    );
    if (shapeFit === "cancelled" || shapeFit === "probe-budget") {
      return { terminalReason: shapeFit };
    }
    if (shapeFit === "outside") return {};
  }
  return { placement: candidate };
}

function findMaskSpan(
  spans: readonly ShapeRowSpan[],
  offset: number,
): { span: ShapeRowSpan | undefined; remaining: number } {
  let selected = spans[0];
  let remaining = offset;
  for (const span of spans) {
    selected = span;
    const spanWidth = span.end - span.start;
    if (remaining < spanWidth) return { span: selected, remaining };
    remaining -= spanWidth;
  }
  return { span: selected, remaining };
}

function withinShapeSpan(
  traceBoundary: boolean,
  word: Word,
  contourProbe: number,
  inset: number,
  room: number,
  offset: number,
  spanWidth: number,
): number {
  if (!traceBoundary) return (offset / spanWidth) * room;
  if ((word.rank + contourProbe) % 2 === 0) return inset;
  return room - inset;
}

function shapeCandidatePoint(
  prepared: PreparedWord,
  plan: AnglePlan,
  probe: number,
  angleIndex: number,
  angleBudget: number,
  context: LayoutContext,
): CandidatePoint {
  const mask = context.shapeMask;
  if (!mask)
    return [context.style.canvas.width / 2, context.style.canvas.height / 2];
  const contourBudget = Math.min(256, Math.floor(angleBudget / 3));
  const contourRetries = angleBudget < 512 ? 2 : 4;
  const traceBoundary =
    prepared.word.rank > Math.ceil(context.wordSet.words.length * 0.25) &&
    probe < contourBudget;
  const contourProbe = traceBoundary
    ? Math.floor(probe / contourRetries)
    : probe;
  const sample =
    prepared.word.rank - 1 + (contourProbe + angleIndex * angleBudget) * 97;
  const yFraction =
    (sample * 0.618033988749895 + context.seedPhase / (Math.PI * 2)) % 1;
  const xFraction =
    (sample * 0.754877666246693 + context.seedPhase / Math.PI) % 1;
  const centerY =
    mask.bounds.y +
    plan.fitHeight / 2 +
    yFraction * Math.max(0, mask.bounds.height - plan.fitHeight);
  const spans = mask.rows[Math.floor(centerY)] ?? [];
  const rowWidth = spans.reduce(
    (total, span) => total + span.end - span.start,
    0,
  );
  const selected = findMaskSpan(spans, xFraction * rowWidth);
  if (selected.span) {
    const spanWidth = selected.span.end - selected.span.start;
    const room = Math.max(0, spanWidth - plan.fitWidth);
    const inset = Math.min(
      room / 2,
      (probe % contourRetries) * Math.min(12, plan.fitHeight / 4),
    );
    const within = withinShapeSpan(
      traceBoundary,
      prepared.word,
      contourProbe,
      inset,
      room,
      selected.remaining,
      spanWidth,
    );
    return [selected.span.start + plan.fitWidth / 2 + within, centerY];
  }
  return [mask.bounds.x + mask.bounds.width / 2, centerY];
}

function canvasCandidatePoint(
  prepared: PreparedWord,
  plan: AnglePlan,
  probe: number,
  angleIndex: number,
  angleBudget: number,
  context: LayoutContext,
): CandidatePoint {
  const radius = Math.sqrt((probe + 0.5) / angleBudget);
  const theta =
    probe * 2.399963229728653 +
    angleIndex * 1.618033988749895 +
    prepared.word.rank * 0.618033988749895 +
    context.seedPhase;
  const centerX =
    context.style.canvas.width / 2 +
    Math.cos(theta) *
      ((context.style.canvas.width - plan.fitWidth) / 2) *
      radius;
  const centerY =
    context.style.canvas.height / 2 +
    Math.sin(theta) *
      ((context.style.canvas.height - plan.fitHeight) / 2) *
      radius;
  return [centerX, centerY];
}

function probeCandidatePoint(
  prepared: PreparedWord,
  plan: AnglePlan,
  probe: number,
  angleIndex: number,
  angleBudget: number,
  context: LayoutContext,
): CandidatePoint {
  if (context.shapeMask && context.wordSet.words.length === 1 && probe === 0) {
    return [context.style.canvas.width / 2, context.style.canvas.height / 2];
  }
  if (context.shapeMask) {
    return shapeCandidatePoint(
      prepared,
      plan,
      probe,
      angleIndex,
      angleBudget,
      context,
    );
  }
  return canvasCandidatePoint(
    prepared,
    plan,
    probe,
    angleIndex,
    angleBudget,
    context,
  );
}

function* searchAnglePlacementSteps(
  prepared: PreparedWord,
  plan: AnglePlan,
  angleIndex: number,
  angleBudget: number,
  context: LayoutContext,
): Generator<void, PlacementSearchResult, void> {
  let placement: WordPlacement | undefined;
  let terminalReason: "probe-budget" | "cancelled" | undefined;
  const renderSize = plan.visualSize;
  let angleProbes = 0;
  const nearby = nearbyCandidatePoints(
    context,
    plan.collisionSize,
    angleBudget,
  );
  for (const [centerX, centerY] of nearby) {
    context.probes += 1;
    angleProbes += 1;
    const reason = placementBudgetFailure(context);
    if (reason) {
      terminalReason = reason;
      break;
    }
    const attempt = attemptPlacement(prepared, plan, centerX, centerY, context);
    placement = attempt.placement;
    terminalReason = attempt.terminalReason;
    yield;
    if (placement || terminalReason) break;
  }

  const remainingProbeCount = Math.max(0, angleBudget - angleProbes);
  for (
    let probe = 0;
    !placement && !terminalReason && probe < remainingProbeCount;
    probe += 1
  ) {
    context.probes += 1;
    angleProbes += 1;
    const reason = placementBudgetFailure(context);
    if (reason) {
      terminalReason = reason;
      break;
    }
    const [centerX, centerY] = probeCandidatePoint(
      prepared,
      plan,
      probe,
      angleIndex,
      angleBudget,
      context,
    );
    const attempt = attemptPlacement(prepared, plan, centerX, centerY, context);
    placement = attempt.placement;
    terminalReason = attempt.terminalReason;
    yield;
  }
  return { placement, terminalReason, renderSize };
}

function* searchWordPlacementSteps(
  prepared: PreparedWord,
  context: LayoutContext,
): Generator<void, PlacementSearchResult, void> {
  let renderSize = prepared.horizontalSize;
  for (
    let angleIndex = 0;
    angleIndex < prepared.angles.length;
    angleIndex += 1
  ) {
    const selectedAngle = prepared.angles[angleIndex];
    if (selectedAngle === undefined) continue;
    const plan = anglePlan(prepared, selectedAngle, context);
    renderSize = plan.visualSize;
    if (
      plan.fitWidth > context.style.canvas.width ||
      plan.fitHeight > context.style.canvas.height
    ) {
      continue;
    }
    const angleBudget = prepared.probesPerAngle[angleIndex] ?? 0;
    const result = yield* searchAnglePlacementSteps(
      prepared,
      plan,
      angleIndex,
      angleBudget,
      context,
    );
    if (result.placement || result.terminalReason) return result;
  }
  return { renderSize };
}

function commitPlacement(
  prepared: PreparedWord,
  placement: WordPlacement,
  context: LayoutContext,
): void {
  context.grid.add(placement.collision, placement.shape);
  const sprite =
    context.metrics.sprites?.[prepared.word.term]?.[placement.shape.angle];
  if (context.glyphGrid && sprite) {
    context.glyphGrid.add(sprite, placement.visual.x, placement.visual.y);
  }
  context.placedRects.push(placement.collision);
  context.words.push({
    term: prepared.word.term,
    count: prepared.word.count,
    rank: prepared.word.rank,
    locale: prepared.word.locale,
    fontSize: prepared.fontSize,
    angle: placement.shape.angle,
    x: placement.visual.x,
    y: placement.visual.y,
    width: placement.visual.width,
    height: placement.visual.height,
    color: prepared.color,
    status: "placed",
  });
}

function* layoutWordSteps(
  word: Word,
  context: LayoutContext,
): Generator<void, void, void> {
  const prepared = prepareWord(word, context);
  const reason = unavailableReason(context);
  if (reason) {
    context.words.push(
      makeUnplaceable(
        word,
        prepared.fontSize,
        prepared.horizontalSize,
        prepared.color,
        reason,
      ),
    );
    markLayoutLimited(context, reason);
    return;
  }

  const result = yield* searchWordPlacementSteps(prepared, context);
  if (result.terminalReason) {
    context.words.push(
      makeUnplaceable(
        word,
        prepared.fontSize,
        result.renderSize,
        prepared.color,
        result.terminalReason,
      ),
    );
    markLayoutLimited(context, result.terminalReason);
    return;
  }
  if (!result.placement) {
    context.words.push(
      makeUnplaceable(
        word,
        prepared.fontSize,
        result.renderSize,
        prepared.color,
        "no-fit",
      ),
    );
    return;
  }
  commitPlacement(prepared, result.placement, context);
}

function sceneFromContext(context: LayoutContext): SceneModel {
  const { style, metrics } = context;
  return {
    version: SCENE_VERSION,
    layoutVersion: style.version,
    canvas: { ...style.canvas },
    background: safeBackground(style.background),
    fontFamily: safeFontFamily(style.fontFamily),
    fontMetricsFingerprint: metricsFingerprint(metrics),
    seed: style.seed,
    layoutStatus: context.layoutStatus,
    ...(style.shape ? { shape: { ...style.shape } } : {}),
    words: context.words,
  };
}

function* layoutWordCloudSteps(
  wordSet: WordSet,
  style: LayoutStyle,
  metrics: FontMetricsTable,
  options: LayoutOptions = {},
): Generator<void, SceneModel, void> {
  const context = createLayoutContext(wordSet, style, metrics, options);
  const orderedWords = [...wordSet.words].sort(
    (left, right) => left.rank - right.rank,
  );
  for (const word of orderedWords) {
    yield* layoutWordSteps(word, context);
  }
  return sceneFromContext(context);
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
