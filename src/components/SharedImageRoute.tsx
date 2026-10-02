import { useEffect, useState } from "react";
import type { SharedImageFormat } from "../app/wizard-route";
import type { SceneModel } from "../core/scene";
import { useI18n } from "../i18n";
import { renderScenePng } from "../render/png";
import { renderSceneSvg } from "../render/svg";

interface SharedImageRouteProps {
  readonly format: SharedImageFormat;
  readonly scene?: SceneModel;
  readonly error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unknown error occurred. Please try again.";
}

export function SharedImageRoute({
  format,
  scene,
  error,
}: SharedImageRouteProps) {
  const { t } = useI18n();
  const [downloadUrl, setDownloadUrl] = useState<string>();
  const [renderError, setRenderError] = useState<string>();

  useEffect(() => {
    setDownloadUrl(undefined);
    setRenderError(undefined);
    if (!scene || error) return;

    let isCurrent = true;
    let objectUrl: string | undefined;
    const renderAndDownload = async () => {
      try {
        // Defer so Strict Mode can cancel its first effect setup.
        await Promise.resolve();
        if (!isCurrent) return;
        const blob =
          format === "png"
            ? await renderScenePng(scene)
            : new Blob([renderSceneSvg(scene)], {
                type: "image/svg+xml;charset=utf-8",
              });
        if (!isCurrent) return;
        objectUrl = URL.createObjectURL(blob);
        setDownloadUrl(objectUrl);
        const downloadLink = document.createElement("a");
        downloadLink.href = objectUrl;
        downloadLink.download = `wordcloud.${format}`;
        downloadLink.click();
      } catch (cause) {
        if (!isCurrent) return;
        const details = errorMessage(cause);
        setRenderError(
          format === "png"
            ? t("pngDownloadFailed", { error: details })
            : t("svgDownloadFailed", { error: details }),
        );
      }
    };

    void renderAndDownload();
    return () => {
      isCurrent = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [error, format, scene, t]);

  const message = error ?? renderError;
  const content = message ? (
    <p className="shared-image-message" role="alert">
      {message}
    </p>
  ) : (
    <output className="shared-image-message" aria-live="polite">
      {downloadUrl ? (
        <>
          {t("sharedImageDownloadReady", { extension: format })}
          {t("sharedImageDownloadFallback")}
          <a
            className="shared-image-download-link"
            href={downloadUrl}
            download={`wordcloud.${format}`}
          >
            {t("sharedImageDownloadLink", { extension: format })}
          </a>
        </>
      ) : (
        t("sharedImageDownloadPreparing", { extension: format })
      )}
    </output>
  );

  return (
    <main
      className="shared-image-page"
      aria-busy={!message && !downloadUrl}
      aria-label={t("sharedImageDownloadPreparing", { extension: format })}
    >
      {content}
    </main>
  );
}
