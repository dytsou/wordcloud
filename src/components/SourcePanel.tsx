import type { TokenizerSettings } from "../core/types";
import type { TokenizationResult } from "../core/types";
import { TagInput } from "./TagInput";

interface SourcePanelProps {
  sourceText: string;
  settings: TokenizerSettings;
  preview?: TokenizationResult;
  disabled?: boolean;
  onSourceChange: (value: string) => void;
  onSettingsChange: (settings: TokenizerSettings) => void;
}

export function SourcePanel({
  sourceText,
  settings,
  preview,
  disabled = false,
  onSourceChange,
  onSettingsChange,
}: SourcePanelProps) {
  const update = (patch: Partial<TokenizerSettings>) =>
    onSettingsChange({ ...settings, ...patch });

  return (
    <section className="panel source-panel" aria-labelledby="source-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">01 / SOURCE</p>
          <h2 id="source-heading">Bring the words in.</h2>
        </div>
        <span className="privacy-chip">LOCAL ONLY</span>
      </div>
      <label className="field-label" htmlFor="source-text">
        原文
      </label>
      <textarea
        id="source-text"
        className="source-input"
        value={sourceText}
        disabled={disabled}
        onChange={(event) => onSourceChange(event.target.value)}
        placeholder="貼上文章、訪談、詩，或一段正在發生的想法⋯"
        rows={9}
      />
      <p className="muted-note draft-note">
        本機草稿會在重新整理後保留；清空文字或開始新的文字雲會移除它。
      </p>
      <div className="field-row">
        <div className="field field-grow">
          <label className="field-label" htmlFor="locale">
            預設分詞 locale
          </label>
          <select
            id="locale"
            value={settings.locale}
            disabled={disabled}
            onChange={(event) => update({ locale: event.target.value })}
          >
            <option value="zh-Hant">繁體中文</option>
            <option value="zh-Hans">简体中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="th">ไทย</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
          </select>
        </div>
        <div className="field field-grow">
          <label className="field-label" htmlFor="case-mode">
            大小寫
          </label>
          <select
            id="case-mode"
            value={settings.caseMode}
            disabled={disabled}
            onChange={(event) =>
              update({
                caseMode: event.target.value as TokenizerSettings["caseMode"],
              })
            }
          >
            <option value="preserve">保留原樣</option>
            <option value="lower">全部小寫</option>
            <option value="upper">全部大寫</option>
          </select>
        </div>
      </div>
      <div className="check-row">
        <span className="check-label-group">
          <label className="check-label" htmlFor="case-insensitive">
            <input
              id="case-insensitive"
              type="checkbox"
              checked={settings.caseInsensitive}
              disabled={disabled}
              onChange={(event) =>
                update({ caseInsensitive: event.target.checked })
              }
            />
            忽略大小寫
          </label>
          <span className="info-wrap">
            <button
              className="info-button"
              type="button"
              aria-label="忽略大小寫說明"
              aria-describedby="case-insensitive-help"
              title="忽略大小寫會將 Apple、apple、APPLE 合併計數，並保留首次出現的顯示樣式。"
            >
              i
            </button>
            <span
              id="case-insensitive-help"
              className="info-popover"
              role="tooltip"
            >
              忽略大小寫會將 Apple、apple、APPLE
              合併計數，並保留首次出現的顯示樣式。
            </span>
          </span>
        </span>
        <label className="check-label">
          <input
            type="checkbox"
            checked={settings.numberPolicy === "include"}
            disabled={disabled}
            onChange={(event) =>
              update({
                numberPolicy: event.target.checked ? "include" : "exclude",
              })
            }
          />
          保留數字
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={settings.symbolPolicy === "include"}
            disabled={disabled}
            onChange={(event) =>
              update({
                symbolPolicy: event.target.checked ? "include" : "exclude",
              })
            }
          />
          保留符號
        </label>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="stop-words">
          停用詞 <span>(按 Enter 新增)</span>
        </label>
        <TagInput
          id="stop-words"
          value={settings.stopWords}
          disabled={disabled}
          onChange={(stopWords) => update({ stopWords })}
          placeholder="輸入停用詞後按 Enter"
        />
      </div>
      {preview && (
        <div className="token-preview" aria-label="分詞預覽">
          <div className="preview-heading">
            <span>分詞預覽</span>
            <span>{preview.tokens.length} candidates</span>
          </div>
          <div className="token-cloud">
            {preview.tokens.slice(0, 40).map((token, index) => (
              <span
                className="token-pill"
                key={`${token.sourceIndex}-${index}`}
              >
                {token.term}
              </span>
            ))}
          </div>
          {preview.filtered.length > 0 && (
            <p className="muted-note">
              已依目前設定排除 {preview.filtered.length} 個片段。
            </p>
          )}
        </div>
      )}
    </section>
  );
}
