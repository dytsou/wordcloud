import type { LayoutStyle } from "../core/layout";

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
  const update = (patch: Partial<LayoutStyle>) =>
    onChange({ ...presentation, ...patch });
  const updateCanvas = (key: "width" | "height", value: string) =>
    update({ canvas: { ...presentation.canvas, [key]: Number(value) || 1 } });
  return (
    <section className="panel style-panel" aria-labelledby="style-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">03 / DIRECTION</p>
          <h2 id="style-heading">Set the atmosphere.</h2>
        </div>
        <span className="count-badge">REMIXABLE</span>
      </div>
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
            <option value="Noto Sans CJK TC">Noto Sans CJK TC</option>
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
            最小字級 <output>{presentation.minFontSize}px</output>
          </span>
          <input
            type="range"
            min="8"
            max="80"
            value={presentation.minFontSize}
            disabled={disabled}
            onChange={(event) =>
              update({ minFontSize: Number(event.target.value) })
            }
          />
        </label>
        <label className="range-field">
          <span>
            最大字級 <output>{presentation.maxFontSize}px</output>
          </span>
          <input
            type="range"
            min="24"
            max="160"
            value={presentation.maxFontSize}
            disabled={disabled}
            onChange={(event) =>
              update({ maxFontSize: Number(event.target.value) })
            }
          />
        </label>
        <label className="range-field">
          <span>
            詞間距 <output>{presentation.padding}px</output>
          </span>
          <input
            type="range"
            min="0"
            max="24"
            value={presentation.padding}
            disabled={disabled}
            onChange={(event) =>
              update({ padding: Number(event.target.value) })
            }
          />
        </label>
      </div>
      <div className="field-row">
        <div className="field field-grow">
          <label className="field-label" htmlFor="palette">
            色盤 <span>(hex, comma)</span>
          </label>
          <input
            id="palette"
            value={presentation.palette.join(", ")}
            disabled={disabled}
            onChange={(event) =>
              update({
                palette: event.target.value.split(/[,，\s]+/u).filter(Boolean),
              })
            }
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
      <div className="field-row canvas-fields">
        <div className="field">
          <label className="field-label" htmlFor="canvas-width">
            畫布寬
          </label>
          <input
            id="canvas-width"
            type="number"
            min="120"
            max="4096"
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
            max="4096"
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
