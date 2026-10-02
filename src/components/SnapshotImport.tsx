import type { ChangeEvent, DragEvent } from "react";
import { useRef, useState } from "react";
import { SNAPSHOT_FILE_EXTENSION } from "../core/file-snapshot";
import { useI18n } from "../i18n";

interface SnapshotImportProps {
  readonly onImport: (file: File) => void;
}

export function SnapshotImport({ onImport }: SnapshotImportProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [isDragActive, setIsDragActive] = useState(false);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onImport(file);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    const file = event.dataTransfer.files[0];
    if (file) onImport(file);
  };

  return (
    <div
      className={
        isDragActive
          ? "snapshot-import snapshot-import--active"
          : "snapshot-import"
      }
      role="group"
      aria-label={t("importSnapshot", { extension: SNAPSHOT_FILE_EXTENSION })}
      onDragEnter={handleDragEnter}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <button
        className="button button-quiet"
        type="button"
        onClick={() => inputRef.current?.click()}
      >
        {t("importSnapshot", { extension: SNAPSHOT_FILE_EXTENSION })}
      </button>
      <p className="snapshot-import-hint">
        {isDragActive
          ? t("snapshotDropActive", { extension: SNAPSHOT_FILE_EXTENSION })
          : t("snapshotDropHint", { extension: SNAPSHOT_FILE_EXTENSION })}
      </p>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept={`${SNAPSHOT_FILE_EXTENSION},application/octet-stream,text/plain`}
        aria-label={t("importSnapshot", { extension: SNAPSHOT_FILE_EXTENSION })}
        onChange={handleFileChange}
      />
    </div>
  );
}
