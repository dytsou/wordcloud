export const MIN_SHAPE_SCALE = 0.2;
export const MAX_SHAPE_SCALE = 1;

export const SHAPE_CATEGORIES = [
  "basic",
  "symbols",
  "nature",
  "animals",
  "everyday",
] as const;

export type ShapeCategory = (typeof SHAPE_CATEGORIES)[number];
export type Point = readonly [x: number, y: number];

type EllipseRegion = {
  kind: "ellipse";
  center: Point;
  radiusX: number;
  radiusY: number;
};

type PolygonRegion = {
  kind: "polygon";
  points: readonly Point[];
};

type Region = EllipseRegion | PolygonRegion;

export interface BuiltInShape {
  id: string;
  category: ShapeCategory;
  /** Native width divided by native height. */
  aspectRatio: number;
  regions: readonly Region[];
  holes?: readonly Region[];
}

export type BuiltInShapeId = (typeof BUILT_IN_SHAPES)[number]["id"];

export interface ShapeSettings {
  id: BuiltInShapeId;
  widthScale: number;
  heightScale: number;
}

export interface MaskSpan {
  start: number;
  end: number;
}

export interface CompiledShapeMask {
  bounds: { x: number; y: number; width: number; height: number };
  rows: readonly (readonly MaskSpan[])[];
  containsPoint(x: number, y: number): boolean;
  containsSpan(y: number, start: number, end: number): boolean;
}

function ellipse(
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY = radiusX,
): EllipseRegion {
  return { kind: "ellipse", center: [centerX, centerY], radiusX, radiusY };
}

function polygon(...points: Point[]): PolygonRegion {
  return { kind: "polygon", points };
}

function starPoints(count: number, innerRadius: number): Point[] {
  return Array.from({ length: count * 2 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / count;
    const radius = index % 2 === 0 ? 0.48 : innerRadius;
    return [0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius];
  });
}

export const BUILT_IN_SHAPES = [
  {
    id: "circle",
    category: "basic",
    aspectRatio: 1,
    regions: [ellipse(0.5, 0.5, 0.48)],
  },
  {
    id: "ellipse",
    category: "basic",
    aspectRatio: 1.45,
    regions: [ellipse(0.5, 0.5, 0.48, 0.48)],
  },
  {
    id: "square",
    category: "basic",
    aspectRatio: 1,
    regions: [polygon([0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95])],
  },
  {
    id: "rectangle",
    category: "basic",
    aspectRatio: 1.4,
    regions: [polygon([0.03, 0.12], [0.97, 0.12], [0.97, 0.88], [0.03, 0.88])],
  },
  {
    id: "triangle",
    category: "basic",
    aspectRatio: 1,
    regions: [polygon([0.5, 0.025], [0.98, 0.96], [0.02, 0.96])],
  },
  {
    id: "diamond",
    category: "basic",
    aspectRatio: 1,
    regions: [polygon([0.5, 0.02], [0.98, 0.5], [0.5, 0.98], [0.02, 0.5])],
  },
  {
    id: "hexagon",
    category: "basic",
    aspectRatio: 1.12,
    regions: [
      polygon(
        [0.26, 0.035],
        [0.74, 0.035],
        [0.98, 0.5],
        [0.74, 0.965],
        [0.26, 0.965],
        [0.02, 0.5],
      ),
    ],
  },
  {
    id: "star",
    category: "basic",
    aspectRatio: 1,
    regions: [polygon(...starPoints(5, 0.21))],
  },
  {
    id: "heart",
    category: "symbols",
    aspectRatio: 1,
    regions: [
      polygon(
        [0.5, 0.94],
        [0.08, 0.55],
        [0.025, 0.45],
        [0.025, 0.32],
        [0.1, 0.2],
        [0.23, 0.14],
        [0.36, 0.19],
        [0.5, 0.32],
        [0.64, 0.19],
        [0.77, 0.14],
        [0.9, 0.2],
        [0.975, 0.32],
        [0.975, 0.45],
        [0.92, 0.55],
      ),
    ],
  },
  {
    id: "speech-bubble",
    category: "symbols",
    aspectRatio: 1.28,
    regions: [
      polygon(
        [0.07, 0.08],
        [0.93, 0.08],
        [0.93, 0.75],
        [0.61, 0.75],
        [0.39, 0.96],
        [0.39, 0.75],
        [0.07, 0.75],
      ),
    ],
  },
  {
    id: "crescent-moon",
    category: "symbols",
    aspectRatio: 1,
    regions: [ellipse(0.46, 0.5, 0.46, 0.47)],
    holes: [ellipse(0.66, 0.37, 0.38, 0.4)],
  },
  {
    id: "lightning-bolt",
    category: "symbols",
    aspectRatio: 0.78,
    regions: [
      polygon(
        [0.57, 0.015],
        [0.1, 0.55],
        [0.39, 0.55],
        [0.27, 0.985],
        [0.9, 0.35],
        [0.58, 0.35],
      ),
    ],
  },
  {
    id: "music-note",
    category: "symbols",
    aspectRatio: 0.82,
    regions: [
      polygon([0.56, 0.06], [0.92, 0.02], [0.92, 0.64], [0.56, 0.69]),
      ellipse(0.31, 0.78, 0.23, 0.17),
    ],
  },
  {
    id: "smiling-face",
    category: "symbols",
    aspectRatio: 1,
    regions: [ellipse(0.5, 0.5, 0.48)],
    holes: [
      ellipse(0.34, 0.37, 0.055, 0.085),
      ellipse(0.66, 0.37, 0.055, 0.085),
      polygon(
        [0.25, 0.59],
        [0.34, 0.61],
        [0.42, 0.7],
        [0.5, 0.73],
        [0.58, 0.7],
        [0.66, 0.61],
        [0.75, 0.59],
        [0.7, 0.76],
        [0.6, 0.84],
        [0.5, 0.87],
        [0.4, 0.84],
        [0.3, 0.76],
      ),
    ],
  },
  {
    id: "cloud",
    category: "nature",
    aspectRatio: 1.35,
    regions: [
      ellipse(0.29, 0.59, 0.23, 0.29),
      ellipse(0.5, 0.39, 0.31, 0.37),
      ellipse(0.74, 0.57, 0.22, 0.26),
      polygon([0.1, 0.61], [0.9, 0.61], [0.9, 0.84], [0.1, 0.84]),
    ],
  },
  {
    id: "sun",
    category: "nature",
    aspectRatio: 1,
    regions: [polygon(...starPoints(12, 0.37))],
  },
  {
    id: "flower",
    category: "nature",
    aspectRatio: 1,
    regions: [
      ellipse(0.5, 0.22, 0.18, 0.21),
      ellipse(0.74, 0.36, 0.18, 0.21),
      ellipse(0.74, 0.64, 0.18, 0.21),
      ellipse(0.5, 0.78, 0.18, 0.21),
      ellipse(0.26, 0.64, 0.18, 0.21),
      ellipse(0.26, 0.36, 0.18, 0.21),
      ellipse(0.5, 0.5, 0.2, 0.2),
    ],
  },
  {
    id: "leaf",
    category: "nature",
    aspectRatio: 0.82,
    regions: [
      polygon(
        [0.5, 0.03],
        [0.75, 0.13],
        [0.92, 0.33],
        [0.97, 0.5],
        [0.83, 0.74],
        [0.58, 0.91],
        [0.5, 0.98],
        [0.42, 0.91],
        [0.17, 0.74],
        [0.03, 0.5],
        [0.08, 0.33],
        [0.25, 0.13],
      ),
    ],
  },
  {
    id: "mountain",
    category: "nature",
    aspectRatio: 1.35,
    regions: [
      polygon(
        [0.02, 0.94],
        [0.3, 0.39],
        [0.45, 0.62],
        [0.68, 0.12],
        [0.98, 0.94],
      ),
    ],
  },
  {
    id: "wave",
    category: "nature",
    aspectRatio: 1.45,
    regions: [
      polygon(
        [0.02, 0.25],
        [0.2, 0.14],
        [0.38, 0.22],
        [0.57, 0.34],
        [0.76, 0.37],
        [0.98, 0.27],
        [0.98, 0.94],
        [0.02, 0.94],
      ),
    ],
  },
  {
    id: "cat",
    category: "animals",
    aspectRatio: 0.9,
    regions: [
      polygon(
        [0.1, 0.3],
        [0.08, 0.04],
        [0.35, 0.2],
        [0.5, 0.16],
        [0.65, 0.2],
        [0.92, 0.04],
        [0.9, 0.3],
        [0.97, 0.48],
        [0.92, 0.72],
        [0.78, 0.88],
        [0.5, 0.96],
        [0.22, 0.88],
        [0.08, 0.72],
        [0.03, 0.48],
      ),
    ],
  },
  {
    id: "dog",
    category: "animals",
    aspectRatio: 1.2,
    regions: [
      ellipse(0.5, 0.55, 0.34, 0.39),
      ellipse(0.18, 0.53, 0.15, 0.3),
      ellipse(0.82, 0.53, 0.15, 0.3),
    ],
    holes: [ellipse(0.5, 0.67, 0.075, 0.06)],
  },
  {
    id: "bird",
    category: "animals",
    aspectRatio: 1.22,
    regions: [
      ellipse(0.46, 0.52, 0.37, 0.27),
      polygon([0.75, 0.39], [0.99, 0.5], [0.75, 0.61]),
      polygon([0.31, 0.68], [0.44, 0.69], [0.24, 0.95]),
      polygon([0.5, 0.68], [0.61, 0.67], [0.63, 0.94]),
    ],
    holes: [ellipse(0.68, 0.47, 0.035, 0.035)],
  },
  {
    id: "fish",
    category: "animals",
    aspectRatio: 1.55,
    regions: [
      ellipse(0.43, 0.5, 0.39, 0.32),
      polygon([0.76, 0.5], [0.99, 0.24], [0.99, 0.76]),
    ],
    holes: [ellipse(0.22, 0.43, 0.035, 0.045)],
  },
  {
    id: "butterfly",
    category: "animals",
    aspectRatio: 1.3,
    regions: [
      ellipse(0.29, 0.31, 0.25, 0.26),
      ellipse(0.71, 0.31, 0.25, 0.26),
      ellipse(0.3, 0.69, 0.22, 0.24),
      ellipse(0.7, 0.69, 0.22, 0.24),
      polygon(
        [0.46, 0.12],
        [0.54, 0.12],
        [0.57, 0.87],
        [0.5, 0.98],
        [0.43, 0.87],
      ),
    ],
  },
  {
    id: "house",
    category: "everyday",
    aspectRatio: 1.12,
    regions: [
      polygon(
        [0.04, 0.43],
        [0.5, 0.035],
        [0.96, 0.43],
        [0.88, 0.5],
        [0.88, 0.96],
        [0.12, 0.96],
        [0.12, 0.5],
      ),
    ],
    holes: [
      polygon([0.4, 0.65], [0.6, 0.65], [0.6, 0.96], [0.4, 0.96]),
      polygon([0.2, 0.54], [0.35, 0.54], [0.35, 0.68], [0.2, 0.68]),
      polygon([0.65, 0.54], [0.8, 0.54], [0.8, 0.68], [0.65, 0.68]),
    ],
  },
  {
    id: "book",
    category: "everyday",
    aspectRatio: 1.22,
    regions: [
      polygon(
        [0.04, 0.09],
        [0.45, 0.17],
        [0.5, 0.22],
        [0.55, 0.17],
        [0.96, 0.09],
        [0.96, 0.91],
        [0.55, 0.84],
        [0.5, 0.9],
        [0.45, 0.84],
        [0.04, 0.91],
      ),
    ],
    holes: [polygon([0.49, 0.23], [0.51, 0.23], [0.51, 0.86], [0.49, 0.86])],
  },
  {
    id: "light-bulb",
    category: "everyday",
    aspectRatio: 0.9,
    regions: [
      ellipse(0.5, 0.37, 0.35, 0.34),
      polygon([0.29, 0.58], [0.71, 0.58], [0.66, 0.77], [0.34, 0.77]),
      polygon([0.36, 0.79], [0.64, 0.79], [0.61, 0.88], [0.39, 0.88]),
      polygon([0.4, 0.91], [0.6, 0.91], [0.57, 0.98], [0.43, 0.98]),
    ],
  },
  {
    id: "trophy",
    category: "everyday",
    aspectRatio: 0.92,
    regions: [
      polygon(
        [0.23, 0.06],
        [0.77, 0.06],
        [0.72, 0.49],
        [0.62, 0.67],
        [0.38, 0.67],
        [0.28, 0.49],
      ),
      polygon(
        [0.38, 0.68],
        [0.62, 0.68],
        [0.62, 0.84],
        [0.75, 0.84],
        [0.75, 0.95],
        [0.25, 0.95],
        [0.25, 0.84],
        [0.38, 0.84],
      ),
      polygon(
        [0.23, 0.13],
        [0.1, 0.13],
        [0.1, 0.35],
        [0.29, 0.48],
        [0.3, 0.37],
        [0.18, 0.3],
        [0.18, 0.23],
        [0.24, 0.23],
      ),
      polygon(
        [0.77, 0.13],
        [0.9, 0.13],
        [0.9, 0.35],
        [0.71, 0.48],
        [0.7, 0.37],
        [0.82, 0.3],
        [0.82, 0.23],
        [0.76, 0.23],
      ),
    ],
  },
  {
    id: "game-controller",
    category: "everyday",
    aspectRatio: 1.42,
    regions: [
      polygon(
        [0.2, 0.25],
        [0.8, 0.25],
        [0.91, 0.35],
        [0.99, 0.77],
        [0.92, 0.9],
        [0.81, 0.91],
        [0.64, 0.7],
        [0.36, 0.7],
        [0.19, 0.91],
        [0.08, 0.9],
        [0.01, 0.77],
        [0.09, 0.35],
      ),
    ],
    holes: [
      polygon([0.2, 0.42], [0.27, 0.42], [0.27, 0.59], [0.2, 0.59]),
      polygon([0.15, 0.47], [0.32, 0.47], [0.32, 0.54], [0.15, 0.54]),
      ellipse(0.7, 0.43, 0.045),
      ellipse(0.82, 0.54, 0.045),
    ],
  },
] as const satisfies readonly BuiltInShape[];

type CatalogShape = BuiltInShape & { id: BuiltInShapeId };

const SHAPE_BY_ID = new Map<string, CatalogShape>(
  BUILT_IN_SHAPES.map((shape) => [shape.id, shape]),
);

export function getBuiltInShape(id: string): CatalogShape | undefined {
  return SHAPE_BY_ID.get(id);
}

function primitiveIntervalsAtY(region: Region, y: number): MaskSpan[] {
  if (region.kind === "ellipse") {
    const [centerX, centerY] = region.center;
    const relativeY = (y - centerY) / region.radiusY;
    if (Math.abs(relativeY) > 1) return [];
    const halfWidth = region.radiusX * Math.sqrt(1 - relativeY * relativeY);
    return [{ start: centerX - halfWidth, end: centerX + halfWidth }];
  }

  const intersections: number[] = [];
  for (let index = 0; index < region.points.length; index++) {
    const first = region.points[index];
    const second = region.points[(index + 1) % region.points.length];
    if (!first || !second) continue;
    const [firstX, firstY] = first;
    const [secondX, secondY] = second;
    if ((firstY <= y && y < secondY) || (secondY <= y && y < firstY)) {
      const progress = (y - firstY) / (secondY - firstY);
      intersections.push(firstX + (secondX - firstX) * progress);
    }
  }
  intersections.sort((left, right) => left - right);
  const spans: MaskSpan[] = [];
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    const start = intersections[index];
    const end = intersections[index + 1];
    if (start !== undefined && end !== undefined && end > start)
      spans.push({ start, end });
  }
  return spans;
}

function mergeSpans(spans: readonly MaskSpan[]): MaskSpan[] {
  const sorted = [...spans].sort((left, right) => left.start - right.start);
  const merged: MaskSpan[] = [];
  for (const span of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || span.start > previous.end) {
      merged.push({ ...span });
    } else {
      previous.end = Math.max(previous.end, span.end);
    }
  }
  return merged;
}

function subtractSpans(
  base: readonly MaskSpan[],
  holes: readonly MaskSpan[],
): MaskSpan[] {
  let remaining = [...base];
  for (const hole of mergeSpans(holes)) {
    remaining = remaining.flatMap((span) => {
      if (hole.end <= span.start || hole.start >= span.end) return [span];
      const pieces: MaskSpan[] = [];
      if (hole.start > span.start)
        pieces.push({ start: span.start, end: Math.min(hole.start, span.end) });
      if (hole.end < span.end)
        pieces.push({ start: Math.max(hole.end, span.start), end: span.end });
      return pieces;
    });
  }
  return remaining;
}

export function compileShapeMask(
  settings: ShapeSettings,
  canvas: { width: number; height: number },
): CompiledShapeMask {
  const definition = getBuiltInShape(settings.id);
  if (!definition) throw new RangeError("Unknown built-in shape");
  if (
    !Number.isFinite(settings.widthScale) ||
    settings.widthScale < MIN_SHAPE_SCALE ||
    settings.widthScale > MAX_SHAPE_SCALE ||
    !Number.isFinite(settings.heightScale) ||
    settings.heightScale < MIN_SHAPE_SCALE ||
    settings.heightScale > MAX_SHAPE_SCALE
  ) {
    throw new RangeError("Shape scales must be between 0.2 and 1");
  }
  if (
    !Number.isInteger(canvas.width) ||
    !Number.isInteger(canvas.height) ||
    canvas.width <= 0 ||
    canvas.height <= 0
  ) {
    throw new RangeError("Canvas dimensions must be positive integers");
  }

  const baseWidth = Math.min(
    canvas.width,
    canvas.height * definition.aspectRatio,
  );
  const baseHeight = baseWidth / definition.aspectRatio;
  const width = baseWidth * settings.widthScale;
  const height = baseHeight * settings.heightScale;
  const x = (canvas.width - width) / 2;
  const y = (canvas.height - height) / 2;
  const rows: MaskSpan[][] = Array.from({ length: canvas.height }, () => []);
  const epsilon = 1e-9;

  for (let row = 0; row < canvas.height; row++) {
    const normalizedY = (row + 0.5 - y) / height;
    if (normalizedY < 0 || normalizedY > 1) continue;
    const regions = mergeSpans(
      definition.regions.flatMap((region) =>
        primitiveIntervalsAtY(region, normalizedY),
      ),
    );
    const holes = definition.holes?.flatMap((hole) =>
      primitiveIntervalsAtY(hole, normalizedY),
    );
    const inside = holes ? subtractSpans(regions, holes) : regions;
    for (const span of inside) {
      const start = Math.max(
        0,
        Math.ceil(x + span.start * width - 0.5 - epsilon),
      );
      const end = Math.min(
        canvas.width,
        Math.floor(x + span.end * width - 0.5 + epsilon) + 1,
      );
      if (end > start) rows[row]?.push({ start, end });
    }
  }

  const containsSpan = (row: number, start: number, end: number): boolean => {
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      row < 0 ||
      row >= rows.length ||
      start < 0 ||
      end <= start ||
      end > canvas.width
    ) {
      return false;
    }
    return (rows[row] ?? []).some(
      (span) => start >= span.start && end <= span.end,
    );
  };

  return {
    bounds: { x, y, width, height },
    rows,
    containsPoint(pointX, pointY) {
      if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) return false;
      return containsSpan(
        Math.floor(pointY),
        Math.floor(pointX),
        Math.floor(pointX) + 1,
      );
    },
    containsSpan,
  };
}

export function recommendShapeFontRange(
  settings: ShapeSettings,
  canvas: { width: number; height: number },
  wordCount: number,
): { minFontSize: number; maxFontSize: number } {
  const mask = compileShapeMask(settings, canvas);
  const usableArea = mask.rows.reduce(
    (area, spans) =>
      area + spans.reduce((row, span) => row + span.end - span.start, 0),
    0,
  );
  // Allow enough small words to describe narrow edges and cutouts even when
  // the source contains only a few terms.
  const targetWords = Math.max(24, wordCount);
  const maxFontSize = Math.max(
    24,
    Math.min(128, Math.round(0.75 * Math.sqrt(usableArea / targetWords))),
  );
  return {
    minFontSize: Math.max(8, Math.min(16, Math.round(maxFontSize / 8))),
    maxFontSize,
  };
}
