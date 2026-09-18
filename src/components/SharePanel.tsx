import { useRef } from "react";
import type { ChangeEvent } from "react";
import { SNAPSHOT_FILE_EXTENSION } from "../core/file-snapshot";
import { useI18n } from "../i18n";

interface SharePanelProps {
  shareUrl?: string;
  shareError?: string;
  disabled?: boolean;
  onCreateLink: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onExportSvg: () => void;
  onExportPng: () => void;
  exporting?: boolean;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onNewSource: () => void;
}

export function SharePanel({
  shareUrl,
  shareError,
  disabled = false,
  onCreateLink,
  onCopy,
  onDownload,
  onExportSvg,
  onExportPng,
  exporting = false,
  onImport,
  onNewSource,
}: SharePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();
  const hasShareUrl = Boolean(shareUrl);
  return (
    <section className="panel share-panel" aria-labelledby="share-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">{t("outputKicker")}</p>
          <h2 id="share-heading">{t("outputHeading")}</h2>
        </div>
        <span className="privacy-chip">{t("noRawText")}</span>
      </div>
      <p className="share-disclosure">{t("shareDisclosure")}</p>
      <div className="share-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={disabled}
          onClick={onCreateLink}
        >
          {t("createLink")}
        </button>
        <button
          className="button button-quiet"
          type="button"
          disabled={!shareUrl}
          onClick={onCopy}
        >
          {t("copy")}
        </button>
      </div>
      <label className="field-label" htmlFor="share-url">
        {t("vUrl")}
      </label>
      <input
        id="share-url"
        className={hasShareUrl ? "share-url" : "share-url is-empty"}
        readOnly
        value={shareUrl ?? ""}
        placeholder={t("sharePlaceholder")}
        aria-describedby={shareError ? "share-error" : undefined}
      />
      {shareError && (
        <p id="share-error" className="warning-note">
          {shareError}
        </p>
      )}
      <div className="file-actions">
        <button
          className="button button-quiet"
          type="button"
          disabled={disabled || exporting}
          onClick={onDownload}
        >
          {t("downloadSnapshot", { extension: SNAPSHOT_FILE_EXTENSION })}
        </button>
        <button
          className="button button-quiet"
          type="button"
          disabled={disabled || exporting}
          onClick={onExportSvg}
        >
          {t("downloadSvg")}
        </button>
        <button
          className="button button-quiet"
          type="button"
          disabled={disabled || exporting}
          onClick={onExportPng}
        >
          {exporting ? t("downloadingPng") : t("downloadPng")}
        </button>
        <button
          className="button button-quiet"
          type="button"
          onClick={() => inputRef.current?.click()}
        >
          {t("importSnapshot", { extension: SNAPSHOT_FILE_EXTENSION })}
        </button>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept={`${SNAPSHOT_FILE_EXTENSION},application/octet-stream,text/plain`}
          onChange={onImport}
        />
      </div>
      <button className="text-button" type="button" onClick={onNewSource}>
        {disabled ? t("newCloudDisabled") : t("newCloud")}
      </button>
    </section>
  );
}
