import type { ChangeEvent } from "react";
import { useRef } from "react";
import { SNAPSHOT_FILE_EXTENSION } from "../core/file-snapshot";
import { useI18n } from "../i18n";

interface SharePanelProps {
  readonly shareUrl?: string;
  readonly shareUrlV2?: string;
  readonly pngShareUrl?: string;
  readonly svgShareUrl?: string;
  readonly shareError?: string;
  readonly shareErrorV1?: string;
  readonly shareErrorV2?: string;
  readonly shareEncoding?: boolean;
  readonly wordLimitNotice?: string;
  readonly disabled?: boolean;
  readonly onCreateLink: () => void;
  readonly onCopy: (version: "v1" | "v2") => void;
  readonly onCopyPng?: () => void;
  readonly onCopySvg?: () => void;
  readonly onDownload: () => void;
  readonly onExportSvg: () => void;
  readonly onExportPng: () => void;
  readonly exporting?: boolean;
  readonly onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onNewSource: () => void;
}

export function SharePanel({
  shareUrl,
  shareUrlV2,
  pngShareUrl,
  svgShareUrl,
  shareError,
  shareErrorV1,
  shareErrorV2,
  shareEncoding = false,
  wordLimitNotice,
  disabled = false,
  onCreateLink,
  onCopy,
  onCopyPng,
  onCopySvg,
  onDownload,
  onExportSvg,
  onExportPng,
  exporting = false,
  onImport,
  onNewSource,
}: SharePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();
  const hasShareUrl = Boolean(shareUrl || shareUrlV2);
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
      {wordLimitNotice && <p className="warning-note">{wordLimitNotice}</p>}
      <div className="share-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={disabled}
          onClick={onCreateLink}
        >
          {shareEncoding ? t("creatingLinks") : t("createLink")}
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
      </div>
      {shareUrl && (
        <>
          <label className="field-label" htmlFor="share-url-v1">
            {t("v1Url")}
          </label>
          <input
            id="share-url-v1"
            className="share-url"
            readOnly
            value={shareUrl}
            aria-describedby="share-url-v1-length"
          />
          <p id="share-url-v1-length" className="field-hint">
            {t("shareUrlLength", { characters: shareUrl.length })}
          </p>
          <button
            className="button button-quiet"
            type="button"
            disabled={disabled}
            onClick={() => onCopy("v1")}
          >
            {t("copyV1")}
          </button>
        </>
      )}
      {shareErrorV1 && (
        <p id="share-v1-error" className="warning-note">
          {shareErrorV1}
        </p>
      )}
      {shareEncoding && !shareUrlV2 && (
        <p className="share-disclosure" aria-live="polite">
          {t("v2Preparing")}
        </p>
      )}
      {shareUrlV2 && (
        <>
          <label className="field-label" htmlFor="share-url-v2">
            {t("v2Url")}
          </label>
          <input
            id="share-url-v2"
            className="share-url"
            readOnly
            value={shareUrlV2}
            aria-describedby="share-url-v2-length"
          />
          <p id="share-url-v2-length" className="field-hint">
            {t("shareUrlLength", { characters: shareUrlV2.length })}
          </p>
          <button
            className="button button-quiet"
            type="button"
            disabled={disabled}
            onClick={() => onCopy("v2")}
          >
            {t("copyV2")}
          </button>
        </>
      )}
      {shareErrorV2 && (
        <p id="share-v2-error" className="warning-note">
          {shareErrorV2}
        </p>
      )}
      {hasShareUrl && pngShareUrl && svgShareUrl && (
        <div className="share-image-links">
          <div className="share-image-link-row">
            <label className="field-label" htmlFor="share-png-url">
              PNG
            </label>
            <input
              id="share-png-url"
              className="share-url"
              readOnly
              value={pngShareUrl}
            />
            <button
              className="button button-quiet"
              type="button"
              disabled={disabled}
              onClick={onCopyPng}
              aria-label={`${t("copy")} PNG`}
            >
              {t("copy")}
            </button>
          </div>
          <div className="share-image-link-row">
            <label className="field-label" htmlFor="share-svg-url">
              SVG
            </label>
            <input
              id="share-svg-url"
              className="share-url"
              readOnly
              value={svgShareUrl}
            />
            <button
              className="button button-quiet"
              type="button"
              disabled={disabled}
              onClick={onCopySvg}
              aria-label={`${t("copy")} SVG`}
            >
              {t("copy")}
            </button>
          </div>
        </div>
      )}
      {shareError && (
        <p id="share-error" className="warning-note">
          {shareError}
        </p>
      )}
      {(hasShareUrl || shareError || shareErrorV1 || shareErrorV2) && (
        <div className="file-actions">
          <button
            className="button button-quiet"
            type="button"
            disabled={disabled || exporting}
            onClick={onDownload}
          >
            {t("downloadSnapshot", { extension: SNAPSHOT_FILE_EXTENSION })}
          </button>
          {hasShareUrl && (
            <>
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
            </>
          )}
        </div>
      )}
      <button className="text-button" type="button" onClick={onNewSource}>
        {disabled ? t("newCloudDisabled") : t("newCloud")}
      </button>
    </section>
  );
}
