import { useRef } from "react";
import type { ChangeEvent } from "react";

interface SharePanelProps {
  shareUrl?: string;
  shareError?: string;
  disabled?: boolean;
  onCreateLink: () => void;
  onCopy: () => void;
  onDownload: () => void;
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
  onImport,
  onNewSource,
}: SharePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <section className="panel share-panel" aria-labelledby="share-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">05 / OUTPUT</p>
          <h2 id="share-heading">Make it travel.</h2>
        </div>
        <span className="privacy-chip">NO RAW TEXT</span>
      </div>
      <p className="share-disclosure">
        V
        連結只包含正規化詞語、詞頻、排名與視覺衍生資料，不包含原文；它不是機密連結。
      </p>
      <div className="share-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={disabled}
          onClick={onCreateLink}
        >
          產生 V 連結
        </button>
        <button
          className="button button-quiet"
          type="button"
          disabled={!shareUrl}
          onClick={onCopy}
        >
          複製
        </button>
      </div>
      <label className="field-label" htmlFor="share-url">
        V URL
      </label>
      <input
        id="share-url"
        className="share-url"
        readOnly
        value={shareUrl ?? "產生連結後會顯示在這裡"}
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
          disabled={disabled}
          onClick={onDownload}
        >
          下載完整 .wc 快照
        </button>
        <button
          className="button button-quiet"
          type="button"
          onClick={() => inputRef.current?.click()}
        >
          匯入 .wc
        </button>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept=".wc,application/octet-stream,text/plain"
          onChange={onImport}
        />
      </div>
      {disabled && (
        <button className="text-button" type="button" onClick={onNewSource}>
          ← 開始新的文字雲
        </button>
      )}
    </section>
  );
}
