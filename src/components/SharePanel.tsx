import { useState } from "react";
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
  readonly hasUploadedShape?: boolean;
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
  hasUploadedShape = false,
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
  onNewSource,
}: SharePanelProps) {
  const { t } = useI18n();
  const [selectedVersion, setSelectedVersion] = useState<"v1" | "v2">("v2");

  const hasV1Output = Boolean(
    shareUrl || shareErrorV1 || (pngShareUrlV1 && svgShareUrlV1),
  );
  const hasV2Output = Boolean(
    shareUrlV2 ||
      shareErrorV2 ||
      shareEncoding ||
      (pngShareUrlV2 && svgShareUrlV2),
  );
  const activeVersion = shareEncoding
    ? "v2"
    : selectedVersion === "v1" && hasV1Output
      ? "v1"
      : hasV2Output
        ? "v2"
        : "v1";
  const activeShareUrl = activeVersion === "v1" ? shareUrl : shareUrlV2;
  const activeShareError = activeVersion === "v1" ? shareErrorV1 : shareErrorV2;
  const activePngShareUrl =
    activeVersion === "v1" ? pngShareUrlV1 : pngShareUrlV2;
  const activeSvgShareUrl =
    activeVersion === "v1" ? svgShareUrlV1 : svgShareUrlV2;
  const activeImageCopyLabel = t(activeVersion === "v1" ? "copyV1" : "copyV2");
  const canSwitchVersion = hasV1Output && hasV2Output && !shareEncoding;
  const hasVersionChoice = Boolean(
    shareUrl || shareUrlV2 || shareErrorV1 || shareErrorV2 || shareEncoding,
  );
  const panel = (
    <section className="panel share-panel" aria-labelledby="share-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">{t("outputKicker")}</p>
          <h2 id="share-heading">{t("outputHeading")}</h2>
        </div>
        <span className="privacy-chip">{t("noRawText")}</span>
      </div>
      <p className="share-disclosure">{t("shareDisclosure")}</p>
      {hasUploadedShape && (
        <p className="share-disclosure">{t("imageShapeShareDisclosure")}</p>
      )}
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
        <button
          className="button button-quiet"
          type="button"
          disabled={disabled || exporting}
          onClick={onDownload}
        >
          {t("downloadSnapshot", { extension: SNAPSHOT_FILE_EXTENSION })}
        </button>
      </div>

      {hasVersionChoice && (
        <>
          <div className="share-url-heading">
            {activeShareUrl ? (
              <label
                className="field-label"
                htmlFor={
                  activeVersion === "v1" ? "share-url-v1" : "share-url-v2"
                }
              >
                {t(activeVersion === "v1" ? "v1Url" : "v2Url")}
              </label>
            ) : (
              <span className="field-label">{t("shareVersion")}</span>
            )}
            <div className="share-url-heading-actions">
              {canSwitchVersion && (
                <button
                  className="share-version-toggle-text"
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    setSelectedVersion(activeVersion === "v1" ? "v2" : "v1")
                  }
                >
                  {t("switchShareVersion", {
                    version: activeVersion === "v1" ? "2" : "1",
                  })}
                </button>
              )}
              <button
                className="share-version-info"
                type="button"
                aria-label={t("shareVersionInfoLabel")}
                aria-describedby="share-version-info-tooltip"
              >
                <span aria-hidden="true">i</span>
                <span
                  className="share-version-tooltip"
                  id="share-version-info-tooltip"
                  role="tooltip"
                >
                  {t("shareVersionInfo")}
                </span>
              </button>
            </div>
          </div>
        </>
      )}
      {activeShareUrl && (
        <div className="share-url-copy-field">
          <input
            id={activeVersion === "v1" ? "share-url-v1" : "share-url-v2"}
            className="share-url"
            readOnly
            value={activeShareUrl}
          />
          <button
            className="share-url-copy-button"
            type="button"
            disabled={disabled}
            onClick={() => onCopy(activeVersion)}
            aria-label={t(activeVersion === "v1" ? "copyV1" : "copyV2")}
          >
            <CopyIcon />
          </button>
        </div>
      )}
      {activeVersion === "v2" &&
        shareEncoding &&
        !shareUrlV2 &&
        !shareErrorV2 && (
          <p className="share-disclosure" aria-live="polite">
            {t("v2Preparing")}
          </p>
        )}
      {activeShareError && (
        <p
          id={activeVersion === "v1" ? "share-v1-error" : "share-v2-error"}
          className="warning-note"
        >
          {activeShareError}
        </p>
      )}
      {activePngShareUrl && activeSvgShareUrl && (
        <div className="share-image-links">
          <div className="share-image-link-set">
            <ShareImageLinkRow
              id={
                activeVersion === "v1" ? "share-png-v1-url" : "share-png-v2-url"
              }
              format="PNG"
              url={activePngShareUrl}
              copyLabel={activeImageCopyLabel}
              disabled={disabled}
              onCopy={activeVersion === "v1" ? onCopyPngV1 : onCopyPngV2}
            />
            <ShareImageLinkRow
              id={
                activeVersion === "v1" ? "share-svg-v1-url" : "share-svg-v2-url"
              }
              format="SVG"
              url={activeSvgShareUrl}
              copyLabel={activeImageCopyLabel}
              disabled={disabled}
              onCopy={activeVersion === "v1" ? onCopySvgV1 : onCopySvgV2}
            />
          </div>
        </div>
      )}
      {shareError && (
        <p id="share-error" className="warning-note">
          {shareError}
        </p>
      )}
    </section>
  );
  return (
    <>
      {panel}
      <div className="share-panel-footer">
        <button
          className="text-button share-panel-new-source"
          type="button"
          onClick={onNewSource}
        >
          {disabled ? t("newCloudDisabled") : t("newCloud")}
        </button>
      </div>
    </>
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
      <div className="share-url-copy-field">
        <input id={id} className="share-url" readOnly value={url} />
        <button
          className="share-url-copy-button"
          type="button"
          disabled={disabled || !onCopy}
          onClick={onCopy}
          aria-label={`${copyLabel} ${format}`}
        >
          <CopyIcon />
        </button>
      </div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      className="share-url-copy-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M8 8V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" />
      <rect x="3" y="8" width="13" height="13" rx="2" />
    </svg>
  );
}
