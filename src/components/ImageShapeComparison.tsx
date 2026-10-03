import { useEffect, useId, useRef, useState } from "react";
import type { LayoutStyle } from "../core/layout";
import {
  decodeUploadedShapeImage,
  fitUploadedImageBounds,
  uploadedShapePath,
  type RasterImage,
  type UploadedShapeSettings,
} from "../core/image-shape";
import { LIMITS, scalarLength } from "../core/limits";
import type { SceneModel } from "../core/scene";
import type { Word, WordSet } from "../core/types";
import { ImageShapeRasterView } from "./ImageShapeEditor";
import {
  type ImageShapeMessage,
  useImageShapeMessages,
} from "./image-shape-messages";

export interface ImageShapeComparisonProps {
  presentation: LayoutStyle;
  scene?: SceneModel;
  disabled?: boolean;
  onPreview?: (
    presentation: LayoutStyle,
    signal: AbortSignal,
  ) => Promise<SceneModel>;
  onAdopt?: (presentation: LayoutStyle, scene: SceneModel) => void;
  wordSet?: WordSet;
  onWordsChange?: (wordSet: WordSet) => void;
}
interface Trial {
  title: ImageShapeMessage;
  presentation: LayoutStyle;
  scene: SceneModel;
}

function SceneThumbnail({
  scene,
  label,
}: {
  scene: SceneModel;
  label: string;
}) {
  const id = useId();
  const shape = scene.shape?.id === "uploaded" ? scene.shape : undefined;
  const bounds = shape
    ? fitUploadedImageBounds(
        shape.image,
        scene.canvas,
        shape.widthScale,
        shape.heightScale,
      )
    : undefined;
  return (
    <svg
      className="image-shape-scene"
      viewBox={`0 0 ${scene.canvas.width} ${scene.canvas.height}`}
      role="img"
      aria-label={label}
      style={{ background: scene.background, fontFamily: scene.fontFamily }}
    >
      <title>{label}</title>
      {shape && bounds && (
        <defs>
          <clipPath id={id}>
            <path
              d={uploadedShapePath(shape.image)}
              transform={`translate(${bounds.x} ${bounds.y}) scale(${bounds.width / shape.image.width} ${bounds.height / shape.image.height})`}
            />
          </clipPath>
        </defs>
      )}
      <g clipPath={shape ? `url(#${id})` : undefined}>
        {scene.words
          .filter((word) => word.status === "placed")
          .map((word) => (
            <text
              key={word.rank}
              x={word.x + word.width / 2}
              y={word.y + word.height / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={word.fontSize}
              fontWeight={500}
              fill={word.color}
              transform={`rotate(${word.angle} ${word.x + word.width / 2} ${word.y + word.height / 2})`}
            >
              {word.term}
            </text>
          ))}
      </g>
    </svg>
  );
}

function glyphCoverage(
  shape: UploadedShapeSettings,
  scene: SceneModel,
): { raster: RasterImage; percent: string } {
  const { raster, mask } = decodeUploadedShapeImage(shape.image);
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Word coverage canvas is unavailable.");
  const bounds = fitUploadedImageBounds(
    shape.image,
    scene.canvas,
    shape.widthScale,
    shape.heightScale,
  );
  context.scale(raster.width / bounds.width, raster.height / bounds.height);
  context.translate(-bounds.x, -bounds.y);
  context.fillStyle = "#000000";
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const word of scene.words) {
    if (word.status !== "placed") continue;
    context.save();
    context.translate(word.x + word.width / 2, word.y + word.height / 2);
    context.rotate((word.angle * Math.PI) / 180);
    context.font = `500 ${word.fontSize}px ${scene.fontFamily}`;
    context.fillText(word.term, 0, 0);
    context.restore();
  }
  const ink = context.getImageData(0, 0, raster.width, raster.height).data;
  const rgba = new Uint8ClampedArray(raster.rgba.length);
  let retained = 0;
  let covered = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    retained += 1;
    const offset = index * 4;
    const hasInk = ink[offset + 3] >= 16;
    if (hasInk) covered += 1;
    rgba[offset] = hasInk ? 7 : 230;
    rgba[offset + 1] = hasInk ? 91 : 138;
    rgba[offset + 2] = hasInk ? 102 : 48;
    rgba[offset + 3] = hasInk ? 100 : 235;
  }
  canvas.width = 0;
  canvas.height = 0;
  return {
    raster: { ...raster, rgba },
    percent: retained ? ((covered / retained) * 100).toFixed(1) : "0.0",
  };
}

function Coverage({
  shape,
  scene,
}: {
  shape: UploadedShapeSettings;
  scene: SceneModel;
}) {
  const m = useImageShapeMessages();
  const [coverage, setCoverage] = useState<ReturnType<typeof glyphCoverage>>();
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setCoverage(undefined);
    setError("");
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (cancelled) return;
      try {
        setCoverage(glyphCoverage(shape, scene));
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Word coverage could not be measured.",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [shape, scene]);
  return (
    <figure className="image-shape-coverage">
      <figcaption>{m("uncovered")}</figcaption>
      {coverage && (
        <>
          <ImageShapeRasterView
            raster={coverage.raster}
            label={m("coverage", { percent: coverage.percent })}
          />
          <p className="image-shape-coverage-count">
            {m("coverage", { percent: coverage.percent })}
          </p>
        </>
      )}
      {error && (
        <p className="image-shape-error" role="alert">
          {error}
        </p>
      )}
    </figure>
  );
}

function PlacementCounts({ scene }: { scene: SceneModel }) {
  const m = useImageShapeMessages();
  const counts: { key: ImageShapeMessage; count: number }[] = [
    {
      key: "placed",
      count: scene.words.filter((word) => word.status === "placed").length,
    },
    {
      key: "noFit",
      count: scene.words.filter((word) => word.reason === "no-fit").length,
    },
    {
      key: "budget",
      count: scene.words.filter(
        (word) =>
          word.reason === "probe-budget" ||
          (word.status === "budget-limited" && !word.reason),
      ).length,
    },
    {
      key: "cancelled",
      count: scene.words.filter((word) => word.reason === "cancelled").length,
    },
    {
      key: "invalid",
      count: scene.words.filter((word) => word.reason === "invalid-canvas")
        .length,
    },
  ];
  return (
    <dl className="image-shape-counts">
      {counts
        .filter(({ key, count }) => key !== "invalid" || count > 0)
        .map(({ key, count }) => (
          <div key={key}>
            <dt>{m(key)}</dt>
            <dd>{count}</dd>
          </div>
        ))}
    </dl>
  );
}

function forbiddenTermCharacter(term: string): boolean {
  return Array.from(term).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      code < 32 ||
      (code >= 127 && code <= 159) ||
      code === 0x061c ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    );
  });
}

function parseDerivedWords(
  input: string,
  previous: WordSet,
  m: ReturnType<typeof useImageShapeMessages>,
): WordSet {
  const lines = input.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length === 0 || lines.length > LIMITS.maxWordsPerCloud)
    throw new Error(m("wordLimit", { max: LIMITS.maxWordsPerCloud }));
  const seen = new Set<string>();
  const locales = new Map(
    previous.words.map((word) => [word.term, word.locale]),
  );
  const words: Word[] = lines.map((line, firstSeen) => {
    const fields = line.split("\t");
    if (fields.length !== 2)
      throw new Error(m("wordLineFormat", { line: firstSeen + 1 }));
    const term = fields[0].trim().normalize("NFC");
    if (
      !term ||
      scalarLength(term) > LIMITS.maxLiteralScalars ||
      forbiddenTermCharacter(term)
    )
      throw new Error(
        m("wordTerm", {
          line: firstSeen + 1,
          max: LIMITS.maxLiteralScalars,
        }),
      );
    if (seen.has(term))
      throw new Error(m("wordDuplicate", { line: firstSeen + 1 }));
    seen.add(term);
    const countText = fields[1].trim();
    const count = Number(countText);
    if (
      !/^[1-9]\d*$/u.test(countText) ||
      !Number.isSafeInteger(count) ||
      count > LIMITS.maxCandidateTokens
    )
      throw new Error(
        m("wordCount", {
          line: firstSeen + 1,
          max: LIMITS.maxCandidateTokens,
        }),
      );
    return {
      term,
      count,
      firstSeen,
      rank: 0,
      locale: locales.get(term) ?? previous.locale,
    };
  });
  const totalTokens = words.reduce((sum, word) => sum + word.count, 0);
  if (totalTokens > LIMITS.maxCandidateTokens)
    throw new Error(m("wordTotal", { max: LIMITS.maxCandidateTokens }));
  words.sort((a, b) => b.count - a.count || a.firstSeen - b.firstSeen);
  words.forEach((word, index) => {
    word.rank = index + 1;
  });
  return { ...previous, words, totalTokens };
}

function DerivedWordEditor({
  wordSet,
  disabled,
  onChange,
}: {
  wordSet: WordSet;
  disabled: boolean;
  onChange: (wordSet: WordSet) => void;
}) {
  const m = useImageShapeMessages();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const id = useId();
  useEffect(() => {
    setDraft(
      wordSet.words.map((word) => `${word.term}\t${word.count}`).join("\n"),
    );
    setError("");
  }, [wordSet]);
  return (
    <details className="image-shape-details image-shape-words">
      <summary>{m("editWords")}</summary>
      <label htmlFor={id} className="field-label">
        {m("wordsFormat")}
      </label>
      <textarea
        id={id}
        value={draft}
        disabled={disabled}
        maxLength={40_000}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
      />
      <p className="field-hint">{m("wordsHelp")}</p>
      {error && (
        <p className="image-shape-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="button button-quiet"
        disabled={disabled}
        onClick={() => {
          try {
            const next = parseDerivedWords(draft, wordSet, m);
            setError("");
            onChange(next);
          } catch (failure) {
            setError(
              failure instanceof Error ? failure.message : m("wordApplyError"),
            );
          }
        }}
      >
        {m("applyWords")}
      </button>
    </details>
  );
}

export function ImageShapeComparison({
  presentation,
  scene,
  disabled = false,
  onPreview,
  onAdopt,
  wordSet,
  onWordsChange,
}: ImageShapeComparisonProps) {
  const m = useImageShapeMessages();
  const id = useId();
  const [trials, setTrials] = useState<Trial[]>([]);
  const [running, setRunning] = useState(0);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const previewCallback = useRef(onPreview);
  previewCallback.current = onPreview;
  useEffect(() => {
    generation.current += 1;
    controller.current?.abort();
    setTrials([]);
    setRunning(0);
    setError("");
    return () => {
      generation.current += 1;
      controller.current?.abort();
    };
  }, [presentation, scene, wordSet]);
  const shape =
    presentation.shape?.id === "uploaded" ? presentation.shape : undefined;
  if (!shape) return null;
  const foreground = decodeUploadedShapeImage(shape.image).raster;
  const stop = () => {
    generation.current += 1;
    controller.current?.abort();
    setRunning(0);
  };
  const start = async () => {
    const preview = previewCallback.current;
    if (!preview || disabled || running) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const sequence = ++generation.current;
    setTrials([]);
    setError("");
    const variations: {
      title: ImageShapeMessage;
      presentation: LayoutStyle;
    }[] = [
      {
        title: "smaller",
        presentation: {
          ...presentation,
          minFontSize: Math.max(8, Math.round(presentation.minFontSize * 0.75)),
          maxFontSize: Math.max(
            24,
            Math.round(presentation.maxFontSize * 0.75),
          ),
        },
      },
      {
        title: "horizontal",
        presentation: { ...presentation, rotations: [0] },
      },
      shape.colorBoundary
        ? {
            title: "relaxed",
            presentation: {
              ...presentation,
              shape: { ...shape, colorBoundary: false },
            },
          }
        : {
            title: "alternate",
            presentation: {
              ...presentation,
              fontFamily:
                presentation.fontFamily === "Georgia" ? "system-ui" : "Georgia",
            },
          },
    ];
    try {
      for (let index = 0; index < variations.length; index += 1) {
        if (abort.signal.aborted || sequence !== generation.current) return;
        setRunning(index + 1);
        const variation = variations[index];
        const nextScene = await preview(variation.presentation, abort.signal);
        if (abort.signal.aborted || sequence !== generation.current) return;
        setTrials((current) => [
          ...current,
          { ...variation, scene: nextScene },
        ]);
      }
    } catch (failure) {
      if (!abort.signal.aborted && sequence === generation.current)
        setError(
          failure instanceof Error ? failure.message : "Layout trials failed.",
        );
    } finally {
      if (sequence === generation.current) setRunning(0);
    }
  };
  return (
    <section
      className="image-shape-comparison"
      aria-labelledby={`${id}-heading`}
    >
      <h3 id={`${id}-heading`}>{m("comparison")}</h3>
      <div className="image-shape-preview-pair">
        <figure>
          <figcaption>{m("foreground")}</figcaption>
          <ImageShapeRasterView raster={foreground} label={m("foreground")} />
        </figure>
        <figure>
          <figcaption>{m("actual")}</figcaption>
          {scene ? (
            <SceneThumbnail scene={scene} label={m("actual")} />
          ) : (
            <p className="field-hint">{m("noScene")}</p>
          )}
        </figure>
      </div>
      {scene && (
        <>
          <Coverage shape={shape} scene={scene} />
          <p className="field-hint">{m("coverageHelp")}</p>
          <PlacementCounts scene={scene} />
          <p className="field-hint">{m("statusHelp")}</p>
        </>
      )}
      {wordSet && onWordsChange && (
        <DerivedWordEditor
          wordSet={wordSet}
          disabled={disabled || running > 0}
          onChange={onWordsChange}
        />
      )}
      {onPreview && (
        <>
          <div className="image-shape-actions">
            <button
              type="button"
              className="button button-quiet"
              disabled={disabled || running > 0 || !scene}
              onClick={() => void start()}
            >
              {m("trials")}
            </button>
            {running > 0 && (
              <button
                type="button"
                className="button button-quiet"
                onClick={stop}
              >
                {m("stop")}
              </button>
            )}
          </div>
          <p className="field-hint">{m("trialsHelp")}</p>
        </>
      )}
      {running > 0 && (
        <p className="image-shape-status" role="status">
          {m("trialRunning", { number: running })}
        </p>
      )}
      {error && (
        <p className="image-shape-error" role="alert">
          {error}
        </p>
      )}
      {trials.length > 0 && (
        <div className="image-shape-trials">
          {trials.map((trial) => (
            <article key={trial.title}>
              <h4>{m(trial.title)}</h4>
              <SceneThumbnail scene={trial.scene} label={m(trial.title)} />
              <PlacementCounts scene={trial.scene} />
              <Coverage
                shape={trial.presentation.shape as UploadedShapeSettings}
                scene={trial.scene}
              />
              {onAdopt && (
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={disabled || running > 0}
                  onClick={() => onAdopt(trial.presentation, trial.scene)}
                >
                  {m("adopt")}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
