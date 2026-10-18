import type { ReactNode } from "react";
import { useEffect, useId, useMemo, useState } from "react";
import { fitUploadedImageBounds, uploadedShapePath } from "../core/image-shape";
import type { SceneModel } from "../core/scene";
import {
  buildShapeFillDots,
  DOT_RADIUS,
  shapeFillDotColor,
} from "../core/shape-fill";
import { useI18n } from "../i18n";
import { renderAccessibleSummary } from "../render/accessibility";
import { placedSceneWords } from "../render/safe-scene";

interface CloudPreviewProps {
  readonly scene?: SceneModel;
  readonly highlightedTerm?: string;
  readonly captionAside?: ReactNode;
  readonly hasSelectedShape?: boolean;
  readonly onAdjustShapeSize?: () => void;
  readonly onRemoveShape?: () => void;
}

function resolveActiveHighlight(
  scene: SceneModel | undefined,
  highlightedTerm?: string,
): string | undefined {
  if (
    !scene ||
    !highlightedTerm ||
    !scene.words.some((word) => word.term === highlightedTerm)
  ) {
    return undefined;
  }
  return highlightedTerm;
}

export function CloudPreview({
  scene,
  highlightedTerm,
  captionAside,
  hasSelectedShape = false,
  onAdjustShapeSize,
  onRemoveShape,
}: CloudPreviewProps) {
  const [zoom, setZoom] = useState(1);
  const [fillHintHovered, setFillHintHovered] = useState(false);
  const [fillHintFocused, setFillHintFocused] = useState(false);
  const [fillHintPinned, setFillHintPinned] = useState(false);
  const [fillHintDismissed, setFillHintDismissed] = useState(false);
  const fillHintId = useId();
  const shapeClipId = `${fillHintId}-uploaded-shape`;
  const { t } = useI18n();
  const placedWords = scene ? placedSceneWords(scene) : [];
  const fillDots = useMemo(
    () => (scene && hasSelectedShape ? buildShapeFillDots(scene) : []),
    [scene, hasSelectedShape],
  );
  const accessibleSummary = scene ? renderAccessibleSummary(scene) : undefined;
  const uploadedShape =
    scene?.shape?.id === "uploaded" ? scene.shape : undefined;
  const shapeBounds =
    uploadedShape && scene
      ? fitUploadedImageBounds(
          uploadedShape.image,
          scene.canvas,
          uploadedShape.widthScale,
          uploadedShape.heightScale,
        )
      : undefined;
  const omittedCount = scene ? scene.words.length - placedWords.length : 0;
  const noWordsFit =
    hasSelectedShape && omittedCount > 0 && placedWords.length === 0;
  const fillHintOpen =
    (fillHintHovered || fillHintFocused || fillHintPinned) &&
    !fillHintDismissed;
  useEffect(() => {
    if (!fillHintOpen) return;
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFillHintPinned(false);
      setFillHintDismissed(true);
    };
    window.addEventListener("keydown", dismissOnEscape);
    return () => window.removeEventListener("keydown", dismissOnEscape);
  }, [fillHintOpen]);
  const activeHighlight = resolveActiveHighlight(scene, highlightedTerm);
  return (
    <section className="preview-stage" aria-labelledby="preview-heading">
      <div className="preview-topline">
        <div>
          <p className="section-kicker">{t("previewKicker")}</p>
          <h2 id="preview-heading">{t("previewHeading")}</h2>
        </div>
        <div className="zoom-control" aria-label={t("previewZoom")}>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(0.7, value - 0.1))}
            aria-label={t("zoomOut")}
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(1.3, value + 0.1))}
            aria-label={t("zoomIn")}
          >
            +
          </button>
        </div>
      </div>
      <div className="preview-caption-row">
        <p className="preview-caption">{t("previewCaption")}</p>
        {captionAside}
      </div>
      <div
        className="canvas-frame"
        style={scene ? { background: scene.background } : undefined}
      >
        {scene ? (
          <CloudPreviewSvg
            scene={scene}
            zoom={zoom}
            shapeClipId={shapeClipId}
            uploadedShape={uploadedShape}
            shapeBounds={shapeBounds}
            fillDots={fillDots}
            placedWords={placedWords}
            activeHighlight={activeHighlight}
            accessibleSummary={accessibleSummary}
            previewLabel={t("cloudPreview")}
          />
        ) : (
          <div className="canvas-empty">
            <span className="empty-orbit">✳</span>
            <p>
              {t("emptyWords")}
              <br />
              <em>{t("emptyShape")}</em>
            </p>
          </div>
        )}
        {fillDots.length > 0 && (
          <ShapeFillHint
            fillHintId={fillHintId}
            fillHintOpen={fillHintOpen}
            label={t("shapeFillHintLabel")}
            hint={t("shapeFillHint")}
            onHoverChange={setFillHintHovered}
            onFocusChange={setFillHintFocused}
            onPinnedChange={setFillHintPinned}
            onDismissedChange={setFillHintDismissed}
            fillHintPinned={fillHintPinned}
          />
        )}
        <OmittedWordsNotice
          noWordsFit={noWordsFit}
          omittedCount={omittedCount}
          onAdjustShapeSize={onAdjustShapeSize}
          onRemoveShape={onRemoveShape}
          t={t}
        />
      </div>
    </section>
  );
}

interface CloudPreviewSvgProps {
  readonly scene: SceneModel;
  readonly zoom: number;
  readonly shapeClipId: string;
  readonly uploadedShape?: SceneModel["shape"];
  readonly shapeBounds?: ReturnType<typeof fitUploadedImageBounds>;
  readonly fillDots: ReturnType<typeof buildShapeFillDots>;
  readonly placedWords: ReturnType<typeof placedSceneWords>;
  readonly activeHighlight?: string;
  readonly accessibleSummary?: string;
  readonly previewLabel: string;
}

function CloudPreviewSvg({
  scene,
  zoom,
  shapeClipId,
  uploadedShape,
  shapeBounds,
  fillDots,
  placedWords,
  activeHighlight,
  accessibleSummary,
  previewLabel,
}: CloudPreviewSvgProps) {
  const uploaded = uploadedShape?.id === "uploaded" ? uploadedShape : undefined;
  return (
    <>
      <svg
        className="cloud-svg"
        viewBox={`0 0 ${scene.canvas.width} ${scene.canvas.height}`}
        role="img"
        aria-label={previewLabel}
        aria-describedby="preview-description"
        style={{
          transform: `scale(${zoom})`,
          fontFamily: scene.fontFamily,
        }}
      >
        <title>{previewLabel}</title>
        {uploaded && shapeBounds && (
          <defs>
            <clipPath id={shapeClipId} clipPathUnits="userSpaceOnUse">
              <path
                d={uploadedShapePath(uploaded.image)}
                transform={`translate(${shapeBounds.x} ${shapeBounds.y}) scale(${shapeBounds.width / uploaded.image.width} ${shapeBounds.height / uploaded.image.height})`}
              />
            </clipPath>
          </defs>
        )}
        <g clipPath={uploaded ? `url(#${shapeClipId})` : undefined}>
          {fillDots.length > 0 && (
            <g
              className="shape-fill"
              aria-hidden="true"
              fill={shapeFillDotColor(scene)}
            >
              {fillDots.map((dot) => (
                <circle
                  key={`${dot.x}-${dot.y}`}
                  cx={dot.x}
                  cy={dot.y}
                  r={DOT_RADIUS}
                  fill={dot.color}
                />
              ))}
            </g>
          )}
          {placedWords.map((word) => (
            <text
              key={`${word.term}-${word.rank}`}
              x={word.x + word.width / 2}
              y={word.y + word.height / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fill={word.color}
              fontSize={word.fontSize}
              fontWeight={500}
              transform={`rotate(${word.angle} ${word.x + word.width / 2} ${word.y + word.height / 2})`}
              opacity={
                activeHighlight && activeHighlight !== word.term ? 0.28 : 1
              }
            >
              {word.term}
            </text>
          ))}
        </g>
      </svg>
      <p id="preview-description" className="sr-only">
        {accessibleSummary}
      </p>
    </>
  );
}

interface ShapeFillHintProps {
  readonly fillHintId: string;
  readonly fillHintOpen: boolean;
  readonly fillHintPinned: boolean;
  readonly label: string;
  readonly hint: string;
  readonly onHoverChange: (hovered: boolean) => void;
  readonly onFocusChange: (focused: boolean) => void;
  readonly onPinnedChange: (pinned: boolean) => void;
  readonly onDismissedChange: (dismissed: boolean) => void;
}

function ShapeFillHint({
  fillHintId,
  fillHintOpen,
  fillHintPinned,
  label,
  hint,
  onHoverChange,
  onFocusChange,
  onPinnedChange,
  onDismissedChange,
}: ShapeFillHintProps) {
  return (
    <div
      className={`shape-fill-hint${fillHintOpen ? " is-open" : ""}`}
      onMouseEnter={() => {
        onHoverChange(true);
        onDismissedChange(false);
      }}
      onMouseLeave={() => onHoverChange(false)}
    >
      <button
        className="shape-fill-hint-trigger"
        type="button"
        aria-label={label}
        aria-describedby={fillHintId}
        aria-expanded={fillHintOpen}
        onFocus={() => {
          onFocusChange(true);
          onDismissedChange(false);
        }}
        onBlur={() => {
          onFocusChange(false);
          onPinnedChange(false);
        }}
        onClick={() => {
          if (fillHintPinned) {
            onPinnedChange(false);
            onDismissedChange(true);
          } else {
            onPinnedChange(true);
            onDismissedChange(false);
          }
        }}
      >
        <span aria-hidden="true">i</span>
      </button>
      <span
        className="shape-fill-tooltip"
        id={fillHintId}
        role="tooltip"
        aria-hidden={!fillHintOpen}
      >
        {hint}
      </span>
    </div>
  );
}

interface OmittedWordsNoticeProps {
  readonly noWordsFit: boolean;
  readonly omittedCount: number;
  readonly onAdjustShapeSize?: () => void;
  readonly onRemoveShape?: () => void;
  readonly t: ReturnType<typeof useI18n>["t"];
}

function OmittedWordsNotice({
  noWordsFit,
  omittedCount,
  onAdjustShapeSize,
  onRemoveShape,
  t,
}: OmittedWordsNoticeProps) {
  if (noWordsFit) {
    return (
      <div className="canvas-warning canvas-warning--recovery">
        <output aria-live="polite">
          {t(omittedCount === 1 ? "shapeOneWordNoFit" : "shapeNoWordsFit", {
            count: omittedCount,
          })}
        </output>
        <div className="canvas-warning-actions">
          <button
            className="button button-quiet"
            type="button"
            onClick={onAdjustShapeSize}
          >
            {t("shapeAdjustSize")}
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={onRemoveShape}
          >
            {t("shapeRemoveMask")}
          </button>
        </div>
      </div>
    );
  }
  if (omittedCount > 0) {
    return (
      <p className="canvas-warning">
        {t("omittedWords", { count: omittedCount })}
      </p>
    );
  }
  return null;
}
