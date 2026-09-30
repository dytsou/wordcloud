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
  const [imageUrl, setImageUrl] = useState<string>();
  const [renderError, setRenderError] = useState<string>();

  useEffect(() => {
    setImageUrl(undefined);
    setRenderError(undefined);
    if (!scene || error) return;

    let isCurrent = true;
    let objectUrl: string | undefined;
    const renderImage = async () => {
      try {
        const blob =
          format === "png"
            ? await renderScenePng(scene)
            : new Blob([renderSceneSvg(scene)], {
                type: "image/svg+xml;charset=utf-8",
              });
        if (!isCurrent) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
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

    void renderImage();
    return () => {
      isCurrent = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [error, format, scene, t]);

  const message = error ?? renderError;
  return (
    <main
      className="shared-image-page"
      aria-busy={!message && !imageUrl}
      aria-label={t("wizardPageResultTitle")}
    >
      {message ? (
        <p className="shared-image-message" role="alert">
          {message}
        </p>
      ) : imageUrl ? (
        <img
          className="shared-image"
          src={imageUrl}
          alt={t("wizardPageResultTitle")}
        />
      ) : (
        <p className="shared-image-message" role="status">
          {t("wizardUpdating")}
        </p>
      )}
    </main>
  );
}
