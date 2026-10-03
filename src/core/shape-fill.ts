import type { SceneFillDot, SceneModel } from "./scene";
import { sceneWordColor } from "./scene";
import { compileShapeMask, type CompiledShapeMask } from "./shapes";

const DOT_RADIUS = 2.3;
// A period's visible ink fits within this conservative 5 × 5 pixel budget.
const DOT_AREA_BUDGET = 25;
const MAX_FILL_FRACTION = 0.02;

export function buildShapeFillDots(
  scene: SceneModel,
  compiledMask?: CompiledShapeMask,
): SceneFillDot[] {
  if (
    !scene.shape ||
    scene.words.length === 0 ||
    scene.words.some((word) => word.status !== "placed")
  ) {
    return [];
  }
  const shape = scene.shape;
  const mask = compiledMask ?? compileShapeMask(shape, scene.canvas);
  const { bounds } = mask;
  const placed = scene.words;
  const usableArea = mask.rows.reduce(
    (area, spans) =>
      area +
      spans.reduce((rowArea, span) => rowArea + span.end - span.start, 0),
    0,
  );
  const maxDots = Math.min(
    1_600,
    Math.floor((usableArea * MAX_FILL_FRACTION) / DOT_AREA_BUDGET),
  );
  if (maxDots === 0) return [];
  const spacing = Math.max(
    12,
    Math.sqrt((bounds.width * bounds.height) / 1_800),
  );
  const candidates: SceneFillDot[] = [];

  for (
    let y = bounds.y + spacing / 2, row = 0;
    y < bounds.y + bounds.height;
    y += spacing, row += 1
  ) {
    for (
      let x = bounds.x + spacing * (row % 2 === 0 ? 0.5 : 1);
      x < bounds.x + bounds.width;
      x += spacing
    ) {
      const dotX = Math.round(x);
      const dotY = Math.round(y);
      if (
        ![-3, -2, -1, 0, 1, 2].every((offset) =>
          mask.containsSpan(dotY + offset, dotX - 3, dotX + 3),
        )
      ) {
        continue;
      }
      if (
        placed.some(
          (word) =>
            dotX >= word.x - 4 &&
            dotX <= word.x + word.width + 4 &&
            dotY >= word.y - 4 &&
            dotY <= word.y + word.height + 4,
        )
      ) {
        continue;
      }
      candidates.push({ x: dotX, y: dotY });
    }
  }
  const dots =
    candidates.length <= maxDots
      ? candidates
      : Array.from(
          { length: maxDots },
          (_, index) =>
            candidates[
              Math.floor(((index + 0.5) * candidates.length) / maxDots)
            ]!,
        );
  if (shape.id !== "uploaded") return dots;
  return dots.map((dot) => ({
    ...dot,
    color: sceneWordColor(
      { x: dot.x - 2, y: dot.y - 2, width: 4, height: 4, rank: 1 },
      shape,
      scene.canvas,
      [scene.words[0]!.color],
      scene.background,
    ),
  }));
}

export function shapeFillDotColor(scene: SceneModel): string {
  const foreground =
    scene.words.find((word) => word.status === "placed")?.color ?? "#27384a";
  const background = scene.background;
  const channels = [1, 3, 5].map((start) => {
    const front = Number.parseInt(foreground.slice(start, start + 2), 16);
    const back = Number.parseInt(background.slice(start, start + 2), 16);
    return Math.round(back * 0.55 + front * 0.45)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

export { DOT_RADIUS };
