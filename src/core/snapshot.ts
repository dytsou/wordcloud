import { CODEC_VERSION, decodeJsonFragment, encodeJsonFragment } from "./codec";
import { LIMITS, scalarLength } from "./limits";
import { isSafeFontFamily, isSafeHexColor } from "./style-safety";
import {
  getBuiltInShape,
  MAX_SHAPE_SCALE,
  MIN_SHAPE_SCALE,
  type ShapeSettings,
} from "./shapes";
import { SCENE_VERSION, type SceneModel, type SceneWord } from "./scene";
import type { LayoutStyle } from "./layout";
import type { Word, WordSet } from "./types";

export type Presentation = LayoutStyle;

interface SnapshotPayloadFields {
  codecVersion: typeof CODEC_VERSION;
  tokenizerVersion: string;
  layoutVersion: string;
  sceneVersion: typeof SCENE_VERSION;
  wordSet: WordSet;
  scene: SceneModel;
}

export type SnapshotPayload = SnapshotPayloadFields &
  (
    | {
        schemaVersion: "wc-snapshot-v1";
        presentation: Omit<Presentation, "shape">;
      }
    | {
        schemaVersion: "wc-snapshot-v2";
        presentation: Presentation & { shape: ShapeSettings };
      }
  );

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
  label: string,
  optional: string[] = [],
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
  // The control-character range is intentional: snapshots cross an untrusted boundary.
  if (
    // eslint-disable-next-line no-control-regex
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
  if (!isSafeHexColor(value)) {
    throw new SnapshotValidationError(`${label} 必須是安全的 hex 顏色。`);
  }
  return value;
}

function validateWordSet(value: unknown): WordSet {
  const object = record(value, "wordSet");
  exactKeys(
    object,
    ["locale", "tokenizerVersion", "totalTokens", "words"],
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
  const terms = new Set<string>();
  const words: Word[] = object.words.map((value, index) => {
    const item = record(value, `wordSet.words[${index}]`);
    exactKeys(item, ["term", "count", "firstSeen", "rank", "locale"], "word");
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
    if (terms.has(word.term))
      throw new SnapshotValidationError("word terms 必須唯一。");
    ranks.add(word.rank);
    terms.add(word.term);
    return word;
  });
  if (words.some((word, index) => word.rank !== index + 1)) {
    throw new SnapshotValidationError("word ranks 必須從 1 連續排列。");
  }
  return { locale, tokenizerVersion, totalTokens, words };
}

function validateShape(value: unknown): ShapeSettings {
  const object = record(value, "presentation.shape");
  exactKeys(object, ["id", "widthScale", "heightScale"], "presentation.shape");
  const id = stringValue(object.id, "presentation.shape.id", 64);
  const shape = getBuiltInShape(id);
  if (!shape)
    throw new SnapshotValidationError("presentation.shape.id 不受支援。");
  return {
    id: shape.id,
    widthScale: numberValue(
      object.widthScale,
      "presentation.shape.widthScale",
      MIN_SHAPE_SCALE,
      MAX_SHAPE_SCALE,
    ),
    heightScale: numberValue(
      object.heightScale,
      "presentation.shape.heightScale",
      MIN_SHAPE_SCALE,
      MAX_SHAPE_SCALE,
    ),
  };
}

function validatePresentation(value: unknown, shaped: false): Presentation;
function validatePresentation(
  value: unknown,
  shaped: true,
): Presentation & { shape: ShapeSettings };
function validatePresentation(value: unknown, shaped: boolean): Presentation {
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
    "presentation",
    shaped ? ["shape"] : [],
  );
  if (shaped && !Object.hasOwn(object, "shape"))
    throw new SnapshotValidationError("presentation.shape 為必填欄位。");
  const canvas = record(object.canvas, "presentation.canvas");
  exactKeys(canvas, ["width", "height"], "presentation.canvas");
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
  const fontFamily = stringValue(object.fontFamily, "presentation.fontFamily");
  if (!isSafeFontFamily(fontFamily))
    throw new SnapshotValidationError("fontFamily 含有不允許的 CSS 值。");
  const minFontSize = numberValue(object.minFontSize, "minFontSize", 1, 512);
  const maxFontSize = numberValue(object.maxFontSize, "maxFontSize", 1, 512);
  if (minFontSize > maxFontSize)
    throw new SnapshotValidationError("minFontSize 不可大於 maxFontSize。");
  const presentation: Presentation = {
    canvas: { width, height },
    minFontSize,
    maxFontSize,
    scale,
    padding: numberValue(
      object.padding,
      "padding",
      LIMITS.minPadding,
      LIMITS.maxPadding,
    ),
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
  if (shaped) presentation.shape = validateShape(object.shape);
  return presentation;
}

function validateSceneWord(
  value: unknown,
  index: number,
  canvas: { width: number; height: number },
): SceneWord {
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
    "scene.word",
    ["reason"],
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
  const word: SceneWord = {
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
  if (
    status === "placed" &&
    (word.x + word.width > canvas.width || word.y + word.height > canvas.height)
  ) {
    throw new SnapshotValidationError(
      `scene.words[${index}] 超出 scene 畫布範圍。`,
    );
  }
  return word;
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
    "scene",
    ["shape"],
  );
  const presentation = validatePresentation(
    {
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
    },
    false,
  );
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
    ),
    seed: stringValue(object.seed, "scene.seed"),
    layoutStatus,
    ...(object.shape === undefined
      ? {}
      : { shape: validateShape(object.shape) }),
    words: object.words.map((word, index) =>
      validateSceneWord(word, index, presentation.canvas),
    ),
  };
}

type SnapshotSchemaVersion = "wc-snapshot-v1" | "wc-snapshot-v2";

function snapshotSchemaVersion(value: unknown): SnapshotSchemaVersion {
  if (value !== "wc-snapshot-v1" && value !== "wc-snapshot-v2") {
    throw new SnapshotValidationError(
      "snapshot schema 或 codec version 不支援。",
    );
  }
  return value;
}

function validateSnapshotCodecVersions(object: Record<string, unknown>): void {
  if (
    object.codecVersion !== CODEC_VERSION ||
    object.sceneVersion !== SCENE_VERSION
  ) {
    throw new SnapshotValidationError(
      "snapshot schema 或 codec version 不支援。",
    );
  }
}

function validateSnapshotShape(
  schemaVersion: SnapshotSchemaVersion,
  presentation: Presentation,
  scene: SceneModel,
): void {
  if (schemaVersion === "wc-snapshot-v1" && scene.shape) {
    throw new SnapshotValidationError("v1 scene 不可包含 shape。");
  }
  if (schemaVersion !== "wc-snapshot-v2") return;
  if (
    scene.shape &&
    (scene.shape.id !== presentation.shape?.id ||
      scene.shape.widthScale !== presentation.shape?.widthScale ||
      scene.shape.heightScale !== presentation.shape?.heightScale)
  ) {
    throw new SnapshotValidationError("scene shape 與 presentation 不一致。");
  }
  scene.shape = presentation.shape;
}

function validateSnapshotLayoutVersions(
  object: Record<string, unknown>,
  schemaVersion: SnapshotSchemaVersion,
  wordSet: WordSet,
  presentation: Presentation,
  scene: SceneModel,
): void {
  if (
    presentation.version !== object.layoutVersion ||
    wordSet.tokenizerVersion !== object.tokenizerVersion ||
    scene.layoutVersion !== presentation.version
  ) {
    throw new SnapshotValidationError("snapshot 版本欄位與內容不一致。");
  }
  if (
    schemaVersion === "wc-snapshot-v2" &&
    (presentation.version !== "layout-v2" ||
      object.layoutVersion !== "layout-v2")
  ) {
    throw new SnapshotValidationError("shape snapshot 必須使用 layout-v2。");
  }
}

function validateSnapshotSceneWords(
  wordSet: WordSet,
  presentation: Presentation,
  scene: SceneModel,
): void {
  if (scene.words.length !== wordSet.words.length) {
    throw new SnapshotValidationError(
      "scene 必須為每個 WordSet 詞語保留 placement 狀態。",
    );
  }
  if (
    scene.canvas.width !== presentation.canvas.width ||
    scene.canvas.height !== presentation.canvas.height
  ) {
    throw new SnapshotValidationError(
      "scene 與 presentation 的畫布尺寸必須一致。",
    );
  }
  const wordByRank = new Map(wordSet.words.map((word) => [word.rank, word]));
  const sceneRanks = new Set<number>();
  const sceneTerms = new Set<string>();
  for (const word of scene.words) {
    const source = wordByRank.get(word.rank);
    if (source?.term !== word.term || source?.count !== word.count) {
      throw new SnapshotValidationError("scene 與 wordSet 的詞語資料不一致。");
    }
    if (sceneRanks.has(word.rank))
      throw new SnapshotValidationError("scene ranks 必須唯一。");
    if (sceneTerms.has(word.term))
      throw new SnapshotValidationError("scene terms 必須唯一。");
    sceneRanks.add(word.rank);
    sceneTerms.add(word.term);
  }
}

export function validateSnapshot(value: unknown): SnapshotPayload {
  const object = record(value, "snapshot");
  const schemaVersion = snapshotSchemaVersion(object.schemaVersion);
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
    "snapshot",
  );
  validateSnapshotCodecVersions(object);
  const wordSet = validateWordSet(object.wordSet);
  const presentation =
    schemaVersion === "wc-snapshot-v2"
      ? validatePresentation(object.presentation, true)
      : validatePresentation(object.presentation, false);
  const scene = validateScene(object.scene);
  validateSnapshotShape(schemaVersion, presentation, scene);
  validateSnapshotLayoutVersions(
    object,
    schemaVersion,
    wordSet,
    presentation,
    scene,
  );
  validateSnapshotSceneWords(wordSet, presentation, scene);
  const common: SnapshotPayloadFields = {
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
    scene,
  };
  if (schemaVersion === "wc-snapshot-v1") {
    return {
      ...common,
      schemaVersion,
      presentation: presentation as Omit<Presentation, "shape">,
    };
  }
  return {
    ...common,
    schemaVersion,
    presentation: presentation as Presentation & { shape: ShapeSettings },
  };
}

export function createSnapshot(
  wordSet: WordSet,
  presentation: Presentation,
  scene: SceneModel,
): SnapshotPayload {
  const shaped = presentation.shape !== undefined;
  const snapshotPresentation = { ...presentation };
  if (!shaped) delete snapshotPresentation.shape;
  return validateSnapshot({
    schemaVersion: shaped ? "wc-snapshot-v2" : "wc-snapshot-v1",
    codecVersion: CODEC_VERSION,
    tokenizerVersion: wordSet.tokenizerVersion,
    layoutVersion: presentation.version,
    sceneVersion: SCENE_VERSION,
    wordSet,
    presentation: snapshotPresentation,
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
