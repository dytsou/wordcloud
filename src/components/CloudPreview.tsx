import { useEffect, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { SceneModel } from "../core/scene";
import { fitUploadedImageBounds, uploadedShapePath } from "../core/image-shape";
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
  const activeHighlight =
    scene &&
    highlightedTerm &&
    scene.words.some((word) => word.term === highlightedTerm)
      ? highlightedTerm
      : undefined;
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
          <>
            <svg
              className="cloud-svg"
              viewBox={`0 0 ${scene.canvas.width} ${scene.canvas.height}`}
              role="img"
              aria-label={t("cloudPreview")}
              aria-describedby="preview-description"
              style={{
                transform: `scale(${zoom})`,
                fontFamily: scene.fontFamily,
              }}
            >
              <title>{t("cloudPreview")}</title>
              {uploadedShape && shapeBounds && (
                <defs>
                  <clipPath id={shapeClipId} clipPathUnits="userSpaceOnUse">
                    <path
                      d={uploadedShapePath(uploadedShape.image)}
                      transform={`translate(${shapeBounds.x} ${shapeBounds.y}) scale(${shapeBounds.width / uploadedShape.image.width} ${shapeBounds.height / uploadedShape.image.height})`}
                    />
                  </clipPath>
                </defs>
              )}
              <g clipPath={uploadedShape ? `url(#${shapeClipId})` : undefined}>
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
                      activeHighlight && activeHighlight !== word.term
                        ? 0.28
                        : 1
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
          <div
            className={`shape-fill-hint${fillHintOpen ? " is-open" : ""}`}
            onMouseEnter={() => {
              setFillHintHovered(true);
              setFillHintDismissed(false);
            }}
            onMouseLeave={() => setFillHintHovered(false)}
          >
            <button
              className="shape-fill-hint-trigger"
              type="button"
              aria-label={t("shapeFillHintLabel")}
              aria-describedby={fillHintId}
              aria-expanded={fillHintOpen}
              onFocus={() => {
                setFillHintFocused(true);
                setFillHintDismissed(false);
              }}
              onBlur={() => {
                setFillHintFocused(false);
                setFillHintPinned(false);
              }}
              onClick={() => {
                if (fillHintPinned) {
                  setFillHintPinned(false);
                  setFillHintDismissed(true);
                } else {
                  setFillHintPinned(true);
                  setFillHintDismissed(false);
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
              {t("shapeFillHint")}
            </span>
          </div>
        )}
        {noWordsFit && (
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
        )}
        {!noWordsFit && omittedCount > 0 && (
          <p className="canvas-warning">
            {t("omittedWords", { count: omittedCount })}
          </p>
        )}
      </div>
    </section>
  );
}
