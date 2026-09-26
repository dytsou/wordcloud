import type { TokenizerSettings } from "../core/types";
import type { TokenizationResult } from "../core/types";
import { getSupportedTokenizerLocales } from "../core/tokenizer";
import { tokenizerLocaleLabel, useI18n } from "../i18n";
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
  const { locale, t } = useI18n();
  const update = (patch: Partial<TokenizerSettings>) =>
    onSettingsChange({ ...settings, ...patch });
  const addTokenToStopWords = (term: string) => {
    if (disabled || settings.stopWords.includes(term)) return;
    update({ stopWords: [...settings.stopWords, term] });
  };
  const localeOptions = [
    ...new Set([...getSupportedTokenizerLocales(), settings.locale]),
  ];

  return (
    <section className="panel source-panel" aria-labelledby="source-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">{t("sourceKicker")}</p>
          <h2 id="source-heading">{t("sourceHeading")}</h2>
        </div>
        <span className="privacy-chip">{t("localOnly")}</span>
      </div>
      <label className="field-label" htmlFor="source-text">
        {t("sourceLabel")}
      </label>
      <textarea
        id="source-text"
        className="source-input"
        value={sourceText}
        disabled={disabled}
        onChange={(event) => onSourceChange(event.target.value)}
        placeholder={t("sourcePlaceholder")}
        rows={9}
      />
      <p className="muted-note draft-note">{t("draftNote")}</p>
      <div className="field-row">
        <div className="field field-grow">
          <label className="field-label" htmlFor="locale">
            {t("tokenizerLocaleLabel")}
          </label>
          <select
            id="locale"
            value={settings.locale}
            disabled={disabled}
            onChange={(event) => update({ locale: event.target.value })}
          >
            {localeOptions.map((tokenizerLocale) => (
              <option key={tokenizerLocale} value={tokenizerLocale}>
                {tokenizerLocaleLabel(tokenizerLocale, locale)}
              </option>
            ))}
          </select>
        </div>
        <div className="field field-grow">
          <label className="field-label" htmlFor="case-mode">
            {t("caseLabel")}
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
            <option value="preserve">{t("casePreserve")}</option>
            <option value="lower">{t("caseLower")}</option>
            <option value="upper">{t("caseUpper")}</option>
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
            {t("ignoreCase")}
          </label>
          <span className="info-wrap">
            <button
              className="info-button"
              type="button"
              aria-label={t("ignoreCaseInfoLabel")}
              aria-describedby="case-insensitive-help"
              title={t("ignoreCaseHelp")}
            >
              i
            </button>
            <span
              id="case-insensitive-help"
              className="info-popover"
              role="tooltip"
            >
              {t("ignoreCaseHelp")}
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
          {t("includeNumbers")}
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
          {t("includeSymbols")}
        </label>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="stop-words">
          {t("stopWordsLabel")} <span>{t("enterTag")}</span>
        </label>
        <TagInput
          id="stop-words"
          value={settings.stopWords}
          disabled={disabled}
          onChange={(stopWords) => update({ stopWords })}
          placeholder={t("stopWordsPlaceholder")}
        />
      </div>
      {preview && (
        <div className="token-preview" aria-label={t("tokenPreview")}>
          <div className="preview-heading">
            <span>{t("tokenPreview")}</span>
            <span>{t("candidateCount", { count: preview.tokens.length })}</span>
          </div>
          <div className="token-cloud">
            {preview.tokens.slice(0, 40).map((token, index) => (
              <span
                className="token-pill"
                key={`${token.sourceIndex}-${index}`}
              >
                {token.term}
                <button
                  className="token-stopword-add"
                  type="button"
                  disabled={disabled || settings.stopWords.includes(token.term)}
                  aria-label={t("addTokenToStopWords", { tag: token.term })}
                  title={t("addTokenToStopWords", { tag: token.term })}
                  onClick={() => addTokenToStopWords(token.term)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          {preview.filtered.length > 0 && (
            <p className="muted-note">
              {t("excludedFragments", { count: preview.filtered.length })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
