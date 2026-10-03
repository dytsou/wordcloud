import type { FontMetricsTable } from "./metrics";
import type { LayoutStyle } from "./layout";
import { safeBackground, safePalette } from "./style-safety";
import {
  fitUploadedImageBounds,
  readableShapeColor,
  sampleUploadedShapeColor,
} from "./image-shape";

export const SCENE_VERSION = "scene-v1";

export type PlacementStatus = "placed" | "unplaceable" | "budget-limited";

export interface SceneWord {
  term: string;
  count: number;
  rank: number;
  locale: string;
  fontSize: number;
  angle: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  status: PlacementStatus;
  reason?: "no-fit" | "probe-budget" | "cancelled" | "invalid-canvas";
}

export interface SceneModel {
  version: string;
  layoutVersion: string;
  canvas: LayoutStyle["canvas"];
  background: string;
  fontFamily: string;
  fontMetricsFingerprint: string;
  seed: string;
  layoutStatus: "complete" | "budget-limited" | "cancelled";
  shape?: NonNullable<LayoutStyle["shape"]>;
  words: SceneWord[];
}

export interface SceneFillDot {
  x: number;
  y: number;
  color?: string;
}

export function sceneWordColor(
  word: Pick<SceneWord, "x" | "y" | "width" | "height" | "rank">,
  shape: LayoutStyle["shape"],
  canvas: LayoutStyle["canvas"],
  palette: string[],
  background: string,
): string {
  const fallback = palette[(word.rank - 1) % palette.length]!;
  if (shape?.id !== "uploaded" || shape.colorMode === "palette")
    return fallback;
  const bounds = fitUploadedImageBounds(
    shape.image,
    canvas,
    shape.widthScale,
    shape.heightScale,
  );
  const source =
    sampleUploadedShapeColor(shape.image, bounds, word) ?? fallback;
  return shape.colorMode === "readable"
    ? readableShapeColor(source, background)
    : source;
}

export function recolorScene(
  scene: SceneModel,
  palette: string[],
  background: string,
  shape: LayoutStyle["shape"] = scene.shape,
): SceneModel {
  const colors = safePalette(palette);
  return {
    ...scene,
    background: safeBackground(background),
    ...(shape ? { shape } : {}),
    words: scene.words.map((word) => ({
      ...word,
      color: sceneWordColor(
        word,
        shape,
        scene.canvas,
        colors,
        safeBackground(background),
      ),
    })),
  };
}

export function metricsFingerprint(table: FontMetricsTable): string {
  return table.fingerprint;
}
