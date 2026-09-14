import type { SceneModel } from "../core/scene";
import type { WordSet } from "../core/types";
import { getAccessibleWords, placementLabel } from "../render/accessibility";

interface WordTableProps {
  wordSet?: WordSet;
  scene?: SceneModel;
  onFocusWord?: (term: string) => void;
}

export function WordTable({ wordSet, scene, onFocusWord }: WordTableProps) {
  const placement = new Map(
    scene
      ? getAccessibleWords(scene).map((word) => [word.term, word] as const)
      : [],
  );
  return (
    <section className="panel table-panel" aria-labelledby="table-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">04 / INDEX</p>
          <h2 id="table-heading">The exact numbers.</h2>
        </div>
        {wordSet && (
          <span className="count-badge">{wordSet.words.length} words</span>
        )}
      </div>
      {wordSet ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">文字雲詞頻排名與排版狀態</caption>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Word</th>
                <th scope="col">Count</th>
                <th scope="col">State</th>
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
                        {placed ? placementLabel(placed) : "pending"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-table">
          產生文字雲後，精確詞頻與排名會保留在這裡。
        </div>
      )}
    </section>
  );
}
