import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { SceneModel } from "../core/scene";
import type { WordSet } from "../core/types";
import { useI18n } from "../i18n";
import { getAccessibleWords, placementLabel } from "../render/accessibility";

interface WordTableProps {
  readonly wordSet?: WordSet;
  readonly scene?: SceneModel;
  readonly onFocusWord?: (term: string | undefined) => void;
}

interface PanelPosition {
  left: number;
  top: number;
}

interface PanelSize {
  width: number;
  height: number;
}

type ResizeEdge =
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

interface PointerGesture extends PanelPosition, PanelSize {
  pointerId: number;
  pointerX: number;
  pointerY: number;
}

interface ResizeGesture extends PointerGesture {
  edge: ResizeEdge;
}

const VIEWPORT_GAP = 12;
const RESIZE_EDGES: ResizeEdge[] = [
  "top",
  "right",
  "bottom",
  "left",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function clampPosition(
  position: PanelPosition,
  size: PanelSize,
): PanelPosition {
  return {
    left: clamp(
      position.left,
      VIEWPORT_GAP,
      Math.max(VIEWPORT_GAP, window.innerWidth - size.width - VIEWPORT_GAP),
    ),
    top: clamp(
      position.top,
      VIEWPORT_GAP,
      Math.max(VIEWPORT_GAP, window.innerHeight - size.height - VIEWPORT_GAP),
    ),
  };
}

function clampSize(size: PanelSize, position: PanelPosition): PanelSize {
  const maxWidth = Math.max(
    1,
    window.innerWidth - position.left - VIEWPORT_GAP,
  );
  const maxHeight = Math.max(
    1,
    window.innerHeight - position.top - VIEWPORT_GAP,
  );
  return {
    width: clamp(size.width, Math.min(320, maxWidth), maxWidth),
    height: clamp(size.height, Math.min(240, maxHeight), maxHeight),
  };
}

function resizePanel(
  start: PanelPosition & PanelSize,
  edge: ResizeEdge,
  deltaX: number,
  deltaY: number,
): { position: PanelPosition; size: PanelSize } {
  const position = { left: start.left, top: start.top };
  const size = { width: start.width, height: start.height };

  if (edge.includes("left")) {
    const fixedRight = start.left + start.width;
    const maxWidth = Math.max(1, fixedRight - VIEWPORT_GAP);
    const minWidth = Math.min(320, maxWidth);
    position.left = clamp(
      start.left + deltaX,
      VIEWPORT_GAP,
      fixedRight - minWidth,
    );
    size.width = fixedRight - position.left;
  } else if (edge.includes("right")) {
    const maxWidth = Math.max(1, window.innerWidth - start.left - VIEWPORT_GAP);
    size.width = clamp(start.width + deltaX, Math.min(320, maxWidth), maxWidth);
  }

  if (edge.includes("top")) {
    const fixedBottom = start.top + start.height;
    const maxHeight = Math.max(1, fixedBottom - VIEWPORT_GAP);
    const minHeight = Math.min(240, maxHeight);
    position.top = clamp(
      start.top + deltaY,
      VIEWPORT_GAP,
      fixedBottom - minHeight,
    );
    size.height = fixedBottom - position.top;
  } else if (edge.includes("bottom")) {
    const maxHeight = Math.max(
      1,
      window.innerHeight - start.top - VIEWPORT_GAP,
    );
    size.height = clamp(
      start.height + deltaY,
      Math.min(240, maxHeight),
      maxHeight,
    );
  }

  return { position, size };
}

export function WordTable({ wordSet, scene, onFocusWord }: WordTableProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const moveGestureRef = useRef<PointerGesture | null>(null);
  const resizeGestureRef = useRef<ResizeGesture | null>(null);
  const [position, setPosition] = useState<PanelPosition>();
  const [size, setSize] = useState<PanelSize>();
  const [opacity, setOpacity] = useState(1);
  const placement = new Map(
    scene
      ? getAccessibleWords(scene).map((word) => [word.term, word] as const)
      : [],
  );

  useEffect(() => {
    const popover = popoverRef.current;
    if (!isOpen) {
      moveGestureRef.current = null;
      resizeGestureRef.current = null;
      if (popover?.matches(":popover-open")) popover.hidePopover();
      return;
    }

    if (popover && !popover.matches(":popover-open")) popover.showPopover();
    closeRef.current?.focus();

    const dismissOutside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !controlRef.current?.contains(target)) {
        setIsOpen(false);
        onFocusWord?.(undefined);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      onFocusWord?.(undefined);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen, onFocusWord]);

  const closePopover = () => {
    setIsOpen(false);
    onFocusWord?.(undefined);
    triggerRef.current?.focus();
  };

  const handleMovePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    const popover = popoverRef.current;
    if (!popover) return;
    const rect = popover.getBoundingClientRect();
    const start = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    moveGestureRef.current = start;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleMovePointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const start = moveGestureRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    setPosition(
      clampPosition(
        {
          left: start.left + event.clientX - start.pointerX,
          top: start.top + event.clientY - start.pointerY,
        },
        start,
      ),
    );
  };

  const handleMovePointerEnd = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (moveGestureRef.current?.pointerId === event.pointerId) {
      moveGestureRef.current = null;
    }
  };

  const handleMoveKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const directions: Record<string, PanelPosition> = {
      ArrowDown: { left: 0, top: 1 },
      ArrowLeft: { left: -1, top: 0 },
      ArrowRight: { left: 1, top: 0 },
      ArrowUp: { left: 0, top: -1 },
    };
    const direction = directions[event.key];
    const popover = popoverRef.current;
    if (!direction || !popover) return;
    event.preventDefault();
    const rect = popover.getBoundingClientRect();
    const step = event.shiftKey ? 64 : 24;
    setPosition(
      clampPosition(
        {
          left: rect.left + direction.left * step,
          top: rect.top + direction.top * step,
        },
        { width: rect.width, height: rect.height },
      ),
    );
  };

  const handleResizePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    const popover = popoverRef.current;
    if (!popover) return;
    const rect = popover.getBoundingClientRect();
    const start = {
      edge: event.currentTarget.dataset.resizeEdge as ResizeEdge,
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    resizeGestureRef.current = start;
    setPosition({ left: rect.left, top: rect.top });
    setSize({ width: rect.width, height: rect.height });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const handleResizePointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const start = resizeGestureRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    const resized = resizePanel(
      start,
      start.edge,
      event.clientX - start.pointerX,
      event.clientY - start.pointerY,
    );
    setPosition(resized.position);
    setSize(resized.size);
  };

  const handleResizePointerEnd = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (resizeGestureRef.current?.pointerId === event.pointerId) {
      resizeGestureRef.current = null;
    }
  };

  const handleResizeKeyDown =
    (edge: ResizeEdge) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const popover = popoverRef.current;
      if (!popover) return;
      const horizontalEdge = edge.includes("left") || edge.includes("right");
      const verticalEdge = edge.includes("top") || edge.includes("bottom");
      const step = event.shiftKey ? 64 : 24;
      let deltaX = 0;
      let deltaY = 0;
      if (horizontalEdge && event.key === "ArrowLeft") deltaX = -step;
      if (horizontalEdge && event.key === "ArrowRight") deltaX = step;
      if (verticalEdge && event.key === "ArrowUp") deltaY = -step;
      if (verticalEdge && event.key === "ArrowDown") deltaY = step;
      if (deltaX === 0 && deltaY === 0) return;

      event.preventDefault();
      const rect = popover.getBoundingClientRect();
      const resized = resizePanel(
        {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
        edge,
        deltaX,
        deltaY,
      );
      setPosition(resized.position);
      setSize(resized.size);
    };

  useEffect(() => {
    const keepPopoverVisible = () => {
      const popover = popoverRef.current;
      if (!popover?.matches(":popover-open")) return;
      const rect = popover.getBoundingClientRect();
      setSize((current) =>
        current
          ? clampSize(current, {
              left: position?.left ?? rect.left,
              top: position?.top ?? rect.top,
            })
          : current,
      );
      setPosition((current) =>
        current
          ? clampPosition(current, {
              width: size?.width ?? rect.width,
              height: size?.height ?? rect.height,
            })
          : current,
      );
    };
    window.addEventListener("resize", keepPopoverVisible);
    return () => window.removeEventListener("resize", keepPopoverVisible);
  }, [isOpen, position, size]);

  return (
    <div className="word-index-control" ref={controlRef}>
      {wordSet && (
        <span className="count-badge">
          {t("wordCount", { count: wordSet.words.length })}
        </span>
      )}
      <button
        ref={triggerRef}
        className="info-button word-index-trigger"
        type="button"
        aria-label={t("indexInfoLabel")}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls="word-index-popout"
        onClick={() => {
          if (isOpen) onFocusWord?.(undefined);
          setIsOpen(!isOpen);
        }}
      >
        <span aria-hidden="true">i</span>
      </button>
      <dialog
        ref={popoverRef}
        id="word-index-popout"
        className={`word-index-popout${size ? " is-resizable" : ""}`}
        popover="manual"
        aria-labelledby="word-index-heading"
        style={{
          opacity,
          ...(position && {
            left: position.left,
            top: position.top,
            translate: "0 0",
          }),
          ...(size && { width: size.width, height: size.height }),
        }}
      >
        <div className="word-index-popout-heading">
          <button
            className="word-index-move"
            type="button"
            aria-label={t("moveIndexHint")}
            title={t("moveIndexHint")}
            onPointerDown={handleMovePointerDown}
            onPointerMove={handleMovePointerMove}
            onPointerUp={handleMovePointerEnd}
            onPointerCancel={handleMovePointerEnd}
            onLostPointerCapture={handleMovePointerEnd}
            onKeyDown={handleMoveKeyDown}
          >
            <span aria-hidden="true">⠿</span>
          </button>
          <h2 id="word-index-heading">{t("indexHeading")}</h2>
          <button
            ref={closeRef}
            className="word-index-close"
            type="button"
            aria-label={t("closeIndex")}
            onClick={closePopover}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="word-index-content">
          {wordSet ? (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">{t("tableCaption")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("rank")}</th>
                    <th scope="col">{t("word")}</th>
                    <th scope="col">{t("count")}</th>
                    <th scope="col">{t("state")}</th>
                  </tr>
                </thead>
                <tbody>
                  {wordSet.words.map((word) => {
                    const placed = placement.get(word.term);
                    let statusLabel = t("pending");
                    if (placed?.status === "placed") {
                      statusLabel = t("placed");
                    } else if (placed?.status === "unplaceable") {
                      statusLabel = t("unplaceable");
                    } else if (placed?.status === "budget-limited") {
                      statusLabel = t("budgetLimited");
                    } else if (placed) {
                      statusLabel = placementLabel(placed);
                    }
                    return (
                      <tr
                        key={word.term}
                        onMouseEnter={() => onFocusWord?.(word.term)}
                      >
                        <td>
                          <span className="rank-mark">
                            {String(word.rank).padStart(2, "0")}
                          </span>
                        </td>
                        <th scope="row">
                          <button
                            className="word-link"
                            type="button"
                            onFocus={() => onFocusWord?.(word.term)}
                            onClick={() => onFocusWord?.(word.term)}
                          >
                            {word.term}
                          </button>
                        </th>
                        <td className="count-cell">{word.count}</td>
                        <td>
                          <span
                            className={
                              "placement-state " + (placed?.status ?? "pending")
                            }
                          >
                            {statusLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-table">{t("emptyTable")}</div>
          )}
        </div>
        {RESIZE_EDGES.map((edge) => {
          const isCorner = edge.includes("-");
          const isHorizontal = edge.includes("left") || edge.includes("right");
          const currentValue = isHorizontal ? size?.width : size?.height;
          const minimumValue = isHorizontal ? 320 : 240;
          const maximumValue = isHorizontal
            ? window.innerWidth - (position?.left ?? 12) - VIEWPORT_GAP
            : window.innerHeight - (position?.top ?? 12) - VIEWPORT_GAP;
          let ariaOrientation: "vertical" | "horizontal" | undefined;
          if (!isCorner) {
            ariaOrientation = isHorizontal ? "vertical" : "horizontal";
          }
          return (
            <button
              key={edge}
              className={`word-index-resize-edge word-index-resize-edge--${edge}`}
              type="button"
              data-resize-edge={edge}
              role={isCorner ? undefined : "separator"}
              aria-label={t("resizeIndexHint")}
              aria-orientation={ariaOrientation}
              aria-valuenow={
                !isCorner && currentValue ? Math.round(currentValue) : undefined
              }
              aria-valuemin={
                !isCorner ? Math.min(minimumValue, maximumValue) : undefined
              }
              aria-valuemax={!isCorner ? Math.max(1, maximumValue) : undefined}
              title={t("resizeIndexHint")}
              onPointerDown={handleResizePointerDown}
              onPointerMove={handleResizePointerMove}
              onPointerUp={handleResizePointerEnd}
              onPointerCancel={handleResizePointerEnd}
              onLostPointerCapture={handleResizePointerEnd}
              onKeyDown={handleResizeKeyDown(edge)}
            />
          );
        })}
        <label className="word-index-opacity-control">
          <span className="sr-only">{t("indexOpacity")}</span>
          <input
            type="range"
            min="35"
            max="100"
            step="5"
            value={Math.round(opacity * 100)}
            aria-label={t("indexOpacity")}
            aria-valuetext={`${Math.round(opacity * 100)}%`}
            title={t("indexOpacity")}
            onChange={(event) =>
              setOpacity(Number(event.currentTarget.value) / 100)
            }
          />
        </label>
      </dialog>
    </div>
  );
}
