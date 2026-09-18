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
  const placement = new Map(
    scene
      ? getAccessibleWords(scene).map((word) => [word.term, word] as const)
      : [],
  );
  return (
    <section className="panel table-panel" aria-labelledby="table-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">{t("indexKicker")}</p>
          <h2 id="table-heading">{t("indexHeading")}</h2>
        </div>
        {wordSet && (
          <span className="count-badge">
            {t("wordCount", { count: wordSet.words.length })}
          </span>
        )}
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
                        className={`placement-state ${placed?.status ?? "pending"}`}
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
    </section>
  );
}
