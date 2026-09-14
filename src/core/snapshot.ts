import { CODEC_VERSION, decodeJsonFragment, encodeJsonFragment } from "./codec";
import { LIMITS, scalarLength } from "./limits";
import { SCENE_VERSION, type SceneModel, type SceneWord } from "./scene";
import type { LayoutStyle } from "./layout";
import type { Word, WordSet } from "./types";

export interface Presentation extends LayoutStyle {}

export interface SnapshotPayload {
  schemaVersion: "wc-snapshot-v1";
  codecVersion: typeof CODEC_VERSION;
  tokenizerVersion: string;
  layoutVersion: string;
  sceneVersion: typeof SCENE_VERSION;
  wordSet: WordSet;
  presentation: Presentation;
  scene: SceneModel;
}

export class SnapshotValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SnapshotValidationError";
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SnapshotValidationError(`${label} 必須是 object。`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  object: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(object);
  if (
    keys.some((key) => !allowed.has(key)) ||
    required.some((key) => !keys.includes(key))
  ) {
    throw new SnapshotValidationError(`${label} 含有未知或缺少欄位。`);
  }
}

function stringValue(
  value: unknown,
  label: string,
  max: number = LIMITS.maxLiteralScalars,
): string {
  if (typeof value !== "string" || !value.trim() || scalarLength(value) > max) {
    throw new SnapshotValidationError(`${label} 必須是受長度限制的非空文字。`);
  }
  if (
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(
      value,
    )
  ) {
    throw new SnapshotValidationError(
      `${label} 含有不允許的控制或雙向文字字元。`,
    );
  }
  return value;
}

function numberValue(
  value: unknown,
  label: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    throw new SnapshotValidationError(`${label} 超出允許範圍。`);
  }
  return value;
}

function colorValue(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u.test(value)
  ) {
    throw new SnapshotValidationError(`${label} 必須是安全的 hex 顏色。`);
  }
  return value;
}

function validateWordSet(value: unknown): WordSet {
  const object = record(value, "wordSet");
  exactKeys(
    object,
    ["locale", "tokenizerVersion", "totalTokens", "words"],
    [],
    "wordSet",
  );
  const locale = stringValue(object.locale, "wordSet.locale", 64);
  const tokenizerVersion = stringValue(
    object.tokenizerVersion,
    "wordSet.tokenizerVersion",
    64,
  );
  const totalTokens = numberValue(
    object.totalTokens,
    "wordSet.totalTokens",
    0,
    LIMITS.maxCandidateTokens,
    true,
  );
  if (
    !Array.isArray(object.words) ||
    object.words.length > LIMITS.maxUniqueTerms
  ) {
    throw new SnapshotValidationError("wordSet.words 超出上限。");
  }
  const ranks = new Set<number>();
  const words: Word[] = object.words.map((value, index) => {
    const item = record(value, `wordSet.words[${index}]`);
    exactKeys(
      item,
      ["term", "count", "firstSeen", "rank", "locale"],
      [],
      "word",
    );
    const word: Word = {
      term: stringValue(item.term, "word.term"),
      count: numberValue(
        item.count,
        "word.count",
        1,
        LIMITS.maxCandidateTokens,
        true,
      ),
      firstSeen: numberValue(
        item.firstSeen,
        "word.firstSeen",
        0,
        LIMITS.maxCandidateTokens,
        true,
      ),
      rank: numberValue(item.rank, "word.rank", 1, LIMITS.maxUniqueTerms, true),
      locale: stringValue(item.locale, "word.locale", 64),
    };
    if (ranks.has(word.rank))
      throw new SnapshotValidationError("word ranks 必須唯一。");
    ranks.add(word.rank);
    return word;
  });
  if (words.some((word, index) => word.rank !== index + 1)) {
    throw new SnapshotValidationError("word ranks 必須從 1 連續排列。");
  }
  return { locale, tokenizerVersion, totalTokens, words };
}

function validatePresentation(value: unknown): Presentation {
  const object = record(value, "presentation");
  exactKeys(
    object,
    [
      "canvas",
      "minFontSize",
      "maxFontSize",
      "scale",
      "padding",
      "rotations",
      "palette",
      "background",
      "fontFamily",
      "seed",
      "version",
    ],
    [],
    "presentation",
  );
  const canvas = record(object.canvas, "presentation.canvas");
  exactKeys(canvas, ["width", "height"], [], "presentation.canvas");
  const width = numberValue(
    canvas.width,
    "canvas.width",
    1,
    LIMITS.maxCanvasDimension,
    true,
  );
  const height = numberValue(
    canvas.height,
    "canvas.height",
    1,
    LIMITS.maxCanvasDimension,
    true,
  );
  if (width * height > LIMITS.maxExportPixels)
    throw new SnapshotValidationError("畫布面積超過上限。");
  const scale = object.scale;
  if (scale !== "sqrt" && scale !== "linear" && scale !== "log") {
    throw new SnapshotValidationError("presentation.scale 不受支援。");
  }
  if (!Array.isArray(object.rotations) || object.rotations.length > 16)
    throw new SnapshotValidationError("rotations 超出上限。");
  if (
    !Array.isArray(object.palette) ||
    object.palette.length === 0 ||
    object.palette.length > 16
  )
    throw new SnapshotValidationError("palette 無效。");
  const fontFamily = stringValue(
    object.fontFamily,
    "presentation.fontFamily",
    128,
  );
  if (!/^[\p{L}\p{N}\s,'"()-]+$/u.test(fontFamily))
    throw new SnapshotValidationError("fontFamily 含有不允許的 CSS 值。");
  const minFontSize = numberValue(object.minFontSize, "minFontSize", 1, 512);
  const maxFontSize = numberValue(object.maxFontSize, "maxFontSize", 1, 512);
  if (minFontSize > maxFontSize)
    throw new SnapshotValidationError("minFontSize 不可大於 maxFontSize。");
  return {
    canvas: { width, height },
    minFontSize,
    maxFontSize,
    scale,
    padding: numberValue(object.padding, "padding", 0, 128),
    rotations: object.rotations.map((rotation, index) =>
      numberValue(rotation, `rotations[${index}]`, -180, 180),
    ),
    palette: object.palette.map((color, index) =>
      colorValue(color, `palette[${index}]`),
    ),
    background: colorValue(object.background, "background"),
    fontFamily,
    seed: stringValue(object.seed, "seed", 128),
    version: stringValue(object.version, "presentation.version", 64),
  };
}

function validateSceneWord(value: unknown, index: number): SceneWord {
  const object = record(value, `scene.words[${index}]`);
  exactKeys(
    object,
    [
      "term",
      "count",
      "rank",
      "locale",
      "fontSize",
      "angle",
      "x",
      "y",
      "width",
      "height",
      "color",
      "status",
    ],
    ["reason"],
    "scene.word",
  );
  const status = object.status;
  if (
    status !== "placed" &&
    status !== "unplaceable" &&
    status !== "budget-limited"
  )
    throw new SnapshotValidationError("scene word status 無效。");
  const reason = object.reason;
  if (
    reason !== undefined &&
    reason !== "no-fit" &&
    reason !== "probe-budget" &&
    reason !== "cancelled" &&
    reason !== "invalid-canvas"
  ) {
    throw new SnapshotValidationError("scene word reason 無效。");
  }
  if (status !== "placed" && reason === undefined)
    throw new SnapshotValidationError("未放置詞語必須有 reason。");
  return {
    term: stringValue(object.term, "scene.word.term"),
    count: numberValue(
      object.count,
      "scene.word.count",
      1,
      LIMITS.maxCandidateTokens,
      true,
    ),
    rank: numberValue(
      object.rank,
      "scene.word.rank",
      1,
      LIMITS.maxUniqueTerms,
      true,
    ),
    locale: stringValue(object.locale, "scene.word.locale", 64),
    fontSize: numberValue(object.fontSize, "scene.word.fontSize", 1, 512),
    angle: numberValue(object.angle, "scene.word.angle", -180, 180),
    x: numberValue(object.x, "scene.word.x", 0, LIMITS.maxCanvasDimension),
    y: numberValue(object.y, "scene.word.y", 0, LIMITS.maxCanvasDimension),
    width: numberValue(
      object.width,
      "scene.word.width",
      0,
      LIMITS.maxCanvasDimension,
    ),
    height: numberValue(
      object.height,
      "scene.word.height",
      0,
      LIMITS.maxCanvasDimension,
    ),
    color: colorValue(object.color, "scene.word.color"),
    status,
    ...(reason ? { reason } : {}),
  };
}

function validateScene(value: unknown): SceneModel {
  const object = record(value, "scene");
  exactKeys(
    object,
    [
      "version",
      "layoutVersion",
      "canvas",
      "background",
      "fontFamily",
      "fontMetricsFingerprint",
      "seed",
      "layoutStatus",
      "words",
    ],
    [],
    "scene",
  );
  const presentation = validatePresentation({
    canvas: object.canvas,
    minFontSize: 1,
    maxFontSize: 1,
    scale: "sqrt",
    padding: 0,
    rotations: [0],
    palette: ["#000000"],
    background: object.background,
    fontFamily: object.fontFamily,
    seed: object.seed,
    version: object.layoutVersion,
  });
  const layoutStatus = object.layoutStatus;
  if (
    layoutStatus !== "complete" &&
    layoutStatus !== "budget-limited" &&
    layoutStatus !== "cancelled"
  )
    throw new SnapshotValidationError("scene.layoutStatus 無效。");
  if (
    !Array.isArray(object.words) ||
    object.words.length > LIMITS.maxUniqueTerms
  )
    throw new SnapshotValidationError("scene.words 超出上限。");
  if (object.version !== SCENE_VERSION)
    throw new SnapshotValidationError("scene.version 不受支援。");
  return {
    version: stringValue(object.version, "scene.version", 64),
    layoutVersion: stringValue(object.layoutVersion, "scene.layoutVersion", 64),
    canvas: presentation.canvas,
    background: presentation.background,
    fontFamily: presentation.fontFamily,
    fontMetricsFingerprint: stringValue(
      object.fontMetricsFingerprint,
      "scene.fontMetricsFingerprint",
      128,
    ),
    seed: stringValue(object.seed, "scene.seed", 128),
    layoutStatus,
    words: object.words.map(validateSceneWord),
  };
}

export function validateSnapshot(value: unknown): SnapshotPayload {
  const object = record(value, "snapshot");
  exactKeys(
    object,
    [
      "schemaVersion",
      "codecVersion",
      "tokenizerVersion",
      "layoutVersion",
      "sceneVersion",
      "wordSet",
      "presentation",
      "scene",
    ],
    [],
    "snapshot",
  );
  if (
    object.schemaVersion !== "wc-snapshot-v1" ||
    object.codecVersion !== CODEC_VERSION ||
    object.sceneVersion !== SCENE_VERSION
  ) {
    throw new SnapshotValidationError(
      "snapshot schema 或 codec version 不支援。",
    );
  }
  const wordSet = validateWordSet(object.wordSet);
  const presentation = validatePresentation(object.presentation);
  const scene = validateScene(object.scene);
  if (
    presentation.version !== object.layoutVersion ||
    wordSet.tokenizerVersion !== object.tokenizerVersion ||
    scene.layoutVersion !== presentation.version
  ) {
    throw new SnapshotValidationError("snapshot 版本欄位與內容不一致。");
  }
  if (scene.words.length !== wordSet.words.length)
    throw new SnapshotValidationError(
      "scene 必須為每個 WordSet 詞語保留 placement 狀態。",
    );
  const wordByRank = new Map(wordSet.words.map((word) => [word.rank, word]));
  const sceneRanks = new Set<number>();
  for (const word of scene.words) {
    const source = wordByRank.get(word.rank);
    if (!source || source.term !== word.term || source.count !== word.count) {
      throw new SnapshotValidationError("scene 與 wordSet 的詞語資料不一致。");
    }
    if (sceneRanks.has(word.rank))
      throw new SnapshotValidationError("scene ranks 必須唯一。");
    sceneRanks.add(word.rank);
  }
  return {
    schemaVersion: "wc-snapshot-v1",
    codecVersion: CODEC_VERSION,
    tokenizerVersion: stringValue(
      object.tokenizerVersion,
      "snapshot.tokenizerVersion",
      64,
    ),
    layoutVersion: stringValue(
      object.layoutVersion,
      "snapshot.layoutVersion",
      64,
    ),
    sceneVersion: SCENE_VERSION,
    wordSet,
    presentation,
    scene,
  };
}

export function createSnapshot(
  wordSet: WordSet,
  presentation: Presentation,
  scene: SceneModel,
): SnapshotPayload {
  return validateSnapshot({
    schemaVersion: "wc-snapshot-v1",
    codecVersion: CODEC_VERSION,
    tokenizerVersion: wordSet.tokenizerVersion,
    layoutVersion: presentation.version,
    sceneVersion: SCENE_VERSION,
    wordSet,
    presentation,
    scene,
  });
}

export function encodeSnapshot(
  wordSet: WordSet,
  presentation: Presentation,
  scene: SceneModel,
  maxEncodedBytes: number = LIMITS.maxEncodedFragmentBytes,
): ReturnType<typeof encodeJsonFragment> {
  return encodeJsonFragment(
    createSnapshot(wordSet, presentation, scene),
    maxEncodedBytes,
  );
}

export function decodeSnapshotFragment(
  fragment: string,
  maxEncodedBytes: number = LIMITS.maxEncodedFragmentBytes,
): SnapshotPayload {
  return validateSnapshot(decodeJsonFragment(fragment, maxEncodedBytes));
}
