import type { ChangeEvent } from "react";
import { useRef } from "react";
import { SNAPSHOT_FILE_EXTENSION } from "../core/file-snapshot";
import { useI18n } from "../i18n";

interface SharePanelProps {
  readonly shareUrl?: string;
  readonly shareUrlV2?: string;
  readonly pngShareUrlV1?: string;
  readonly svgShareUrlV1?: string;
  readonly pngShareUrlV2?: string;
  readonly svgShareUrlV2?: string;
  readonly shareError?: string;
  readonly shareErrorV1?: string;
  readonly shareErrorV2?: string;
  readonly shareEncoding?: boolean;
  readonly wordLimitNotice?: string;
  readonly disabled?: boolean;
  readonly onCreateLink: () => void;
  readonly onCopy: (version: "v1" | "v2") => void;
  readonly onCopyPngV1?: () => void;
  readonly onCopySvgV1?: () => void;
  readonly onCopyPngV2?: () => void;
  readonly onCopySvgV2?: () => void;
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
  pngShareUrlV1,
  svgShareUrlV1,
  pngShareUrlV2,
  svgShareUrlV2,
  shareError,
  shareErrorV1,
  shareErrorV2,
  shareEncoding = false,
  wordLimitNotice,
  disabled = false,
  onCreateLink,
  onCopy,
  onCopyPngV1,
  onCopySvgV1,
  onCopyPngV2,
  onCopySvgV2,
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
  const hasImageShareUrls = Boolean(
    (pngShareUrlV1 && svgShareUrlV1) ||
      (pngShareUrlV2 && svgShareUrlV2),
  );
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
      {hasShareUrl && hasImageShareUrls && (
        <div className="share-image-links">
          {pngShareUrlV1 && svgShareUrlV1 && (
            <div className="share-image-link-set">
              <p className="share-image-link-heading">{t("v1Url")}</p>
              <ShareImageLinkRow
                id="share-png-v1-url"
                format="PNG"
                url={pngShareUrlV1}
                copyLabel={t("copyV1")}
                disabled={disabled}
                onCopy={onCopyPngV1}
              />
              <ShareImageLinkRow
                id="share-svg-v1-url"
                format="SVG"
                url={svgShareUrlV1}
                copyLabel={t("copyV1")}
                disabled={disabled}
                onCopy={onCopySvgV1}
              />
            </div>
          )}
          {pngShareUrlV2 && svgShareUrlV2 && (
            <div className="share-image-link-set">
              <p className="share-image-link-heading">{t("v2Url")}</p>
              <ShareImageLinkRow
                id="share-png-v2-url"
                format="PNG"
                url={pngShareUrlV2}
                copyLabel={t("copyV2")}
                disabled={disabled}
                onCopy={onCopyPngV2}
              />
              <ShareImageLinkRow
                id="share-svg-v2-url"
                format="SVG"
                url={svgShareUrlV2}
                copyLabel={t("copyV2")}
                disabled={disabled}
                onCopy={onCopySvgV2}
              />
            </div>
          )}
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

interface ShareImageLinkRowProps {
  readonly id: string;
  readonly format: "PNG" | "SVG";
  readonly url: string;
  readonly copyLabel: string;
  readonly disabled: boolean;
  readonly onCopy?: () => void;
}

function ShareImageLinkRow({
  id,
  format,
  url,
  copyLabel,
  disabled,
  onCopy,
}: ShareImageLinkRowProps) {
  return (
    <div className="share-image-link-row">
      <label className="field-label" htmlFor={id}>
        {format}
      </label>
      <input id={id} className="share-url" readOnly value={url} />
      <button
        className="button button-quiet"
        type="button"
        disabled={disabled || !onCopy}
        onClick={onCopy}
        aria-label={`${copyLabel} ${format}`}
      >
        {copyLabel}
      </button>
    </div>
  );
}
