import type { FontMetricsTable } from "./metrics";
import type { LayoutStyle } from "./layout";

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
  words: SceneWord[];
}

export function recolorScene(
  scene: SceneModel,
  palette: string[],
  background: string,
): SceneModel {
  const safePalette = palette.length > 0 ? palette : ["#111111"];
  return {
    ...scene,
    background,
    words: scene.words.map((word) => ({
      ...word,
      color: safePalette[(word.rank - 1) % safePalette.length],
    })),
  };
}

export function metricsFingerprint(table: FontMetricsTable): string {
  return table.fingerprint;
}
