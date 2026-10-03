import type { LayoutStyle } from "../core/layout";
import type { SceneModel } from "../core/scene";
import { recommendShapeFontRange } from "../core/shapes";
import type { SnapshotPayload } from "../core/snapshot";
import {
  DEFAULT_TOKENIZER_SETTINGS,
  detectBrowserTokenizerLocale,
} from "../core/tokenizer";
import type {
  TokenizationResult,
  TokenizerSettings,
  WordSet,
} from "../core/types";

export type EditorMode =
  | "empty"
  | "source"
  | "generating"
  | "ready"
  | "remix"
  | "error";

export const DEFAULT_PRESENTATION: LayoutStyle = {
  canvas: { width: 1000, height: 650 },
  minFontSize: 8,
  maxFontSize: 128,
  scale: "linear",
  padding: 0,
  rotations: [0, -35, 35],
  palette: ["#aa5948", "#27384a", "#5c6876", "#b86b58"],
  background: "#edf2f4",
  fontFamily: "Noto Sans CJK TC, system-ui",
  seed: "wordcloud-studio-v1",
  version: "layout-v1",
};

export interface EditorState {
  mode: EditorMode;
  sourceText: string;
  settings: TokenizerSettings;
  tokenization?: TokenizationResult;
  wordSet?: WordSet;
  presentation: LayoutStyle;
  scene?: SceneModel;
  error?: string;
  shareUrl?: string;
  shareUrlV2?: string;
  shareError?: string;
  shareErrorV1?: string;
  shareErrorV2?: string;
  shareEncoding?: boolean;
}

export function createInitialEditorState(): EditorState {
  return {
    mode: "empty",
    sourceText: "",
    settings: {
      ...DEFAULT_TOKENIZER_SETTINGS,
      locale: detectBrowserTokenizerLocale(),
      stopWords: [...DEFAULT_TOKENIZER_SETTINGS.stopWords],
      dictionary: [...DEFAULT_TOKENIZER_SETTINGS.dictionary],
      rules: [...DEFAULT_TOKENIZER_SETTINGS.rules],
    },
    presentation: {
      ...DEFAULT_PRESENTATION,
      canvas: { ...DEFAULT_PRESENTATION.canvas },
      rotations: [...DEFAULT_PRESENTATION.rotations],
      palette: [...DEFAULT_PRESENTATION.palette],
    },
  };
}

export function fromSnapshot(snapshot: SnapshotPayload): EditorState {
  return {
    mode: "remix",
    sourceText: "",
    settings: {
      ...DEFAULT_TOKENIZER_SETTINGS,
      locale: snapshot.wordSet.locale,
      tokenizerVersion: snapshot.tokenizerVersion,
    },
    wordSet: snapshot.wordSet,
    presentation: snapshot.presentation,
    scene: snapshot.scene,
  };
}

export function isGeometryChanging(
  previous: LayoutStyle,
  next: LayoutStyle,
): boolean {
  return (
    previous.canvas.width !== next.canvas.width ||
    previous.canvas.height !== next.canvas.height ||
    previous.minFontSize !== next.minFontSize ||
    previous.maxFontSize !== next.maxFontSize ||
    previous.scale !== next.scale ||
    previous.padding !== next.padding ||
    previous.fontFamily !== next.fontFamily ||
    previous.seed !== next.seed ||
    previous.version !== next.version ||
    previous.shape?.id !== next.shape?.id ||
    previous.shape?.widthScale !== next.shape?.widthScale ||
    previous.shape?.heightScale !== next.shape?.heightScale ||
    (previous.shape?.id === "uploaded" &&
      next.shape?.id === "uploaded" &&
      (previous.shape.image !== next.shape.image ||
        previous.shape.colorBoundary !== next.shape.colorBoundary)) ||
    JSON.stringify(previous.rotations) !== JSON.stringify(next.rotations)
  );
}

export function withShapeFontDefaults(
  previous: LayoutStyle,
  next: LayoutStyle,
  wordCount: number,
): LayoutStyle {
  const shapeChanged =
    previous.shape?.id !== next.shape?.id ||
    previous.shape?.widthScale !== next.shape?.widthScale ||
    previous.shape?.heightScale !== next.shape?.heightScale ||
    (previous.shape?.id === "uploaded" &&
      next.shape?.id === "uploaded" &&
      previous.shape.image !== next.shape.image) ||
    previous.canvas.width !== next.canvas.width ||
    previous.canvas.height !== next.canvas.height;
  if (!shapeChanged) return next;

  if (previous.shape) {
    if (!hasShapeFontDefaults(previous, wordCount)) return next;
  } else if (
    previous.minFontSize !== DEFAULT_PRESENTATION.minFontSize ||
    previous.maxFontSize !== DEFAULT_PRESENTATION.maxFontSize
  )
    return next;

  const nextDefault = next.shape
    ? recommendShapeFontRange(next.shape, next.canvas, wordCount)
    : DEFAULT_PRESENTATION;
  return {
    ...next,
    minFontSize: nextDefault.minFontSize,
    maxFontSize: nextDefault.maxFontSize,
  };
}

export function hasShapeFontDefaults(
  presentation: LayoutStyle,
  wordCount: number,
): boolean {
  if (!presentation.shape) return false;
  const defaults = recommendShapeFontRange(
    presentation.shape,
    presentation.canvas,
    wordCount,
  );
  return (
    presentation.minFontSize === defaults.minFontSize &&
    presentation.maxFontSize === defaults.maxFontSize
  );
}
