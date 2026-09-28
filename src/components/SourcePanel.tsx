import { useI18n } from "../i18n";

interface SourcePanelProps {
  readonly sourceText: string;
  readonly disabled?: boolean;
  readonly error?: string;
  readonly onSourceChange: (value: string) => void;
}

export function SourcePanel({
  sourceText,
  disabled = false,
  error,
  onSourceChange,
}: SourcePanelProps) {
  const { t } = useI18n();

  return (
    <section className="panel source-panel" aria-labelledby="source-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">{t("sourceKicker")}</p>
          <h2 id="source-heading">{t("sourceHeading")}</h2>
        </div>
      </div>
      <label className="field-label" htmlFor="source-text">
        {t("sourceLabel")}
      </label>
      <textarea
        id="source-text"
        className="source-input"
        value={sourceText}
        disabled={disabled}
        required
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "source-error draft-note" : "draft-note"}
        onChange={(event) => onSourceChange(event.target.value)}
        placeholder={t("sourcePlaceholder")}
        rows={11}
      />
      {error && (
        <p id="source-error" className="warning-note" role="alert">
          {error}
        </p>
      )}
      <p id="draft-note" className="muted-note draft-note">
        {t("draftNote")}
      </p>
    </section>
  );
}
