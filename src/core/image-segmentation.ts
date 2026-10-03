import {
  type ImageRect,
  type RasterImage,
  validateRasterImage,
} from "./image-shape";

export interface ImagePoint {
  x: number;
  y: number;
}
export interface MaskStroke {
  points: readonly ImagePoint[];
  radius: number;
  mode: "keep" | "remove";
}
export interface SubjectSelection {
  box?: ImageRect;
  keep?: readonly ImagePoint[];
  remove?: readonly ImagePoint[];
  /** Immutable manual marks: 1 foreground, -1 background, 0 unmarked. */
  seeds?: Int8Array;
  seedRadius?: number;
}

function validPoint(point: ImagePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function visitStroke(
  width: number,
  height: number,
  stroke: MaskStroke,
  visit: (index: number) => void,
): void {
  if (
    !Number.isFinite(stroke.radius) ||
    stroke.radius < 0.5 ||
    stroke.radius > 48 ||
    stroke.points.length > 4096 ||
    stroke.points.some((point) => !validPoint(point)) ||
    (stroke.mode !== "keep" && stroke.mode !== "remove")
  ) {
    throw new RangeError("Invalid foreground brush stroke.");
  }
  const circle = (x: number, y: number) => {
    for (
      let row = Math.max(0, Math.floor(y - stroke.radius));
      row <= Math.min(height - 1, Math.ceil(y + stroke.radius));
      row += 1
    ) {
      for (
        let column = Math.max(0, Math.floor(x - stroke.radius));
        column <= Math.min(width - 1, Math.ceil(x + stroke.radius));
        column += 1
      ) {
        if ((column - x) ** 2 + (row - y) ** 2 <= stroke.radius ** 2)
          visit(row * width + column);
      }
    }
  };
  stroke.points.forEach((point, index) => {
    const previous = stroke.points[index - 1] ?? point;
    const steps = Math.min(
      768,
      Math.max(
        1,
        Math.ceil(
          Math.hypot(point.x - previous.x, point.y - previous.y) /
            Math.max(1, stroke.radius / 2),
        ),
      ),
    );
    for (let step = 0; step <= steps; step += 1)
      circle(
        previous.x + ((point.x - previous.x) * step) / steps,
        previous.y + ((point.y - previous.y) * step) / steps,
      );
  });
}

export function paintMask(
  mask: Uint8Array,
  width: number,
  height: number,
  stroke: MaskStroke,
): Uint8Array {
  if (
    mask.length !== width * height ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 192 ||
    height > 192
  ) {
    throw new RangeError(
      "Foreground mask does not match bounded image dimensions.",
    );
  }
  const result = mask.slice();
  visitStroke(width, height, stroke, (index) => {
    result[index] = Number(stroke.mode === "keep");
  });
  return result;
}

export function paintSeeds(
  seeds: Int8Array,
  width: number,
  height: number,
  stroke: MaskStroke,
): Int8Array {
  if (
    seeds.length !== width * height ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 192 ||
    height > 192
  ) {
    throw new RangeError(
      "Subject marks do not match bounded image dimensions.",
    );
  }
  const result = seeds.slice();
  visitStroke(width, height, stroke, (index) => {
    result[index] = stroke.mode === "keep" ? 1 : -1;
  });
  return result;
}

function forNeighbors(
  index: number,
  width: number,
  length: number,
  visit: (neighbor: number) => void,
): void {
  if (index % width > 0) visit(index - 1);
  if (index % width < width - 1) visit(index + 1);
  if (index >= width) visit(index - width);
  if (index + width < length) visit(index + width);
}

/** Transparency wins over color, so opaque white subject pixels remain selected. */
export function detectForeground(
  raster: RasterImage,
  tolerance = 24,
  includeEnclosedBackground = false,
): Uint8Array {
  validateRasterImage(raster);
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100) {
    throw new RangeError("Background tolerance must be between 0 and 100.");
  }
  const area = raster.width * raster.height;
  const mask = new Uint8Array(area);
  let transparent = false;
  for (let index = 0; index < area; index += 1) {
    mask[index] = Number(raster.rgba[index * 4 + 3] >= 16);
    if (raster.rgba[index * 4 + 3] < 250) transparent = true;
  }
  if (transparent) return mask;
  const border: number[] = [];
  for (let index = 0; index < area; index += 1) {
    if (
      index < raster.width ||
      index >= area - raster.width ||
      index % raster.width === 0 ||
      index % raster.width === raster.width - 1
    )
      border.push(index);
  }
  const clusters = new Map<number, { count: number; sums: number[] }>();
  border.forEach((index) => {
    const offset = index * 4;
    const color = [
      raster.rgba[offset],
      raster.rgba[offset + 1],
      raster.rgba[offset + 2],
    ];
    const key =
      ((color[0] >>> 4) << 8) | ((color[1] >>> 4) << 4) | (color[2] >>> 4);
    const cluster = clusters.get(key) ?? { count: 0, sums: [0, 0, 0] };
    cluster.count += 1;
    color.forEach((value, channel) => {
      cluster.sums[channel] += value;
    });
    clusters.set(key, cluster);
  });
  const dominant = [...clusters.values()].sort((a, b) => b.count - a.count)[0];
  const background = dominant.sums.map((sum) => sum / dominant.count);
  const matches = (index: number) =>
    background.reduce(
      (sum, channel, component) =>
        sum + (raster.rgba[index * 4 + component] - channel) ** 2,
      0,
    ) <=
    tolerance ** 2 * 3;
  if (includeEnclosedBackground) {
    mask.forEach((_value, index) => {
      if (matches(index)) mask[index] = 0;
    });
    return mask;
  }
  const queue = new Uint32Array(area);
  let end = 0;
  const enqueue = (index: number) => {
    if (mask[index] && matches(index)) {
      mask[index] = 0;
      queue[end++] = index;
    }
  };
  border.forEach(enqueue);
  for (let cursor = 0; cursor < end; cursor += 1)
    forNeighbors(queue[cursor], raster.width, area, enqueue);
  return mask;
}

/** Indexed heap keeps propagation memory bounded to one queue entry per pixel. */
class PixelQueue {
  private readonly heap: Uint32Array;
  private readonly positions: Int32Array;
  private length = 0;
  constructor(private readonly costs: Float64Array) {
    this.heap = new Uint32Array(costs.length);
    this.positions = new Int32Array(costs.length).fill(-1);
  }
  private swap(a: number, b: number): void {
    const first = this.heap[a];
    this.heap[a] = this.heap[b];
    this.heap[b] = first;
    this.positions[this.heap[a]] = a;
    this.positions[first] = b;
  }
  offer(pixel: number): void {
    let index = this.positions[pixel];
    if (index === -2) return;
    if (index < 0) {
      index = this.length++;
      this.heap[index] = pixel;
      this.positions[pixel] = index;
    }
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.costs[this.heap[parent]] <= this.costs[pixel]) break;
      this.swap(parent, index);
      index = parent;
    }
  }
  take(): number | undefined {
    if (this.length === 0) return undefined;
    const pixel = this.heap[0];
    this.positions[pixel] = -2;
    this.length -= 1;
    if (this.length === 0) return pixel;
    this.heap[0] = this.heap[this.length];
    this.positions[this.heap[0]] = 0;
    let index = 0;
    while (index * 2 + 1 < this.length) {
      const left = index * 2 + 1;
      const right = left + 1;
      const child =
        right < this.length &&
        this.costs[this.heap[right]] < this.costs[this.heap[left]]
          ? right
          : left;
      if (this.costs[this.heap[index]] <= this.costs[this.heap[child]]) break;
      this.swap(index, child);
      index = child;
    }
    return pixel;
  }
}

function subjectSeeds(
  raster: RasterImage,
  selection: SubjectSelection,
): Int8Array {
  const area = raster.width * raster.height;
  const seeds = new Int8Array(area);
  const box = selection.box;
  if (
    box &&
    (!validPoint(box) ||
      !Number.isFinite(box.width) ||
      !Number.isFinite(box.height) ||
      box.width <= 0 ||
      box.height <= 0 ||
      box.x >= raster.width ||
      box.y >= raster.height ||
      box.x + box.width <= 0 ||
      box.y + box.height <= 0)
  ) {
    throw new RangeError("Subject selection box must intersect the image.");
  }
  for (let index = 0; index < area; index += 1) {
    const x = index % raster.width;
    const y = Math.floor(index / raster.width);
    const outside =
      x === 0 ||
      y === 0 ||
      x === raster.width - 1 ||
      y === raster.height - 1 ||
      (box !== undefined &&
        (x < box.x ||
          y < box.y ||
          x >= box.x + box.width ||
          y >= box.y + box.height));
    if (outside) seeds[index] = -1;
  }
  if (selection.seeds) {
    if (
      !(selection.seeds instanceof Int8Array) ||
      selection.seeds.length !== area ||
      selection.seeds.some(
        (value) => value !== -1 && value !== 0 && value !== 1,
      )
    ) {
      throw new RangeError("Subject marks contain invalid pixel labels.");
    }
    selection.seeds.forEach((value, index) => {
      if (value !== 0) seeds[index] = value;
    });
  }
  const radius = selection.seedRadius ?? 2;
  for (const [points, mode] of [
    [selection.keep ?? [], "keep"],
    [selection.remove ?? [], "remove"],
  ] as const) {
    // Separate points are individual seeds, rather than a line connecting subjects.
    if (points.length > 4096)
      throw new RangeError("Too many subject selection points.");
    points.forEach((point) =>
      visitStroke(
        raster.width,
        raster.height,
        { points: [point], radius, mode },
        (index) => {
          seeds[index] = mode === "keep" ? 1 : -1;
        },
      ),
    );
  }
  if (!seeds.some((value) => value === 1) && box) {
    const x = Math.max(
      0,
      Math.min(raster.width - 1, Math.floor(box.x + box.width / 2)),
    );
    const y = Math.max(
      0,
      Math.min(raster.height - 1, Math.floor(box.y + box.height / 2)),
    );
    let chosen = -1;
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < area; index += 1) {
      const column = index % raster.width;
      const row = Math.floor(index / raster.width);
      const distance = (column - x) ** 2 + (row - y) ** 2;
      if (
        seeds[index] === 0 &&
        raster.rgba[index * 4 + 3] >= 16 &&
        distance < nearest &&
        column >= box.x &&
        row >= box.y &&
        column < box.x + box.width &&
        row < box.y + box.height
      ) {
        nearest = distance;
        chosen = index;
      }
    }
    if (chosen >= 0) seeds[chosen] = 1;
  }
  if (!seeds.some((value) => value === 1)) {
    throw new RangeError(
      "Mark a foreground point or draw a subject selection box first.",
    );
  }
  for (let index = 0; index < area; index += 1)
    if (raster.rgba[index * 4 + 3] < 16) seeds[index] = -1;
  return seeds;
}

/**
 * Multi-source geodesic competition: color edges weaken seed propagation.
 * This is a bounded, priority-queue variant of interactive region competition,
 * not a semantic model. Foreground/background marks are immutable constraints.
 * Related interactive seed principle: Vezhnevets and Konouchine, GrowCut (2005),
 * https://www.graphicon.ru/html/2005/proceedings/papers/VezhntvetsKonushin.pdf
 */
export function segmentSubject(
  raster: RasterImage,
  selection: SubjectSelection,
): Uint8Array {
  validateRasterImage(raster);
  const seeds = subjectSeeds(raster, selection);
  const labels = seeds.slice();
  const costs = new Float64Array(seeds.length).fill(Number.POSITIVE_INFINITY);
  const queue = new PixelQueue(costs);
  seeds.forEach((seed, index) => {
    if (seed !== 0) {
      costs[index] = 0;
      queue.offer(index);
    }
  });
  let pixel = queue.take();
  while (pixel !== undefined) {
    const source = pixel;
    forNeighbors(source, raster.width, seeds.length, (neighbor) => {
      if (seeds[neighbor] !== 0) return;
      let difference = 0;
      for (let channel = 0; channel < 3; channel += 1)
        difference +=
          (raster.rgba[source * 4 + channel] -
            raster.rgba[neighbor * 4 + channel]) **
          2;
      const cost = costs[source] + 0.002 + (difference / (3 * 255 ** 2)) * 8;
      if (cost < costs[neighbor]) {
        costs[neighbor] = cost;
        labels[neighbor] = labels[source];
        queue.offer(neighbor);
      }
    });
    pixel = queue.take();
  }
  return Uint8Array.from(labels, (label) => Number(label === 1));
}
