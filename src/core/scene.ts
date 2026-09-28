import type { FontMetricsTable } from "./metrics";
import type { LayoutStyle } from "./layout";
import { safeBackground, safePalette } from "./style-safety";

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
}

export function recolorScene(
  scene: SceneModel,
  palette: string[],
  background: string,
): SceneModel {
  const colors = safePalette(palette);
  return {
    ...scene,
    background: safeBackground(background),
    words: scene.words.map((word) => ({
      ...word,
      color: colors[(word.rank - 1) % colors.length],
    })),
  };
}

export function metricsFingerprint(table: FontMetricsTable): string {
  return table.fingerprint;
}
