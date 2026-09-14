import { LIMITS, scalarLength } from "../core/limits";
import { isSafeFontFamily, isSafeHexColor } from "../core/style-safety";
import type { SceneModel, SceneWord } from "../core/scene";

// The control-character range is intentional: render data may be untrusted.
const FORBIDDEN_TEXT =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;

function safeText(
  value: unknown,
  label: string,
  max: number = LIMITS.maxLiteralScalars,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    scalarLength(value) > max ||
    FORBIDDEN_TEXT.test(value)
  ) {
    throw new Error(`${label} is not safe render text.`);
  }
  return value;
}

function safeNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  integer = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(`${label} is outside the render budget.`);
  }
  return value;
}

function validateSceneWord(
  word: SceneWord,
  index: number,
  scene: SceneModel,
): void {
  safeText(word.term, `scene.words[${index}].term`);
  safeText(word.locale, `scene.words[${index}].locale`, 64);
  safeNumber(
    word.count,
    `scene.words[${index}].count`,
    1,
    LIMITS.maxCandidateTokens,
    true,
  );
  safeNumber(
    word.rank,
    `scene.words[${index}].rank`,
    1,
    LIMITS.maxUniqueTerms,
    true,
  );
  safeNumber(word.fontSize, `scene.words[${index}].fontSize`, 1, 512);
  safeNumber(word.angle, `scene.words[${index}].angle`, -180, 180);
  safeNumber(word.x, `scene.words[${index}].x`, 0, LIMITS.maxCanvasDimension);
  safeNumber(word.y, `scene.words[${index}].y`, 0, LIMITS.maxCanvasDimension);
  safeNumber(
    word.width,
    `scene.words[${index}].width`,
    0,
    LIMITS.maxCanvasDimension,
  );
  safeNumber(
    word.height,
    `scene.words[${index}].height`,
    0,
    LIMITS.maxCanvasDimension,
  );
  if (!isSafeHexColor(word.color)) {
    throw new Error(`scene.words[${index}].color is not a safe hex color.`);
  }
  if (
    word.status !== "placed" &&
    word.status !== "unplaceable" &&
    word.status !== "budget-limited"
  ) {
    throw new Error(`scene.words[${index}].status is invalid.`);
  }
  if (
    word.reason !== undefined &&
    word.reason !== "no-fit" &&
    word.reason !== "probe-budget" &&
    word.reason !== "cancelled" &&
    word.reason !== "invalid-canvas"
  ) {
    throw new Error(`scene.words[${index}].reason is invalid.`);
  }
  if (word.status !== "placed" && !word.reason) {
    throw new Error(`scene.words[${index}] is missing a placement reason.`);
  }
  if (
    word.status === "placed" &&
    (word.x + word.width > scene.canvas.width ||
      word.y + word.height > scene.canvas.height)
  ) {
    throw new Error(`scene.words[${index}] is outside the canvas.`);
  }
}

export function assertRenderableScene(scene: SceneModel): void {
  if (!scene || typeof scene !== "object") {
    throw new Error("Scene is required for rendering.");
  }
  safeText(scene.version, "scene.version", 64);
  safeText(scene.layoutVersion, "scene.layoutVersion", 64);
  safeText(scene.fontMetricsFingerprint, "scene.fontMetricsFingerprint", 128);
  safeText(scene.seed, "scene.seed");
  if (!isSafeHexColor(scene.background)) {
    throw new Error("Scene background is not a safe hex color.");
  }
  if (!isSafeFontFamily(scene.fontFamily)) {
    throw new Error("Scene font family is not safe.");
  }
  if (
    scene.layoutStatus !== "complete" &&
    scene.layoutStatus !== "budget-limited" &&
    scene.layoutStatus !== "cancelled"
  ) {
    throw new Error("Scene layout status is invalid.");
  }
  const width = safeNumber(
    scene.canvas.width,
    "scene.canvas.width",
    1,
    LIMITS.maxCanvasDimension,
    true,
  );
  const height = safeNumber(
    scene.canvas.height,
    "scene.canvas.height",
    1,
    LIMITS.maxCanvasDimension,
    true,
  );
  if (width * height > LIMITS.maxExportPixels) {
    throw new Error("Scene canvas exceeds the export pixel budget.");
  }
  if (
    !Array.isArray(scene.words) ||
    scene.words.length > LIMITS.maxUniqueTerms
  ) {
    throw new Error("Scene word count exceeds the export budget.");
  }
  const terms = new Set<string>();
  const ranks = new Set<number>();
  scene.words.forEach((word, index) => {
    validateSceneWord(word, index, scene);
    if (terms.has(word.term) || ranks.has(word.rank)) {
      throw new Error("Scene terms and ranks must be unique.");
    }
    terms.add(word.term);
    ranks.add(word.rank);
  });
}

export function placedSceneWords(scene: SceneModel): SceneWord[] {
  assertRenderableScene(scene);
  return scene.words.filter((word) => word.status === "placed");
}

export function unplacedSceneWords(scene: SceneModel): SceneWord[] {
  assertRenderableScene(scene);
  return scene.words.filter((word) => word.status !== "placed");
}
