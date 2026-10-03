import type { SceneFillDot, SceneModel, SceneWord } from "../core/scene";
import { buildShapeFillDots, shapeFillDotColor } from "../core/shape-fill";
import { compileShapeMask, type CompiledShapeMask } from "../core/shapes";
import { assertRenderableScene } from "./safe-scene";

export interface PngRenderPlan {
  width: number;
  height: number;
  background: string;
  fontFamily: string;
  words: SceneWord[];
  placedWords: SceneWord[];
  omittedWords: SceneWord[];
  fillerDots: SceneFillDot[];
  fillerColor: string;
  foregroundRows?: CompiledShapeMask["rows"];
}

export interface CanvasContextLike {
  fillStyle: string;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  beginPath?(): void;
  rect?(x: number, y: number, width: number, height: number): void;
  clip?(): void;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(contextId: "2d"): CanvasContextLike | null;
  toBlob(callback: (blob: Blob | null) => void, type?: string): void;
}

export interface PngRenderOptions {
  createCanvas?: (width: number, height: number) => CanvasLike;
}

export function createPngRenderPlan(scene: SceneModel): PngRenderPlan {
  assertRenderableScene(scene);
  const placedWords = scene.words.filter((word) => word.status === "placed");
  const foregroundMask =
    scene.shape?.id === "uploaded"
      ? compileShapeMask(scene.shape, scene.canvas)
      : undefined;
  return {
    width: scene.canvas.width,
    height: scene.canvas.height,
    background: scene.background,
    fontFamily: scene.fontFamily,
    words: scene.words.map((word) => ({ ...word })),
    placedWords: placedWords.map((word) => ({ ...word })),
    omittedWords: scene.words
      .filter((word) => word.status !== "placed")
      .map((word) => ({ ...word })),
    fillerDots: buildShapeFillDots(scene, foregroundMask),
    fillerColor: shapeFillDotColor(scene),
    ...(foregroundMask ? { foregroundRows: foregroundMask.rows } : {}),
  };
}

function drawPlanToCanvas(
  plan: PngRenderPlan,
  canvas: CanvasLike,
  context: CanvasContextLike,
): void {
  canvas.width = plan.width;
  canvas.height = plan.height;
  context.fillStyle = plan.background;
  context.fillRect(0, 0, plan.width, plan.height);
  if (
    plan.foregroundRows &&
    (!context.beginPath || !context.rect || !context.clip)
  ) {
    throw new Error("Canvas foreground clipping is unavailable.");
  }

  const drawContent = () => {
    context.fillStyle = plan.fillerColor;
    context.font = `500 16px ${plan.fontFamily}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (const dot of plan.fillerDots) {
      if (dot.color) {
        context.fillStyle = dot.color;
        context.fillRect(dot.x - 1, dot.y - 1, 2, 2);
      } else context.fillText(".", dot.x, dot.y - 4);
    }
    for (const word of plan.placedWords) {
      context.save();
      context.translate(word.x + word.width / 2, word.y + word.height / 2);
      context.rotate((word.angle * Math.PI) / 180);
      context.fillStyle = word.color;
      context.font = `500 ${word.fontSize}px ${plan.fontFamily}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(word.term, 0, 0);
      context.restore();
    }
  };

  if (!plan.foregroundRows) {
    drawContent();
    return;
  }
  context.save();
  try {
    context.beginPath?.();
    for (let row = 0; row < plan.foregroundRows.length; row += 1) {
      for (const span of plan.foregroundRows[row] ?? []) {
        context.rect?.(span.start, row, span.end - span.start, 1);
      }
    }
    context.clip?.();
    drawContent();
  } finally {
    context.restore();
  }
}

export function drawSceneToCanvas(
  scene: SceneModel,
  canvas: CanvasLike,
  context: CanvasContextLike,
): PngRenderPlan {
  const plan = createPngRenderPlan(scene);
  drawPlanToCanvas(plan, canvas, context);
  return plan;
}

function defaultCanvas(width: number, height: number): CanvasLike {
  if (typeof document === "undefined") {
    throw new TypeError("PNG export requires a browser canvas.");
  }
  const canvas = document.createElement("canvas") as unknown as CanvasLike;
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function renderScenePng(
  scene: SceneModel,
  options: PngRenderOptions = {},
): Promise<Blob> {
  const plan = createPngRenderPlan(scene);
  const canvas = options.createCanvas
    ? options.createCanvas(plan.width, plan.height)
    : defaultCanvas(plan.width, plan.height);
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("2D canvas is unavailable."));
  drawPlanToCanvas(plan, canvas, context);
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob || blob.size === 0) {
          reject(new Error("PNG export returned an empty blob."));
          return;
        }
        resolve(blob);
      }, "image/png");
    } catch (error) {
      reject(error instanceof Error ? error : new Error("PNG export failed."));
    }
  });
}
