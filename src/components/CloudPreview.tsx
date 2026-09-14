import { useState } from "react";
import type { SceneModel } from "../core/scene";

interface CloudPreviewProps {
  scene?: SceneModel;
  highlightedTerm?: string;
}

export function CloudPreview({ scene, highlightedTerm }: CloudPreviewProps) {
  const [zoom, setZoom] = useState(1);
  return (
    <section className="preview-stage" aria-labelledby="preview-heading">
      <div className="preview-topline">
        <div>
          <p className="section-kicker">LIVE CANVAS</p>
          <h2 id="preview-heading">A cloud with a point of view.</h2>
        </div>
        <div className="zoom-control" aria-label="預覽縮放">
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(0.7, value - 0.1))}
            aria-label="縮小"
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(1.3, value + 0.1))}
            aria-label="放大"
          >
            +
          </button>
        </div>
      </div>
      <div
        className="canvas-frame"
        style={{ background: scene?.background ?? "#f7f0df" }}
      >
        {scene ? (
          <svg
            className="cloud-svg"
            viewBox={`0 0 ${scene.canvas.width} ${scene.canvas.height}`}
            role="img"
            aria-label="文字雲預覽"
            style={{
              transform: `scale(${zoom})`,
              fontFamily: scene.fontFamily,
            }}
          >
            <title>文字雲預覽</title>
            {scene.words
              .filter((word) => word.status === "placed")
              .map((word) => (
                <text
                  key={`${word.term}-${word.rank}`}
                  x={word.x + word.width / 2}
                  y={word.y + word.height * 0.78}
                  textAnchor="middle"
                  fill={word.color}
                  fontSize={word.fontSize}
                  transform={`rotate(${word.angle} ${word.x + word.width / 2} ${word.y + word.height / 2})`}
                  opacity={
                    highlightedTerm && highlightedTerm !== word.term ? 0.28 : 1
                  }
                >
                  {word.term}
                </text>
              ))}
          </svg>
        ) : (
          <div className="canvas-empty">
            <span className="empty-orbit">✳</span>
            <p>
              你的詞語會在這裡
              <br />
              <em>長出形狀。</em>
            </p>
          </div>
        )}
        {scene && scene.words.some((word) => word.status !== "placed") && (
          <p className="canvas-warning">
            {scene.words.filter((word) => word.status !== "placed").length}{" "}
            個詞語未能放入目前畫布，請查看下方索引。
          </p>
        )}
      </div>
    </section>
  );
}
