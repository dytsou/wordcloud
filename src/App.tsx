import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { buildShareUrl } from "./core/codec";
import {
  createFontMetricsTable,
  waitForFonts,
  type FontMetric,
} from "./core/metrics";
import {
  createInitialEditorState,
  fromSnapshot,
  isGeometryChanging,
  type EditorState,
} from "./app/editor-state";
import {
  clearCachedSource,
  readCachedEditorPreferences,
  readCachedSource,
  writeCachedDictionary,
  writeCachedSource,
  writeCachedStopWords,
  writeCachedStylePreferences,
} from "./app/local-draft";
import type { CachedEditorPreferences } from "./app/local-draft";
import {
  decodeSnapshotFile,
  encodeSnapshotFile,
  SNAPSHOT_FILE_EXTENSION,
} from "./core/file-snapshot";
import { LIMITS } from "./core/limits";
import type { LayoutStyle } from "./core/layout";
import { recolorScene } from "./core/scene";
import { decodeSnapshotFragment, encodeSnapshot } from "./core/snapshot";
import { tokenize } from "./core/tokenizer";
import { buildWordSet } from "./core/word-model";
import { CloudPreview } from "./components/CloudPreview";
import { SharePanel } from "./components/SharePanel";
import { SourcePanel } from "./components/SourcePanel";
import { StatusAnnouncer } from "./components/StatusAnnouncer";
import { StylePanel } from "./components/StylePanel";
import { TokenRulesPanel } from "./components/TokenRulesPanel";
import { WordTable } from "./components/WordTable";
import {
  createBrowserEngineClient,
  EngineClient,
  runLayoutFallback,
} from "./app/engine-client";
import { renderScenePng } from "./render/png";
import { renderSceneSvg } from "./render/svg";
import { createGlyphSprites } from "./render/glyph-sprites";

function measureWithCanvas(term: string, font: string): FontMetric {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return { width: Math.max(8, term.length * 9), height: 16 };
  context.font = font;
  const metrics = context.measureText(term);
  return {
    width: Math.max(8, metrics.width),
    height: Math.max(
      16,
      (metrics.actualBoundingBoxAscent || 12) +
        (metrics.actualBoundingBoxDescent || 4),
    ),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "發生未知錯誤，請重新嘗試。";
}

function initialCachedSource(): string {
  if (
    typeof window !== "undefined" &&
    window.location.hash.startsWith("#wc-pako:")
  ) {
    return "";
  }
  return readCachedSource();
}

function initialCachedPreferences(): CachedEditorPreferences {
  if (
    typeof window !== "undefined" &&
    window.location.hash.startsWith("#wc-pako:")
  ) {
    return {};
  }
  return readCachedEditorPreferences();
}

function initialEditorState(): EditorState {
  const initial = createInitialEditorState();
  const cached = initialCachedPreferences();
  const sourceText = initialCachedSource();
  const cachedPresentation = cached.presentation;

  return {
    ...initial,
    mode: sourceText ? "source" : initial.mode,
    sourceText,
    settings: {
      ...initial.settings,
      stopWords: [...(cached.stopWords ?? initial.settings.stopWords)],
      dictionary: [...(cached.dictionary ?? initial.settings.dictionary)],
    },
    presentation: {
      ...initial.presentation,
      ...(cachedPresentation ?? {}),
      canvas: { ...initial.presentation.canvas },
      rotations: [
        ...(cachedPresentation?.rotations ?? initial.presentation.rotations),
      ],
      palette: [
        ...(cachedPresentation?.palette ?? initial.presentation.palette),
      ],
    },
  };
}

export function App() {
  const [state, setState] = useState<EditorState>(initialEditorState);
  const [status, setStatus] = useState(() =>
    state.sourceText
      ? "已從本機草稿還原原文；內容只留在這個瀏覽器裡。"
      : "準備就緒。原文只會留在這個瀏覽器裡。",
  );
  const [exporting, setExporting] = useState(false);
  const clientRef = useRef<EngineClient | null>(null);
  const generationRef = useRef(0);

  const invalidatePendingWork = useCallback(() => {
    generationRef.current += 1;
    clientRef.current?.cancel();
    setExporting(false);
  }, []);

  useEffect(() => {
    const client = createBrowserEngineClient();
    clientRef.current = client;
    return () => {
      invalidatePendingWork();
      client?.dispose();
      clientRef.current = null;
    };
  }, [invalidatePendingWork]);

  useEffect(() => {
    const loadHash = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#wc-pako:")) return;
      invalidatePendingWork();
      try {
        const snapshot = decodeSnapshotFragment(hash);
        setState(fromSnapshot(snapshot));
        setStatus("已載入 V 快照；目前是僅樣式編輯模式。");
      } catch (error) {
        setState((current) => ({
          ...current,
          mode: "error",
          error: `無法載入 V 快照：${errorText(error)}`,
        }));
        setStatus("V 快照無效，原本狀態未被部分還原。");
      }
    };
    loadHash();
    window.addEventListener("hashchange", loadHash);
    return () => window.removeEventListener("hashchange", loadHash);
  }, [invalidatePendingWork]);

  const tokenPreview = useMemo(() => {
    if (!state.sourceText || state.mode === "remix") return undefined;
    return tokenize(state.sourceText, state.settings);
  }, [state.mode, state.settings, state.sourceText]);

  const makeMetrics = useCallback(
    async (
      wordSet: NonNullable<EditorState["wordSet"]>,
      presentation: LayoutStyle,
      shouldCancel: () => boolean,
    ) => {
      await waitForFonts(document.fonts);
      const metrics = createFontMetricsTable(
        wordSet.words.map((word) => word.term),
        {
          id: presentation.fontFamily,
          family: presentation.fontFamily,
          weight: 500,
          style: "normal",
        },
        16,
        measureWithCanvas,
      );
      metrics.sprites = await createGlyphSprites(
        wordSet,
        presentation,
        shouldCancel,
      );
      return metrics;
    },
    [],
  );

  const runLayout = useCallback(
    async (
      wordSet: NonNullable<EditorState["wordSet"]>,
      presentation: LayoutStyle,
      mode: EditorState["mode"],
      tokenization?: EditorState["tokenization"],
    ) => {
      const runId = ++generationRef.current;
      setState((current) => ({
        ...current,
        mode: "generating",
        error: undefined,
        shareUrl: undefined,
        shareError: undefined,
        scene: undefined,
      }));
      setStatus("正在本機分頁排版⋯");
      try {
        const metrics = await makeMetrics(
          wordSet,
          presentation,
          () => runId !== generationRef.current,
        );
        let scene;
        if (clientRef.current) {
          try {
            scene = await clientRef.current.submit({
              wordSet,
              style: presentation,
              metrics,
            });
          } catch (error) {
            if (runId !== generationRef.current) return;
            if (
              errorText(error).includes("superseded") ||
              errorText(error).includes("cancelled")
            )
              return;
            setStatus("排版 worker 不可用，已切換到相同規則的本機 fallback。");
            scene = runLayoutFallback({
              wordSet,
              style: presentation,
              metrics,
            });
          }
        } else {
          scene = runLayoutFallback({ wordSet, style: presentation, metrics });
        }
        if (runId !== generationRef.current) return;
        setState((current) => ({
          ...current,
          mode: mode === "remix" ? "remix" : "ready",
          tokenization: tokenization ?? current.tokenization,
          wordSet,
          presentation,
          scene,
          error: undefined,
        }));
        setStatus(
          scene.words.some((word) => word.status !== "placed")
            ? "文字雲完成，但有詞語未能放入畫布；請查看排名表。"
            : "文字雲完成，所有詞語都已排入畫布。",
        );
      } catch (error) {
        if (runId !== generationRef.current) return;
        setState((current) => ({
          ...current,
          mode: "error",
          error: `排版失敗：${errorText(error)}`,
        }));
        setStatus("排版失敗，請調整設定後重試。");
      }
    },
    [makeMetrics],
  );

  const handleGenerate = useCallback(() => {
    invalidatePendingWork();
    const result = tokenize(state.sourceText, state.settings);
    setState((current) => ({ ...current, tokenization: result }));
    if (result.status !== "ok") {
      const message = result.diagnostics[0]?.message ?? "沒有可繪製的詞語。";
      setState((current) => ({
        ...current,
        mode: result.status === "empty" ? "empty" : "error",
        wordSet: undefined,
        scene: undefined,
        error: message,
      }));
      setStatus(message);
      return;
    }
    try {
      const wordSet = buildWordSet(result.tokens, {
        caseMode: state.settings.caseMode,
        caseInsensitive: state.settings.caseInsensitive,
        locale: state.settings.locale,
        tokenizerVersion: result.tokenizerVersion,
      });
      void runLayout(wordSet, state.presentation, "ready", result);
    } catch (error) {
      const message = errorText(error);
      setState((current) => ({
        ...current,
        mode: "error",
        wordSet: undefined,
        scene: undefined,
        error: message,
      }));
      setStatus(message);
    }
  }, [
    invalidatePendingWork,
    runLayout,
    state.presentation,
    state.settings,
    state.sourceText,
  ]);

  const handleSourceChange = useCallback(
    (sourceText: string) => {
      invalidatePendingWork();
      writeCachedSource(sourceText);
      setState((current) => ({
        ...current,
        mode: sourceText ? "source" : "empty",
        sourceText,
        wordSet: undefined,
        scene: undefined,
        error: undefined,
        shareUrl: undefined,
        shareError: undefined,
      }));
      setStatus(
        sourceText
          ? "原文已更新，請預覽分詞後產生文字雲。"
          : "請輸入文字開始。 ",
      );
    },
    [invalidatePendingWork],
  );

  const handleSettingsChange = useCallback(
    (settings: EditorState["settings"]) => {
      invalidatePendingWork();
      if (state.settings.stopWords !== settings.stopWords) {
        writeCachedStopWords(settings.stopWords);
      }
      if (state.settings.dictionary !== settings.dictionary) {
        writeCachedDictionary(settings.dictionary);
      }
      setState((current) => ({
        ...current,
        settings,
        mode: current.sourceText ? "source" : "empty",
        wordSet: undefined,
        scene: undefined,
        tokenization: undefined,
        error: undefined,
        shareUrl: undefined,
        shareError: undefined,
      }));
    },
    [
      invalidatePendingWork,
      state.settings.dictionary,
      state.settings.stopWords,
    ],
  );

  const handlePresentationChange = useCallback(
    (presentation: LayoutStyle) => {
      invalidatePendingWork();
      writeCachedStylePreferences(presentation);
      const previous = state.presentation;
      setState((current) => ({
        ...current,
        presentation,
        shareUrl: undefined,
        shareError: undefined,
      }));
      if (!state.wordSet || !state.scene) return;
      if (!isGeometryChanging(previous, presentation)) {
        setState((current) => ({
          ...current,
          scene: current.scene
            ? recolorScene(
                current.scene,
                presentation.palette,
                presentation.background,
              )
            : current.scene,
        }));
        setStatus("顏色更新完成，位置保持不變。");
        return;
      }
      void runLayout(
        state.wordSet,
        presentation,
        state.mode === "remix" ? "remix" : "ready",
        state.tokenization,
      );
    },
    [
      runLayout,
      invalidatePendingWork,
      state.mode,
      state.presentation,
      state.scene,
      state.tokenization,
      state.wordSet,
    ],
  );

  const handleCreateLink = useCallback(() => {
    if (state.mode === "generating" || !state.wordSet || !state.scene) return;
    try {
      const fragment = encodeSnapshot(
        state.wordSet,
        state.presentation,
        state.scene,
      ).fragment;
      const url = buildShareUrl(
        `${window.location.origin}${window.location.pathname}`,
        fragment,
      );
      setState((current) => ({
        ...current,
        shareUrl: url,
        shareError: undefined,
      }));
      setStatus("V 連結已產生；它包含衍生資料，不包含原文。 ");
    } catch (error) {
      setState((current) => ({
        ...current,
        shareUrl: undefined,
        shareError: `V 連結未產生：${errorText(error)} 請下載完整 .wc 快照。`,
      }));
      setStatus("V 連結超過安全長度，完整視覺仍保留在本機。");
    }
  }, [state.mode, state.presentation, state.scene, state.wordSet]);

  const handleCopy = useCallback(async () => {
    if (!state.shareUrl) return;
    try {
      if (navigator.clipboard)
        await navigator.clipboard.writeText(state.shareUrl);
      else throw new Error("clipboard unavailable");
      setStatus("V 連結已複製。");
    } catch {
      const input = document.createElement("textarea");
      input.value = state.shareUrl;
      input.setAttribute("readonly", "true");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      document.execCommand("copy");
      input.remove();
      setStatus("V 連結已複製。");
    }
  }, [state.shareUrl]);

  const downloadBlob = useCallback((blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);

  const downloadBytes = useCallback(
    (bytes: Uint8Array, name: string) => {
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      downloadBlob(
        new Blob([copy], { type: "application/octet-stream" }),
        name,
      );
    },
    [downloadBlob],
  );

  const handleDownload = useCallback(() => {
    if (state.mode === "generating" || !state.wordSet || !state.scene) return;
    try {
      downloadBytes(
        encodeSnapshotFile(state.wordSet, state.presentation, state.scene),
        `wordcloud${SNAPSHOT_FILE_EXTENSION}`,
      );
      setStatus("完整 .wc 快照已下載。");
    } catch (error) {
      setState((current) => ({
        ...current,
        shareError: `快照下載失敗：${errorText(error)}`,
      }));
      setStatus("快照下載失敗。");
    }
  }, [
    downloadBytes,
    state.mode,
    state.presentation,
    state.scene,
    state.wordSet,
  ]);

  const handleExportSvg = useCallback(() => {
    if (state.mode === "generating" || !state.scene) return;
    try {
      const svg = renderSceneSvg(state.scene);
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "wordcloud.svg");
      setStatus("SVG 已下載；它與目前畫布使用同一份 SceneModel。 ");
    } catch (error) {
      setState((current) => ({
        ...current,
        shareError: `SVG 匯出失敗：${errorText(error)}`,
      }));
      setStatus("SVG 匯出失敗。");
    }
  }, [downloadBlob, state.mode, state.scene]);

  const handleExportPng = useCallback(async () => {
    if (state.mode === "generating" || !state.scene || exporting) return;
    invalidatePendingWork();
    const exportGeneration = generationRef.current;
    const scene = state.scene;
    setExporting(true);
    setStatus("正在本機產生 PNG⋯");
    try {
      const png = await renderScenePng(scene);
      if (exportGeneration !== generationRef.current) return;
      downloadBlob(png, "wordcloud.png");
      setStatus("PNG 已下載；它與目前畫布使用同一份 SceneModel。 ");
    } catch (error) {
      if (exportGeneration !== generationRef.current) return;
      setState((current) => ({
        ...current,
        shareError: `PNG 匯出失敗：${errorText(error)}`,
      }));
      setStatus("PNG 匯出失敗。");
    } finally {
      if (exportGeneration === generationRef.current) setExporting(false);
    }
  }, [downloadBlob, exporting, invalidatePendingWork, state.mode, state.scene]);

  const handleImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      invalidatePendingWork();
      const importGeneration = generationRef.current;
      try {
        if (file.size > LIMITS.maxSnapshotFileBytes) {
          throw new Error(
            `snapshot file exceeds ${LIMITS.maxSnapshotFileBytes} bytes`,
          );
        }
        const snapshot = decodeSnapshotFile(await file.arrayBuffer());
        if (importGeneration !== generationRef.current) return;
        setState(fromSnapshot(snapshot));
        setStatus("快照已匯入；現在可以調整樣式並產生新的 V。 ");
      } catch (error) {
        if (importGeneration !== generationRef.current) return;
        setState((current) => ({
          ...current,
          mode: "error",
          error: `快照匯入失敗：${errorText(error)}`,
        }));
        setStatus("快照匯入失敗，原本畫面仍保持不變。");
      }
    },
    [invalidatePendingWork],
  );

  const handleNewSource = useCallback(() => {
    if (window.location.hash) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
    invalidatePendingWork();
    clearCachedSource();
    setState(createInitialEditorState());
    setStatus("已開始新的文字雲，請輸入原文。 ");
  }, [invalidatePendingWork]);

  const [highlightedTerm, setHighlightedTerm] = useState<string>();
  const focusWord = useCallback((term: string) => {
    setHighlightedTerm(term);
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            ✳
          </span>
          <div>
            <p className="brand-name">Wordcloud Studio</p>
            <p className="brand-subtitle">private typography lab</p>
          </div>
        </div>
        <span className={`mode-badge ${state.mode === "remix" ? "remix" : ""}`}>
          {state.mode === "remix" ? "V / STYLE REMIX" : "BROWSER / LOCAL"}
        </span>
      </header>
      <StatusAnnouncer message={status} />
      <main className="studio-grid">
        <aside className="control-column">
          {state.mode === "remix" && (
            <div className="remix-banner">
              <strong>你正在編輯一個 V 快照。</strong>
              <p>
                詞語與詞頻是唯讀的；原文與自訂分詞規則不會被帶進連結。樣式可以重新排版。
              </p>
            </div>
          )}
          {state.error && (
            <div className="remix-banner" role="alert">
              <strong>需要你的注意</strong>
              <p>{state.error}</p>
              <button
                className="text-button"
                type="button"
                onClick={handleNewSource}
              >
                回到新的文字雲
              </button>
            </div>
          )}
          <SourcePanel
            sourceText={state.sourceText}
            settings={state.settings}
            preview={tokenPreview}
            disabled={state.mode === "remix"}
            onSourceChange={handleSourceChange}
            onSettingsChange={handleSettingsChange}
          />
          <TokenRulesPanel
            settings={state.settings}
            disabled={state.mode === "remix"}
            onSettingsChange={handleSettingsChange}
          />
          {state.mode !== "remix" && (
            <div className="generate-bar">
              <button
                id="generate-cloud"
                className="button button-primary"
                type="button"
                onClick={handleGenerate}
                disabled={state.mode === "generating"}
              >
                產生文字雲
              </button>
              <p className="generate-hint">
                {state.mode === "generating"
                  ? "本機排版中⋯"
                  : "按下後才開始分析"}
              </p>
            </div>
          )}
          <StylePanel
            presentation={state.presentation}
            disabled={state.mode === "generating"}
            onChange={handlePresentationChange}
          />
          {!state.scene && (
            <CloudPreview scene={undefined} highlightedTerm={highlightedTerm} />
          )}
          <SharePanel
            shareUrl={state.shareUrl}
            shareError={state.shareError}
            disabled={!state.scene || state.mode === "generating"}
            onCreateLink={handleCreateLink}
            onCopy={handleCopy}
            onDownload={handleDownload}
            onExportSvg={handleExportSvg}
            onExportPng={handleExportPng}
            exporting={exporting}
            onImport={handleImport}
            onNewSource={handleNewSource}
          />
          <WordTable
            wordSet={state.wordSet}
            scene={state.scene}
            onFocusWord={focusWord}
          />
        </aside>
        {state.scene && (
          <section className="preview-column">
            <CloudPreview
              scene={state.scene}
              highlightedTerm={highlightedTerm}
            />
          </section>
        )}
      </main>
    </div>
  );
}
