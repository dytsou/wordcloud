import { useEffect, useRef, useState } from "react";
import type { LayoutStyle } from "../core/layout";
import { LIMITS } from "../core/limits";
import { TagInput } from "./TagInput";

type RangeDraft = Pick<LayoutStyle, "minFontSize" | "maxFontSize" | "padding">;

const PALETTE_PRESETS = [
  {
    id: "editorial-press",
    label: "銅版印刷",
    colors: ["#aa5948", "#27384a", "#5c6876", "#b86b58"],
  },
  {
    id: "campus-neon",
    label: "校園霓虹",
    colors: ["#ff9418", "#a8e61a", "#f3196d", "#9b73ff", "#45c7d9"],
  },
  {
    id: "night-market",
    label: "夜市霓光",
    colors: ["#ff006e", "#fb5607", "#ffbe0b", "#8338ec", "#3a86ff"],
  },
  {
    id: "moss-paper",
    label: "苔土紙張",
    colors: ["#283618", "#606c38", "#dda15e", "#bc6c25", "#f2cc8f"],
  },
] as const;

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
  presentation: LayoutStyle;
  disabled?: boolean;
  onChange: (presentation: LayoutStyle) => void;
}

export function StylePanel({
  presentation,
  disabled = false,
  onChange,
}: StylePanelProps) {
  const [draft, setDraft] = useState<RangeDraft>(() => rangeFrom(presentation));
  const draftRef = useRef(draft);
  const [angleDraft, setAngleDraft] = useState(() =>
    angleFrom(presentation.rotations),
  );
  const angleRef = useRef(angleDraft);
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
  const rotationLabel = angleDraft === 0 ? "水平" : `±${angleDraft}°`;
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
          <p className="section-kicker">03 / DIRECTION</p>
          <h2 id="style-heading">Set the atmosphere.</h2>
        </div>
        <span className="count-badge">REMIXABLE</span>
      </div>
      <p className="muted-note">
        大字構成主體，小字填入筆畫留白；只調整排版，不改配色。
      </p>
      <div className="field-row">
        <div className="field field-grow">
          <label className="field-label" htmlFor="font-family">
            字型 profile
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
            映射
          </label>
          <select
            id="scale"
            value={presentation.scale}
            disabled={disabled}
            onChange={(event) =>
              update({ scale: event.target.value as LayoutStyle["scale"] })
            }
          >
            <option value="sqrt">平方根</option>
            <option value="linear">線性</option>
            <option value="log">對數</option>
          </select>
        </div>
      </div>
      <div className="range-grid">
        <label className="range-field">
          <span>
            最小字級 <output>{draft.minFontSize}px</output>
          </span>
          <input
            type="range"
            aria-label="最小字級"
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
            最大字級 <output>{draft.maxFontSize}px</output>
          </span>
          <input
            type="range"
            aria-label="最大字級"
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
              <label htmlFor="word-spacing">詞間距</label>
              <span className="info-wrap">
                <button
                  className="info-button"
                  type="button"
                  aria-label="詞間距說明"
                  aria-describedby="spacing-help"
                  title="負值會縮小避讓區，適合接受輕微重疊的密集排版。"
                >
                  i
                </button>
                <span id="spacing-help" className="info-popover" role="tooltip">
                  負值會縮小避讓區，適合接受輕微重疊的密集排版。
                </span>
              </span>
            </span>
            <output>{draft.padding}px</output>
          </span>
          <input
            id="word-spacing"
            type="range"
            aria-label="詞間距"
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
              <label htmlFor="rotation-angle">旋轉方式</label>
              <span className="info-wrap">
                <button
                  className="info-button"
                  type="button"
                  aria-label="旋轉方式說明"
                  aria-describedby="rotation-help"
                  title="大字優先水平；小字在水平位置放不下時才以 0°、±設定角度填縫，上限 ±120°。"
                >
                  i
                </button>
                <span
                  id="rotation-help"
                  className="info-popover"
                  role="tooltip"
                >
                  大字優先水平；小字在水平位置放不下時才以
                  0°、±設定角度填縫，上限 ±120°。
                </span>
              </span>
            </span>
            <output>{rotationLabel}</output>
          </span>
          <input
            id="rotation-angle"
            type="range"
            aria-label="旋轉方式"
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
            色盤 <span>(每個色碼按 Enter)</span>
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
            背景
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
        <p className="field-label palette-presets-heading">預設組合</p>
        <div className="palette-preset-grid" role="group" aria-label="預設色盤">
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
              aria-label={"套用色盤：" + preset.label}
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
              <span className="palette-preset-name">{preset.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="field-row canvas-fields">
        <div className="field">
          <label className="field-label" htmlFor="canvas-width">
            畫布寬
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
            畫布高
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
      <p className="muted-note">
        顏色與背景只重繪；字型、字級、旋轉、間距與畫布會重新排版。
      </p>
    </section>
  );
}
