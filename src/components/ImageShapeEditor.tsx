import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  loadImageRaster,
  processForeground,
  processSubject,
} from "../app/image-processing";
import {
  decodeUploadedShapeImage,
  encodeUploadedShapeImage,
  type ImageRect,
  type RasterImage,
  suggestImageBackgrounds,
  type UploadedShapeImage,
  type UploadedShapeSettings,
} from "../core/image-shape";
import { utf8ByteLength } from "../core/limits";
import {
  type ImagePoint,
  paintMask,
  paintSeeds,
} from "../core/image-segmentation";
import { useImageShapeMessages } from "./image-shape-messages";
import "../styles/image-shape.css";

export interface ImageShapeEditorProps {
  shape?: UploadedShapeSettings;
  disabled?: boolean;
  background: string;
  onApply: (shape: UploadedShapeSettings) => void;
  onBackgroundChange: (background: string) => void;
  onPendingChange: (pending: boolean) => void;
}

interface EditState {
  mask: Uint8Array;
  seeds: Int8Array;
  box?: ImageRect;
}
interface ImageSession extends EditState {
  raster: RasterImage;
  initialMask: Uint8Array;
  sourceAvailable: boolean;
  sourceUrl?: string;
  asset?: UploadedShapeImage;
}
type Tool = "keep" | "remove" | "markKeep" | "markRemove" | "box";

function visibleMask(mask: Uint8Array, raster: RasterImage): Uint8Array {
  return mask.map((value, index) =>
    raster.rgba[index * 4 + 3] >= 16 ? value : 0,
  );
}

function drawRaster(
  canvas: HTMLCanvasElement,
  raster: RasterImage,
  mask?: Uint8Array,
  seeds?: Int8Array,
) {
  if (canvas.width !== raster.width) canvas.width = raster.width;
  if (canvas.height !== raster.height) canvas.height = raster.height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const rgba = raster.rgba.slice();
  if (mask) {
    for (let index = 0; index < mask.length; index += 1) {
      const offset = index * 4;
      if (!mask[index]) {
        rgba[offset] = 160;
        rgba[offset + 1] = 83;
        rgba[offset + 2] = 83;
        rgba[offset + 3] = raster.rgba[offset + 3] > 0 ? 55 : 0;
      }
      if (seeds?.[index]) {
        rgba[offset] = seeds[index] === 1 ? 58 : 238;
        rgba[offset + 1] = seeds[index] === 1 ? 211 : 91;
        rgba[offset + 2] = seeds[index] === 1 ? 126 : 166;
        rgba[offset + 3] = 255;
      }
    }
  }
  context.putImageData(new ImageData(rgba, raster.width, raster.height), 0, 0);
}

/** A canvas with a native text alternative; its backing raster is bounded to 192px. */
export function ImageShapeRasterView({
  raster,
  label,
  mask,
}: {
  raster: RasterImage;
  label: string;
  mask?: Uint8Array;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) drawRaster(canvas.current, raster, mask);
  }, [raster, mask]);
  return (
    <canvas
      className="image-shape-raster"
      ref={canvas}
      role="img"
      aria-label={label}
    >
      {label}
    </canvas>
  );
}

export function ImageShapeEditor({
  shape,
  disabled = false,
  background,
  onApply,
  onBackgroundChange,
  onPendingChange,
}: ImageShapeEditorProps) {
  const m = useImageShapeMessages();
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pendingCallback = useRef(onPendingChange);
  pendingCallback.current = onPendingChange;
  const [session, setSession] = useState<ImageSession>();
  const sessionRef = useRef(session);
  const confirmedSession = useRef<ImageSession | undefined>(undefined);
  const sourceUrls = useRef(new Set<string>());
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tool, setTool] = useState<Tool>("keep");
  const [radius, setRadius] = useState(4);
  const [tolerance, setTolerance] = useState(24);
  const [holes, setHoles] = useState(false);
  const [cursor, setCursor] = useState<ImagePoint>({ x: 0, y: 0 });
  const [undoHistory, setUndoHistory] = useState<EditState[]>([]);
  const controller = useRef<AbortController | null>(null);
  const job = useRef(0);
  const gesture = useRef<
    { pointer: number; start: ImagePoint; last: ImagePoint } | undefined
  >(undefined);
  const locked = disabled || busy;
  const editRaster = session?.raster;
  const editMask = session?.mask;
  const editSeeds = session?.seeds;

  const updateSession = (next: ImageSession | undefined) => {
    sessionRef.current = next;
    setSession(next);
    for (const url of sourceUrls.current) {
      if (
        url === next?.sourceUrl ||
        url === confirmedSession.current?.sourceUrl
      )
        continue;
      URL.revokeObjectURL(url);
      sourceUrls.current.delete(url);
    }
  };
  const clearHistory = () => {
    setUndoHistory([]);
  };
  const saveUndo = () => {
    const current = sessionRef.current;
    if (!current) return;
    setUndoHistory((history) => [
      ...history.slice(-23),
      {
        mask: current.mask,
        seeds: current.seeds,
        box: current.box,
      },
    ]);
  };

  useEffect(() => {
    pendingCallback.current(editing || busy);
  }, [editing, busy]);
  useEffect(
    () => () => {
      job.current += 1;
      controller.current?.abort();
      sourceUrls.current.forEach((url) => URL.revokeObjectURL(url));
      sourceUrls.current.clear();
      pendingCallback.current(false);
    },
    [],
  );
  useEffect(() => {
    if (shape?.image === sessionRef.current?.asset) return;
    job.current += 1;
    controller.current?.abort();
    setBusy(false);
    setEditing(false);
    setError("");
    setUndoHistory([]);
    if (!shape) {
      confirmedSession.current = undefined;
      updateSession(undefined);
      return;
    }
    const decoded = decodeUploadedShapeImage(shape.image);
    const next: ImageSession = {
      raster: decoded.raster,
      mask: decoded.mask,
      initialMask: decoded.mask,
      seeds: new Int8Array(decoded.mask.length),
      sourceAvailable: false,
      asset: shape.image,
    };
    confirmedSession.current = next;
    updateSession(next);
  }, [shape?.image]);
  useEffect(() => {
    if (canvas.current && editRaster)
      drawRaster(canvas.current, editRaster, editMask, editSeeds);
  }, [editMask, editRaster, editSeeds, editing]);

  const run = async (
    operation: (signal: AbortSignal) => Promise<ImageSession>,
  ) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const sequence = ++job.current;
    setBusy(true);
    setError("");
    try {
      const next = await operation(abort.signal);
      if (abort.signal.aborted || sequence !== job.current) {
        if (
          next.sourceUrl &&
          next.sourceUrl !== sessionRef.current?.sourceUrl &&
          next.sourceUrl !== confirmedSession.current?.sourceUrl
        ) {
          URL.revokeObjectURL(next.sourceUrl);
          sourceUrls.current.delete(next.sourceUrl);
        }
        return;
      }
      updateSession(next);
    } catch (failure) {
      if (abort.signal.aborted || sequence !== job.current) return;
      setError(
        failure instanceof Error ? failure.message : "Image processing failed.",
      );
    } finally {
      if (sequence === job.current) setBusy(false);
    }
  };

  const upload = (file?: File) => {
    if (!file || disabled) return;
    setEditing(true);
    clearHistory();
    setCursor({ x: 0, y: 0 });
    void run(async (signal) => {
      const raster = await loadImageRaster(file, signal);
      const mask = await processForeground(
        raster,
        { tolerance, includeEnclosedBackground: holes },
        signal,
      );
      const sourceUrl = URL.createObjectURL(file);
      sourceUrls.current.add(sourceUrl);
      return {
        raster,
        mask,
        initialMask: mask,
        seeds: new Int8Array(mask.length),
        sourceAvailable: true,
        sourceUrl,
      };
    });
  };
  const cancel = () => {
    job.current += 1;
    controller.current?.abort();
    setBusy(false);
    setEditing(false);
    setError("");
    clearHistory();
    if (shape) {
      const current = confirmedSession.current;
      const decoded = decodeUploadedShapeImage(shape.image);
      updateSession(
        current?.asset === shape.image
          ? {
              ...current,
              mask: decoded.mask,
              seeds: new Int8Array(decoded.mask.length),
              box: undefined,
            }
          : {
              ...decoded,
              initialMask: decoded.mask,
              seeds: new Int8Array(decoded.mask.length),
              sourceAvailable: false,
              asset: shape.image,
            },
      );
    } else {
      confirmedSession.current = undefined;
      updateSession(undefined);
    }
  };
  const detect = () => {
    const current = sessionRef.current;
    if (!current || locked) return;
    saveUndo();
    void run(async (signal) => ({
      ...current,
      mask: await processForeground(
        current.raster,
        { tolerance, includeEnclosedBackground: holes },
        signal,
      ),
    }));
  };
  const findSubject = () => {
    const current = sessionRef.current;
    if (!current || locked) return;
    saveUndo();
    void run(async (signal) => ({
      ...current,
      mask: await processSubject(
        current.raster,
        { box: current.box, seeds: current.seeds, seedRadius: radius },
        signal,
      ),
    }));
  };
  const paint = (points: ImagePoint[]) => {
    const current = sessionRef.current;
    if (!current || locked || tool === "box") return;
    const mode = tool === "keep" || tool === "markKeep" ? "keep" : "remove";
    const stroke = { points, radius, mode } as const;
    if (tool === "markKeep" || tool === "markRemove") {
      updateSession({
        ...current,
        seeds: paintSeeds(
          current.seeds,
          current.raster.width,
          current.raster.height,
          stroke,
        ),
      });
    } else {
      updateSession({
        ...current,
        mask: visibleMask(
          paintMask(
            current.mask,
            current.raster.width,
            current.raster.height,
            stroke,
          ),
          current.raster,
        ),
      });
    }
  };
  const pointFrom = (event: PointerEvent<HTMLCanvasElement>): ImagePoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    const raster = sessionRef.current?.raster;
    return {
      x: Math.max(
        0,
        Math.min(
          (raster?.width ?? 1) - 1,
          ((event.clientX - rect.left) / rect.width) * (raster?.width ?? 1),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          (raster?.height ?? 1) - 1,
          ((event.clientY - rect.top) / rect.height) * (raster?.height ?? 1),
        ),
      ),
    };
  };
  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (
      locked ||
      !session ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFrom(event);
    gesture.current = { pointer: event.pointerId, start: point, last: point };
    setCursor({ x: Math.round(point.x), y: Math.round(point.y) });
    saveUndo();
    if (tool !== "box") paint([point]);
  };
  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const active = gesture.current;
    const current = sessionRef.current;
    if (!active || active.pointer !== event.pointerId || !current || locked)
      return;
    const point = pointFrom(event);
    setCursor({ x: Math.round(point.x), y: Math.round(point.y) });
    if (tool === "box")
      updateSession({
        ...current,
        box: {
          x: Math.min(active.start.x, point.x),
          y: Math.min(active.start.y, point.y),
          width: Math.max(1, Math.abs(point.x - active.start.x)),
          height: Math.max(1, Math.abs(point.y - active.start.y)),
        },
      });
    else paint([active.last, point]);
    active.last = point;
  };
  const endGesture = (event: PointerEvent<HTMLCanvasElement>) => {
    if (gesture.current?.pointer !== event.pointerId) return;
    gesture.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyboardPaint = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (locked || !session) return;
    const step = event.shiftKey ? 10 : 1;
    const movements: Record<string, ImagePoint> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const movement = movements[event.key];
    if (movement) {
      event.preventDefault();
      setCursor((current) => ({
        x: Math.max(
          0,
          Math.min(session.raster.width - 1, current.x + movement.x),
        ),
        y: Math.max(
          0,
          Math.min(session.raster.height - 1, current.y + movement.y),
        ),
      }));
    } else if (event.key === " " && tool !== "box") {
      event.preventDefault();
      saveUndo();
      paint([cursor]);
    }
  };
  const undo = () => {
    const previous = undoHistory.at(-1);
    const current = sessionRef.current;
    if (!previous || !current) return;
    updateSession({ ...current, ...previous });
    setUndoHistory((history) => history.slice(0, -1));
  };
  const confirm = () => {
    const current = sessionRef.current;
    if (!current || locked || !current.mask.some(Boolean)) return;
    try {
      const image = encodeUploadedShapeImage(current.raster, current.mask);
      const next = {
        ...current,
        asset: image,
        seeds: new Int8Array(current.mask.length),
        box: undefined,
      };
      confirmedSession.current = next;
      updateSession(next);
      setEditing(false);
      clearHistory();
      setError("");
      onApply({
        id: "uploaded",
        widthScale: shape?.widthScale ?? 1,
        heightScale: shape?.heightScale ?? 1,
        colorMode: shape?.colorMode ?? "original",
        colorBoundary: shape?.colorBoundary ?? true,
        image,
      });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The foreground could not be saved.",
      );
    }
  };
  const setBox = (key: keyof ImageRect, value: number) => {
    const current = sessionRef.current;
    if (!current || !Number.isFinite(value)) return;
    const box = current.box ?? {
      x: 0,
      y: 0,
      width: current.raster.width,
      height: current.raster.height,
    };
    const maximum =
      key === "x" || key === "width"
        ? current.raster.width
        : current.raster.height;
    saveUndo();
    updateSession({
      ...current,
      box: {
        ...box,
        [key]: Math.min(
          maximum - (key === "x" || key === "y" ? 1 : 0),
          Math.max(key === "width" || key === "height" ? 1 : 0, value),
        ),
      },
    });
  };
  const kept =
    session?.mask.reduce((sum, value) => sum + Number(value !== 0), 0) ?? 0;

  return (
    <div className="image-shape-editor" aria-busy={busy}>
      <div className="image-shape-heading">
        <h3>{m("heading")}</h3>
        <div className="image-shape-actions">
          <button
            type="button"
            className="button button-quiet"
            disabled={locked}
            onClick={() => picker.current?.click()}
          >
            {m(shape || session ? "replace" : "upload")}
          </button>
          {shape && !editing && (
            <button
              type="button"
              className="button button-quiet"
              disabled={locked}
              onClick={() => {
                setEditing(true);
                setError("");
              }}
            >
              {m("edit")}
            </button>
          )}
        </div>
      </div>
      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label={m("upload")}
        hidden
        disabled={locked}
        onChange={(event) => {
          upload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <p className="field-hint">{m("local")}</p>
      {error && (
        <p className="image-shape-error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="image-shape-status" role="status">
          {m("processing")}
        </p>
      )}
      {editing && session && (
        <>
          {!session.sourceAvailable && (
            <p className="image-shape-notice">{m("unavailable")}</p>
          )}
          <div className="image-shape-preview-pair">
            <figure>
              <figcaption>{m("source")}</figcaption>
              {session.sourceUrl ? (
                <img
                  className="image-shape-source-image"
                  src={session.sourceUrl}
                  alt={m("source")}
                  draggable={false}
                />
              ) : (
                <ImageShapeRasterView
                  raster={session.raster}
                  label={m("source")}
                />
              )}
            </figure>
            <figure>
              <figcaption>{m("foreground")}</figcaption>
              <div
                className="image-shape-edit-canvas-wrap"
                style={{
                  maxWidth: `${(18 * session.raster.width) / session.raster.height}rem`,
                }}
              >
                <canvas
                  ref={canvas}
                  className="image-shape-raster image-shape-edit-canvas"
                  role="img"
                  tabIndex={locked ? -1 : 0}
                  aria-label={`${m("foreground")}: ${kept} / ${session.mask.length}`}
                  aria-describedby={`${id}-keyboard`}
                  onPointerDown={pointerDown}
                  onPointerMove={pointerMove}
                  onPointerUp={endGesture}
                  onPointerCancel={endGesture}
                  onLostPointerCapture={() => {
                    gesture.current = undefined;
                  }}
                  onKeyDown={keyboardPaint}
                >
                  {m("keyboard")}
                </canvas>
                <svg
                  className="image-shape-edit-overlay"
                  viewBox={`0 0 ${session.raster.width} ${session.raster.height}`}
                  aria-hidden="true"
                >
                  {session.box && (
                    <>
                      <rect
                        x={session.box.x}
                        y={session.box.y}
                        width={session.box.width}
                        height={session.box.height}
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth="2"
                      />
                      <rect
                        x={session.box.x}
                        y={session.box.y}
                        width={session.box.width}
                        height={session.box.height}
                        fill="none"
                        stroke="#075b66"
                        strokeWidth="1"
                        strokeDasharray="3 2"
                      />
                    </>
                  )}
                  <rect
                    x={cursor.x - 2}
                    y={cursor.y - 2}
                    width="4"
                    height="4"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                  <rect
                    x={cursor.x - 2}
                    y={cursor.y - 2}
                    width="4"
                    height="4"
                    fill="none"
                    stroke="#111827"
                    strokeWidth="1"
                  />
                </svg>
              </div>
            </figure>
          </div>
          <div className="image-shape-legend">
            <span className="image-shape-kept">
              {m("retained")} {kept}
            </span>
            <span className="image-shape-excluded">
              {m("excluded")} {session.mask.length - kept}
            </span>
          </div>
          <p className="field-hint">{m("resolution")}</p>
          <div className="image-shape-toolbar" aria-label={m("foreground")}>
            {(["keep", "remove", "box", "markKeep", "markRemove"] as const).map(
              (item) => (
                <button
                  type="button"
                  key={item}
                  disabled={locked}
                  aria-pressed={tool === item}
                  onClick={() => setTool(item)}
                >
                  {m(item)}
                </button>
              ),
            )}
          </div>
          <label className="range-field">
            <span>
              {m("radius")} <output>{radius}px</output>
            </span>
            <input
              type="range"
              min="1"
              max="24"
              value={radius}
              disabled={locked}
              onChange={(event) => setRadius(Number(event.target.value))}
            />
          </label>
          <p className="field-hint" id={`${id}-keyboard`}>
            {m("keyboard")}
          </p>
          <div className="image-shape-coordinate-row" aria-label={m("cursor")}>
            {(["x", "y"] as const).map((axis) => (
              <label key={axis}>
                {m(axis)}
                <input
                  type="number"
                  min="0"
                  max={
                    (axis === "x"
                      ? session.raster.width
                      : session.raster.height) - 1
                  }
                  step="1"
                  value={cursor[axis]}
                  disabled={locked}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value))
                      setCursor({
                        ...cursor,
                        [axis]: Math.round(
                          Math.max(
                            0,
                            Math.min(
                              (axis === "x"
                                ? session.raster.width
                                : session.raster.height) - 1,
                              value,
                            ),
                          ),
                        ),
                      });
                  }}
                />
              </label>
            ))}
            <button
              type="button"
              className="button button-quiet"
              disabled={locked || tool === "box"}
              onClick={() => {
                saveUndo();
                paint([cursor]);
              }}
            >
              {m("paint")}
            </button>
          </div>
          <details
            className="image-shape-details"
            open={
              tool === "box" || tool === "markKeep" || tool === "markRemove"
                ? true
                : undefined
            }
          >
            <summary>{m("photo")}</summary>
            <p className="field-hint">{m("photoHelp")}</p>
            <p className="field-hint">{m("markLegend")}</p>
            <div
              className="image-shape-coordinate-row image-shape-box-fields"
              aria-label={m("boxCoordinates")}
            >
              {(["x", "y", "width", "height"] as const).map((key) => (
                <label key={key}>
                  {m(key)}
                  <input
                    type="number"
                    min={key === "width" || key === "height" ? 1 : 0}
                    max={
                      key === "width" || key === "x"
                        ? session.raster.width
                        : session.raster.height
                    }
                    step="1"
                    value={Math.round(
                      session.box?.[key] ??
                        (key === "width"
                          ? session.raster.width
                          : key === "height"
                            ? session.raster.height
                            : 0),
                    )}
                    disabled={locked}
                    onChange={(event) =>
                      setBox(key, Number(event.target.value))
                    }
                  />
                </label>
              ))}
            </div>
            <div className="image-shape-actions">
              <button
                type="button"
                className="button button-quiet"
                disabled={
                  locked ||
                  (!session.box && !session.seeds.some((value) => value === 1))
                }
                onClick={findSubject}
              >
                {m("find")}
              </button>
              <button
                type="button"
                className="button button-quiet"
                disabled={
                  locked || (!session.box && !session.seeds.some(Boolean))
                }
                onClick={() => {
                  saveUndo();
                  updateSession({
                    ...session,
                    seeds: new Int8Array(session.mask.length),
                    box: undefined,
                  });
                }}
              >
                {m("clearMarks")}
              </button>
            </div>
          </details>
          <details className="image-shape-details">
            <summary>{m("simple")}</summary>
            <label className="range-field">
              <span>
                {m("tolerance")} <output>{tolerance}</output>
              </span>
              <input
                type="range"
                min="0"
                max="100"
                value={tolerance}
                disabled={locked}
                onChange={(event) => setTolerance(Number(event.target.value))}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={holes}
                disabled={locked}
                onChange={(event) => setHoles(event.target.checked)}
              />
              <span>{m("holes")}</span>
            </label>
            <button
              type="button"
              className="button button-quiet"
              disabled={locked}
              onClick={detect}
            >
              {m("detect")}
            </button>
          </details>
          <div className="image-shape-actions">
            <button
              type="button"
              className="button button-quiet"
              disabled={locked || undoHistory.length === 0}
              onClick={undo}
            >
              {m("undo")}
            </button>
            <button
              type="button"
              className="button button-quiet"
              disabled={locked}
              onClick={() => {
                saveUndo();
                updateSession({
                  ...session,
                  mask: session.initialMask,
                  seeds: new Int8Array(session.mask.length),
                  box: undefined,
                });
              }}
            >
              {m("reset")}
            </button>
          </div>
          {kept === 0 && <p className="image-shape-notice">{m("empty")}</p>}
        </>
      )}
      {editing && (
        <div className="image-shape-confirm">
          <button
            type="button"
            className="button button-quiet"
            disabled={disabled}
            onClick={cancel}
          >
            {m("cancel")}
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={locked || !session || kept === 0}
            onClick={confirm}
          >
            {m("confirm")}
          </button>
        </div>
      )}
      {shape && !editing && (
        <>
          <p className="image-shape-asset">
            {m("asset", {
              width: shape.image.width,
              height: shape.image.height,
              bytes: (
                utf8ByteLength(JSON.stringify(shape.image)) / 1024
              ).toFixed(1),
            })}
          </p>
          <label className="field">
            <span className="field-label">{m("colorMode")}</span>
            <select
              value={shape.colorMode}
              disabled={locked}
              onChange={(event) =>
                onApply({
                  ...shape,
                  colorMode: event.target
                    .value as UploadedShapeSettings["colorMode"],
                })
              }
            >
              {(["original", "readable", "palette"] as const).map((mode) => (
                <option key={mode} value={mode}>
                  {m(mode)}
                </option>
              ))}
            </select>
          </label>
          <p className="field-hint">{m("reversible")}</p>
          <div className="image-shape-backgrounds">
            <span className="field-label">{m("backgrounds")}</span>
            {suggestImageBackgrounds(shape.image).map((color) => (
              <button
                key={color}
                type="button"
                style={{ background: color }}
                disabled={locked}
                aria-label={m("background", { color })}
                aria-pressed={background.toLowerCase() === color}
                title={color}
                onClick={() => onBackgroundChange(color)}
              >
                <span
                  aria-hidden="true"
                  style={{
                    color:
                      color === "#ffffff" ||
                      color === "#f7f0df" ||
                      color === "#eff6ff"
                        ? "#111827"
                        : "#ffffff",
                  }}
                >
                  {background.toLowerCase() === color ? "✓" : ""}
                </span>
              </button>
            ))}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={shape.colorBoundary}
              disabled={locked}
              onChange={(event) =>
                onApply({ ...shape, colorBoundary: event.target.checked })
              }
            />
            <span>{m("boundary")}</span>
          </label>
          <p className="field-hint">{m("boundaryHelp")}</p>
          <p className="field-hint">{m("share")}</p>
        </>
      )}
    </div>
  );
}
