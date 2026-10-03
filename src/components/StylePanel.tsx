import { useEffect, useRef, useState } from "react";
import type { LayoutStyle } from "../core/layout";
import type { SceneModel } from "../core/scene";
import type { WordSet } from "../core/types";
import { ImageShapeEditor } from "./ImageShapeEditor";
import { ImageShapeComparison } from "./ImageShapeComparison";
import { LIMITS } from "../core/limits";
import {
  BUILT_IN_SHAPES,
  MAX_SHAPE_SCALE,
  MIN_SHAPE_SCALE,
  SHAPE_CATEGORIES,
  type BuiltInShape,
  type BuiltInShapeId,
  type ShapeCategory,
  type ShapeSettings,
} from "../core/shapes";
import { useI18n } from "../i18n";
import type { TranslationKey } from "../i18n/messages/types";
import { TagInput } from "./TagInput";

type RangeDraft = Pick<LayoutStyle, "minFontSize" | "maxFontSize" | "padding">;

const PALETTE_PRESETS = [
  {
    id: "editorial-press",
    labelKey: "paletteEditorial",
    colors: ["#aa5948", "#27384a", "#5c6876", "#b86b58"],
  },
  {
    id: "campus-neon",
    labelKey: "paletteCampus",
    colors: ["#ff9418", "#a8e61a", "#f3196d", "#9b73ff", "#45c7d9"],
  },
  {
    id: "night-market",
    labelKey: "paletteNight",
    colors: ["#ff006e", "#fb5607", "#ffbe0b", "#8338ec", "#3a86ff"],
  },
  {
    id: "moss-paper",
    labelKey: "paletteMoss",
    colors: ["#283618", "#606c38", "#dda15e", "#bc6c25", "#f2cc8f"],
  },
] as const;

const SHAPE_CATEGORY_LABELS = {
  basic: "shapeCategoryBasic",
  symbols: "shapeCategorySymbols",
  nature: "shapeCategoryNature",
  animals: "shapeCategoryAnimals",
  everyday: "shapeCategoryEveryday",
} as const satisfies Record<ShapeCategory, TranslationKey>;

const SHAPE_NAME_LABELS = {
  circle: "shapeNameCircle",
  ellipse: "shapeNameEllipse",
  square: "shapeNameSquare",
  rectangle: "shapeNameRectangle",
  triangle: "shapeNameTriangle",
  diamond: "shapeNameDiamond",
  hexagon: "shapeNameHexagon",
  star: "shapeNameStar",
  heart: "shapeNameHeart",
  "speech-bubble": "shapeNameSpeechBubble",
  "crescent-moon": "shapeNameCrescentMoon",
  "lightning-bolt": "shapeNameLightningBolt",
  "music-note": "shapeNameMusicNote",
  "smiling-face": "shapeNameSmilingFace",
  cloud: "shapeNameCloud",
  sun: "shapeNameSun",
  flower: "shapeNameFlower",
  leaf: "shapeNameLeaf",
  mountain: "shapeNameMountain",
  wave: "shapeNameWave",
  cat: "shapeNameCat",
  dog: "shapeNameDog",
  bird: "shapeNameBird",
  fish: "shapeNameFish",
  butterfly: "shapeNameButterfly",
  house: "shapeNameHouse",
  book: "shapeNameBook",
  "light-bulb": "shapeNameLightBulb",
  trophy: "shapeNameTrophy",
  "game-controller": "shapeNameGameController",
} as const satisfies Record<BuiltInShapeId, TranslationKey>;

function renderShapeRegion(
  region: BuiltInShape["regions"][number],
  fill: string,
  key: string,
) {
  if (region.kind === "ellipse") {
    return (
      <ellipse
        key={key}
        cx={region.center[0]}
        cy={region.center[1]}
        rx={region.radiusX}
        ry={region.radiusY}
        fill={fill}
      />
    );
  }
  return (
    <polygon
      key={key}
      points={region.points.map((point) => point.join(",")).join(" ")}
      fill={fill}
    />
  );
}

function ShapeThumbnail({ shape }: Readonly<{ shape: BuiltInShape }>) {
  const maskId = `shape-thumb-${shape.id}`;
  return (
    <svg
      className="shape-thumbnail"
      viewBox={`0 0 ${shape.aspectRatio} 1`}
      aria-hidden="true"
      focusable="false"
    >
      <mask
        id={maskId}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width={shape.aspectRatio}
        height="1"
      >
        <rect width={shape.aspectRatio} height="1" fill="black" />
        <g transform={`scale(${shape.aspectRatio} 1)`}>
          {shape.regions.map((region, index) =>
            renderShapeRegion(region, "white", `region-${index}`),
          )}
          {shape.holes?.map((region, index) =>
            renderShapeRegion(region, "black", `hole-${index}`),
          )}
        </g>
      </mask>
      <rect
        width={shape.aspectRatio}
        height="1"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}

function paletteMatches(
  current: readonly string[],
  candidate: readonly string[],
): boolean {
  return (
    current.length === candidate.length &&
    current.every(
      (color, index) => color.toLowerCase() === candidate[index]?.toLowerCase(),
    )
  );
}

function rangeFrom(presentation: LayoutStyle): RangeDraft {
  return {
    minFontSize: presentation.minFontSize,
    maxFontSize: presentation.maxFontSize,
    padding: presentation.padding,
  };
}

function angleFrom(rotations: number[]): number {
  return Math.min(
    120,
    Math.max(0, ...rotations.map((angle) => Math.abs(angle))),
  );
}

interface StylePanelProps {
  readonly presentation: LayoutStyle;
  readonly disabled?: boolean;
  readonly onChange: (presentation: LayoutStyle) => void;
  readonly scene?: SceneModel;
  readonly wordSet?: WordSet;
  readonly onWordsChange?: (wordSet: WordSet) => void;
  readonly onPreviewLayout?: (
    presentation: LayoutStyle,
    signal: AbortSignal,
  ) => Promise<SceneModel>;
  readonly onAdoptTrial?: (
    presentation: LayoutStyle,
    scene: SceneModel,
  ) => void;
  readonly onPendingShapeChange?: (pending: boolean) => void;
}

export function StylePanel({
  presentation,
  disabled: parentDisabled = false,
  onChange,
  scene,
  wordSet,
  onWordsChange,
  onPreviewLayout,
  onAdoptTrial,
  onPendingShapeChange,
}: StylePanelProps) {
  const { t } = useI18n();
  const [imagePending, setImagePending] = useState(false);
  const disabled = parentDisabled || imagePending;
  const [draft, setDraft] = useState<RangeDraft>(() => rangeFrom(presentation));
  const draftRef = useRef(draft);
  const [angleDraft, setAngleDraft] = useState(() =>
    angleFrom(presentation.rotations),
  );
  const angleRef = useRef(angleDraft);
  const [activeShapeCategory, setActiveShapeCategory] =
    useState<ShapeCategory>("basic");
  const [ratioLocked, setRatioLocked] = useState(
    () =>
      !presentation.shape ||
      presentation.shape.widthScale === presentation.shape.heightScale,
  );
  const [shapeDraft, setShapeDraft] = useState<ShapeSettings | undefined>(
    presentation.shape,
  );
  const shapeDraftRef = useRef(shapeDraft);
  const shapeSize =
    shapeDraft?.id === presentation.shape?.id ? shapeDraft : presentation.shape;
  useEffect(() => {
    const next = rangeFrom(presentation);
    draftRef.current = next;
    setDraft(next);
  }, [
    presentation.minFontSize,
    presentation.maxFontSize,
    presentation.padding,
  ]);
  useEffect(() => {
    const next = angleFrom(presentation.rotations);
    angleRef.current = next;
    setAngleDraft(next);
  }, [presentation.rotations]);
  useEffect(() => {
    const current = shapeDraftRef.current;
    const next = presentation.shape;
    const unchanged =
      current?.id === next?.id &&
      current?.widthScale === next?.widthScale &&
      current?.heightScale === next?.heightScale;
    shapeDraftRef.current = next;
    setShapeDraft(next);
    if (!unchanged) {
      setRatioLocked(!next || next.widthScale === next.heightScale);
    }
  }, [presentation.shape]);

  const editRange = (patch: Partial<RangeDraft>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
  };
  const commitRange = () => {
    const next = draftRef.current;
    if (
      next.minFontSize !== presentation.minFontSize ||
      next.maxFontSize !== presentation.maxFontSize ||
      next.padding !== presentation.padding
    ) {
      onChange({ ...presentation, ...next });
    }
  };
  const update = (patch: Partial<LayoutStyle>) =>
    onChange({ ...presentation, ...patch });
  const updateShape = (
    patch: Partial<Pick<ShapeSettings, "widthScale" | "heightScale">>,
  ) => {
    if (!presentation.shape) return;
    update({ shape: { ...presentation.shape, ...patch } });
  };
  const selectShape = (id?: BuiltInShapeId) => {
    setRatioLocked(true);
    const next = id ? { id, widthScale: 1, heightScale: 1 } : undefined;
    shapeDraftRef.current = next;
    setShapeDraft(next);
    update({ shape: next });
  };
  const setShapeSize = (axis: "width" | "height", value: string) => {
    const current = shapeDraftRef.current;
    const scale = Number(value);
    if (
      !current ||
      current.id !== presentation.shape?.id ||
      !Number.isFinite(scale)
    )
      return;
    let next: ShapeSettings;
    if (ratioLocked) {
      next = { ...current, widthScale: scale, heightScale: scale };
    } else if (axis === "width") {
      next = { ...current, widthScale: scale };
    } else {
      next = { ...current, heightScale: scale };
    }
    shapeDraftRef.current = next;
    setShapeDraft(next);
  };
  const commitShapeSize = () => {
    const next = shapeDraftRef.current;
    if (
      !next ||
      next.id !== presentation.shape?.id ||
      (next.widthScale === presentation.shape.widthScale &&
        next.heightScale === presentation.shape.heightScale)
    )
      return;
    updateShape({
      widthScale: next.widthScale,
      heightScale: next.heightScale,
    });
  };
  const resetShapeSize = () => {
    if (!presentation.shape) return;
    const next = {
      ...presentation.shape,
      widthScale: MAX_SHAPE_SCALE,
      heightScale: MAX_SHAPE_SCALE,
    };
    shapeDraftRef.current = next;
    setShapeDraft(next);
    setRatioLocked(true);
    update({ shape: next });
  };
  const updateCanvas = (key: "width" | "height", value: string) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return;
    const other =
      key === "width" ? presentation.canvas.height : presentation.canvas.width;
    const maxForDimension = Math.min(
      LIMITS.maxCanvasDimension,
      Math.floor(LIMITS.maxExportPixels / other),
    );
    const next = Math.min(parsed, maxForDimension);
    update({ canvas: { ...presentation.canvas, [key]: next } });
  };
  const updateFontRange = (
    key: "minFontSize" | "maxFontSize",
    value: string,
  ) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    if (key === "minFontSize") {
      editRange({ minFontSize: Math.min(next, draftRef.current.maxFontSize) });
    } else {
      editRange({ maxFontSize: Math.max(next, draftRef.current.minFontSize) });
    }
  };
  const rotationLabel = angleDraft === 0 ? t("horizontal") : `±${angleDraft}°`;
  const commitAngle = () => {
    const angle = angleRef.current;
    if (
      angle !== angleFrom(presentation.rotations) ||
      presentation.rotations.some((rotation) => Math.abs(rotation) > 120)
    ) {
      update({ rotations: angle === 0 ? [0] : [0, -angle, angle] });
    }
  };
  return (
    <section className="panel style-panel" aria-labelledby="style-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">{t("styleKicker")}</p>
          <h2 id="style-heading">{t("styleHeading")}</h2>
        </div>
        <span className="count-badge">{t("remixable")}</span>
      </div>
      <p className="muted-note">{t("styleNote")}</p>
      <div className="shape-controls">
        <p className="field-label shape-controls-heading">
          {t("shapeGalleryLabel")}
        </p>
        <button
          className={
            "shape-option shape-no-shape" +
            (!presentation.shape ? " is-active" : "")
          }
          type="button"
          disabled={disabled}
          aria-pressed={!presentation.shape}
          onClick={() => selectShape()}
        >
          <span className="shape-no-shape-mark" aria-hidden="true">
            ∅
          </span>
          <span>{t("shapeNoShape")}</span>
        </button>
        <ImageShapeEditor
          shape={
            presentation.shape?.id === "uploaded"
              ? presentation.shape
              : undefined
          }
          disabled={parentDisabled}
          background={presentation.background}
          onApply={(shape) => update({ shape })}
          onBackgroundChange={(background) => update({ background })}
          onPendingChange={(pending) => {
            setImagePending(pending);
            onPendingShapeChange?.(pending);
          }}
        />
        <fieldset
          className="shape-category-list"
          aria-label={t("shapeCategoryNavigation")}
        >
          {SHAPE_CATEGORIES.map((category) => (
            <button
              className="shape-category"
              key={category}
              type="button"
              disabled={disabled}
              aria-pressed={activeShapeCategory === category}
              onClick={() => setActiveShapeCategory(category)}
            >
              {t(SHAPE_CATEGORY_LABELS[category])}
            </button>
          ))}
        </fieldset>
        <fieldset className="shape-gallery" aria-label={t("shapeGalleryLabel")}>
          {BUILT_IN_SHAPES.filter(
            (shape) => shape.category === activeShapeCategory,
          ).map((shape) => (
            <button
              className={
                "shape-option" +
                (presentation.shape?.id === shape.id ? " is-active" : "")
              }
              key={shape.id}
              type="button"
              disabled={disabled}
              aria-pressed={presentation.shape?.id === shape.id}
              onClick={() => selectShape(shape.id)}
            >
              <ShapeThumbnail shape={shape} />
              <span>{t(SHAPE_NAME_LABELS[shape.id])}</span>
            </button>
          ))}
        </fieldset>
        {presentation.shape && shapeSize && (
          <div className="shape-size-controls">
            <label className="shape-ratio-lock">
              <input
                type="checkbox"
                checked={ratioLocked}
                disabled={disabled}
                onChange={(event) => setRatioLocked(event.target.checked)}
              />
              <span>{t("shapeLockRatio")}</span>
            </label>
            <div className="shape-size-grid">
              {ratioLocked ? (
                <label className="range-field">
                  <span>
                    {t("shapeSize")}{" "}
                    <output>{Math.round(shapeSize.widthScale * 100)}%</output>
                  </span>
                  <input
                    id="shape-size"
                    type="range"
                    aria-label={t("shapeSize")}
                    min={MIN_SHAPE_SCALE}
                    max={MAX_SHAPE_SCALE}
                    step="0.05"
                    value={shapeSize.widthScale}
                    disabled={disabled}
                    onPointerUp={commitShapeSize}
                    onPointerCancel={commitShapeSize}
                    onKeyUp={commitShapeSize}
                    onBlur={commitShapeSize}
                    onChange={(event) =>
                      setShapeSize("width", event.target.value)
                    }
                  />
                </label>
              ) : (
                <>
                  <label className="range-field">
                    <span>
                      {t("shapeWidth")}{" "}
                      <output>{Math.round(shapeSize.widthScale * 100)}%</output>
                    </span>
                    <input
                      id="shape-size"
                      type="range"
                      aria-label={t("shapeWidth")}
                      min={MIN_SHAPE_SCALE}
                      max={MAX_SHAPE_SCALE}
                      step="0.05"
                      value={shapeSize.widthScale}
                      disabled={disabled}
                      onPointerUp={commitShapeSize}
                      onPointerCancel={commitShapeSize}
                      onKeyUp={commitShapeSize}
                      onBlur={commitShapeSize}
                      onChange={(event) =>
                        setShapeSize("width", event.target.value)
                      }
                    />
                  </label>
                  <label className="range-field">
                    <span>
                      {t("shapeHeight")}{" "}
                      <output>
                        {Math.round(shapeSize.heightScale * 100)}%
                      </output>
                    </span>
                    <input
                      id="shape-height"
                      type="range"
                      aria-label={t("shapeHeight")}
                      min={MIN_SHAPE_SCALE}
                      max={MAX_SHAPE_SCALE}
                      step="0.05"
                      value={shapeSize.heightScale}
                      disabled={disabled}
                      onPointerUp={commitShapeSize}
                      onPointerCancel={commitShapeSize}
                      onKeyUp={commitShapeSize}
                      onBlur={commitShapeSize}
                      onChange={(event) =>
                        setShapeSize("height", event.target.value)
                      }
                    />
                  </label>
                </>
              )}
            </div>
            <button
              className="button button-quiet shape-reset"
              type="button"
              disabled={
                disabled ||
                (ratioLocked &&
                  shapeSize.widthScale === 1 &&
                  shapeSize.heightScale === 1)
              }
              onClick={resetShapeSize}
            >
              {t("shapeReset")}
            </button>
          </div>
        )}
      </div>
      {presentation.shape?.id === "uploaded" && (
        <ImageShapeComparison
          presentation={presentation}
          scene={scene}
          wordSet={wordSet}
          onWordsChange={onWordsChange}
          disabled={disabled}
          onPreview={onPreviewLayout}
          onAdopt={onAdoptTrial}
        />
      )}
      <div className="field-row">
        <div className="field field-grow">
          <label className="field-label" htmlFor="font-family">
            {t("fontProfile")}
          </label>
          <select
            id="font-family"
            value={presentation.fontFamily}
            disabled={disabled}
            onChange={(event) => update({ fontFamily: event.target.value })}
          >
            <option value="system-ui">System Sans</option>
            <option value="Georgia">Georgia Serif</option>
            <option value="Trebuchet MS">Trebuchet MS</option>
            <option value="Noto Sans CJK TC, system-ui">
              Noto Sans CJK TC
            </option>
            <option value="Noto Sans CJK TC">Noto Sans CJK TC (legacy)</option>
            <option value="Noto Sans Thai">Noto Sans Thai</option>
          </select>
        </div>
        <div className="field field-small">
          <label className="field-label" htmlFor="scale">
            {t("scale")}
          </label>
          <select
            id="scale"
            value={presentation.scale}
            disabled={disabled}
            onChange={(event) =>
              update({ scale: event.target.value as LayoutStyle["scale"] })
            }
          >
            <option value="sqrt">{t("sqrt")}</option>
            <option value="linear">{t("linear")}</option>
            <option value="log">{t("log")}</option>
          </select>
        </div>
      </div>
      <div className="range-grid">
        <label className="range-field">
          <span>
            {t("minFontSize")} <output>{draft.minFontSize}px</output>
          </span>
          <input
            type="range"
            aria-label={t("minFontSize")}
            min="8"
            max="80"
            value={draft.minFontSize}
            disabled={disabled}
            onPointerUp={commitRange}
            onPointerCancel={commitRange}
            onKeyUp={commitRange}
            onBlur={commitRange}
            onChange={(event) =>
              updateFontRange("minFontSize", event.target.value)
            }
          />
        </label>
        <label className="range-field">
          <span>
            {t("maxFontSize")} <output>{draft.maxFontSize}px</output>
          </span>
          <input
            type="range"
            aria-label={t("maxFontSize")}
            min="24"
            max="160"
            value={draft.maxFontSize}
            disabled={disabled}
            onPointerUp={commitRange}
            onPointerCancel={commitRange}
            onKeyUp={commitRange}
            onBlur={commitRange}
            onChange={(event) =>
              updateFontRange("maxFontSize", event.target.value)
            }
          />
        </label>
        <div className="range-field">
          <span>
            <span className="range-label">
              <label htmlFor="word-spacing">{t("wordSpacing")}</label>
              <span className="info-wrap">
                <button
                  className="info-button"
                  type="button"
                  aria-label={t("spacingInfoLabel")}
                  aria-describedby="spacing-help"
                  title={t("spacingHelp")}
                >
                  i
                </button>
                <span id="spacing-help" className="info-popover" role="tooltip">
                  {t("spacingHelp")}
                </span>
              </span>
            </span>
            <output>{draft.padding}px</output>
          </span>
          <input
            id="word-spacing"
            type="range"
            aria-label={t("wordSpacing")}
            min={LIMITS.minPadding}
            max="24"
            value={draft.padding}
            disabled={disabled}
            onPointerUp={commitRange}
            onPointerCancel={commitRange}
            onKeyUp={commitRange}
            onBlur={commitRange}
            onChange={(event) =>
              editRange({ padding: Number(event.target.value) })
            }
          />
        </div>
      </div>
      <div className="rotation-controls">
        <div className="range-field rotation-range">
          <span>
            <span className="range-label">
              <label htmlFor="rotation-angle">{t("rotation")}</label>
              <span className="info-wrap">
                <button
                  className="info-button"
                  type="button"
                  aria-label={t("rotationInfoLabel")}
                  aria-describedby="rotation-help"
                  title={t("rotationHelp")}
                >
                  i
                </button>
                <span
                  id="rotation-help"
                  className="info-popover"
                  role="tooltip"
                >
                  {t("rotationHelp")}
                </span>
              </span>
            </span>
            <output>{rotationLabel}</output>
          </span>
          <input
            id="rotation-angle"
            type="range"
            aria-label={t("rotation")}
            min="0"
            max="120"
            step="1"
            value={angleDraft}
            disabled={disabled}
            onPointerUp={commitAngle}
            onPointerCancel={commitAngle}
            onKeyUp={commitAngle}
            onBlur={commitAngle}
            onChange={(event) => {
              const angle = Number(event.target.value);
              angleRef.current = angle;
              setAngleDraft(angle);
            }}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field field-grow">
          <label className="field-label" htmlFor="palette">
            {t("palette")} <span>{t("paletteSuffix")}</span>
          </label>
          <TagInput
            id="palette"
            value={presentation.palette}
            disabled={disabled}
            onChange={(palette) => update({ palette })}
            placeholder="#aa5948"
          />
        </div>
        <div className="field field-small">
          <label className="field-label" htmlFor="background">
            {t("background")}
          </label>
          <input
            id="background"
            type="color"
            value={presentation.background}
            disabled={disabled}
            onChange={(event) => update({ background: event.target.value })}
          />
        </div>
      </div>
      <div className="palette-presets">
        <p className="field-label palette-presets-heading">
          {t("palettePresets")}
        </p>
        <fieldset
          className="palette-preset-grid"
          aria-label={t("paletteGroup")}
        >
          {PALETTE_PRESETS.map((preset) => (
            <button
              className={
                "palette-preset" +
                (paletteMatches(presentation.palette, preset.colors)
                  ? " is-active"
                  : "")
              }
              key={preset.id}
              type="button"
              disabled={disabled}
              aria-label={t("applyPalette", { label: t(preset.labelKey) })}
              aria-pressed={paletteMatches(presentation.palette, preset.colors)}
              onClick={() => update({ palette: [...preset.colors] })}
            >
              <span className="palette-swatch-row" aria-hidden="true">
                {preset.colors.map((color) => (
                  <span
                    className="palette-swatch"
                    key={color}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
              <span className="palette-preset-name">{t(preset.labelKey)}</span>
            </button>
          ))}
        </fieldset>
      </div>
      <div className="field-row canvas-fields">
        <div className="field">
          <label className="field-label" htmlFor="canvas-width">
            {t("canvasWidth")}
          </label>
          <input
            id="canvas-width"
            type="number"
            min="120"
            max={LIMITS.maxCanvasDimension}
            value={presentation.canvas.width}
            disabled={disabled}
            onChange={(event) => updateCanvas("width", event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="canvas-height">
            {t("canvasHeight")}
          </label>
          <input
            id="canvas-height"
            type="number"
            min="120"
            max={LIMITS.maxCanvasDimension}
            value={presentation.canvas.height}
            disabled={disabled}
            onChange={(event) => updateCanvas("height", event.target.value)}
          />
        </div>
      </div>
      <p className="muted-note">{t("styleChangeNote")}</p>
    </section>
  );
}
