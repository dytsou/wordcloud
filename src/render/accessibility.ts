import type { SceneModel, SceneWord } from "../core/scene";
import { assertRenderableScene } from "./safe-scene";

export interface AccessibleWord {
  term: string;
  count: number;
  rank: number;
  locale: string;
  status: SceneWord["status"];
  reason?: SceneWord["reason"];
}

export function getAccessibleWords(scene: SceneModel): AccessibleWord[] {
  assertRenderableScene(scene);
  return scene.words.map(({ term, count, rank, locale, status, reason }) => ({
    term,
    count,
    rank,
    locale,
    status,
    ...(reason ? { reason } : {}),
  }));
}

export function placementLabel(
  word: Pick<AccessibleWord, "status" | "reason">,
): string {
  if (word.status === "placed") return "placed";
  return word.reason ? `${word.status}: ${word.reason}` : word.status;
}

export function renderAccessibleSummary(scene: SceneModel): string {
  const words = getAccessibleWords(scene);
  const placed = words.filter((word) => word.status === "placed").length;
  const omitted = words.length - placed;
  return omitted > 0
    ? `${words.length} words; ${placed} placed and ${omitted} omitted from the visual canvas. Each omitted word remains listed with its reason.`
    : `${words.length} words; all words are placed on the visual canvas.`;
}
