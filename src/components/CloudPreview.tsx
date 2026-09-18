import { useState } from "react";
import type { SceneModel } from "../core/scene";
import { useI18n } from "../i18n";
import { renderAccessibleSummary } from "../render/accessibility";
import { placedSceneWords } from "../render/safe-scene";

interface CloudPreviewProps {
  scene?: SceneModel;
  highlightedTerm?: string;
}

export function CloudPreview({ scene, highlightedTerm }: CloudPreviewProps) {
  const [zoom, setZoom] = useState(1);
  const { t } = useI18n();
  const placedWords = scene ? placedSceneWords(scene) : [];
  const accessibleSummary = scene ? renderAccessibleSummary(scene) : undefined;
  const omittedCount = scene ? scene.words.length - placedWords.length : 0;
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
      <p className="preview-caption">{t("previewCaption")}</p>
      <div
        className="canvas-frame"
        style={{ background: scene?.background ?? "#edf2f4" }}
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
        {omittedCount > 0 && (
          <p className="canvas-warning">
            {t("omittedWords", { count: omittedCount })}
          </p>
        )}
      </div>
    </section>
  );
}
