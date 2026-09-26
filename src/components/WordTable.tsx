import { useEffect, useRef, useState } from "react";
import type { SceneModel } from "../core/scene";
import type { WordSet } from "../core/types";
import { useI18n } from "../i18n";
import { getAccessibleWords, placementLabel } from "../render/accessibility";

interface WordTableProps {
  wordSet?: WordSet;
  scene?: SceneModel;
  onFocusWord?: (term: string) => void;
}

export function WordTable({ wordSet, scene, onFocusWord }: WordTableProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const placement = new Map(
    scene
      ? getAccessibleWords(scene).map((word) => [word.term, word] as const)
      : [],
  );

  useEffect(() => {
    const popover = popoverRef.current;
    if (!isOpen) {
      if (popover?.matches(":popover-open")) popover.hidePopover();
      return;
    }

    if (popover && !popover.matches(":popover-open")) popover.showPopover();
    closeRef.current?.focus();

    const dismissOutside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !controlRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
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
  }, [isOpen]);

  const closePopover = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

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
        onClick={() => setIsOpen((open) => !open)}
      >
        <span aria-hidden="true">i</span>
      </button>
      <div
        ref={popoverRef}
        id="word-index-popout"
        className="word-index-popout"
        popover="manual"
        role="dialog"
        aria-labelledby="word-index-heading"
      >
        <div className="word-index-popout-heading">
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
                          {placed
                            ? placed.status === "placed"
                              ? t("placed")
                              : placed.status === "unplaceable"
                                ? t("unplaceable")
                                : placed.status === "budget-limited"
                                  ? t("budgetLimited")
                                  : placementLabel(placed)
                            : t("pending")}
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
    </div>
  );
}
