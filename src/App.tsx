import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
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
  writeCachedTokenizerSettings,
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
import { TokenizationPanel } from "./components/TokenizationPanel";
import { TokenRulesPanel } from "./components/TokenRulesPanel";
import { WordTable } from "./components/WordTable";
import { WizardStepper } from "./components/WizardStepper";
import {
  createBrowserEngineClient,
  EngineClient,
  runLayoutFallback,
} from "./app/engine-client";
import { renderScenePng } from "./render/png";
import { renderSceneSvg } from "./render/svg";
import { createGlyphSprites } from "./render/glyph-sprites";
import {
  translateTokenizerDiagnostic,
  UI_LOCALE_OPTIONS,
  useI18n,
} from "./i18n";
import {
  pathForStep,
  stepForPath,
  WIZARD_STEPS,
  type WizardStep,
} from "./app/wizard-route";

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
  return error instanceof Error
    ? error.message
    : "An unknown error occurred. Please try again.";
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
      ...(cached.tokenizerSettings ?? {}),
      stopWords: [...(cached.stopWords ?? initial.settings.stopWords)],
      dictionary: [...(cached.dictionary ?? initial.settings.dictionary)],
      rules: [...(cached.tokenizerSettings?.rules ?? initial.settings.rules)],
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

function initialWizardStep(): WizardStep {
  if (typeof window === "undefined") return "source";
  if (window.location.hash.startsWith("#wc-pako:")) return "result";
  return stepForPath(window.location.pathname);
}

function sourceIsReady(sourceText: string): boolean {
  return (
    sourceText.trim().length > 0 &&
    new TextEncoder().encode(sourceText).byteLength <= LIMITS.maxSourceBytes
  );
}

function wordsAreReady(preview?: ReturnType<typeof tokenize>): boolean {
  return preview?.status === "ok" && preview.tokens.length > 0;
}

function canOpenStep(
  step: WizardStep,
  state: EditorState,
  preview?: ReturnType<typeof tokenize>,
): boolean {
  if (state.mode === "remix") return step === "style" || step === "result";
  if (step === "source") return true;
  if (!sourceIsReady(state.sourceText)) return false;
  if (step === "words") return true;
  return wordsAreReady(preview);
}

function firstIncompleteStep(
  state: EditorState,
  preview?: ReturnType<typeof tokenize>,
): WizardStep {
  if (state.mode === "remix") return "result";
  if (!sourceIsReady(state.sourceText)) return "source";
  if (!wordsAreReady(preview)) return "words";
  return "style";
}

export function App() {
  const { locale: uiLocale, setLocale, t } = useI18n();
  const [state, setState] = useState<EditorState>(initialEditorState);
  const [activeStep, setActiveStep] = useState<WizardStep>(initialWizardStep);
  const [stepError, setStepError] = useState<string>();
  const [status, setStatus] = useState(() =>
    state.sourceText ? t("readyRestored") : t("ready"),
  );
  const [exporting, setExporting] = useState(false);
  const clientRef = useRef<EngineClient | null>(null);
  const generationRef = useRef(0);
  const layoutTimerRef = useRef<number | undefined>(undefined);
  const hasGeneratedCloudRef = useRef(Boolean(state.scene || state.wordSet));

  const navigateToStep = useCallback((step: WizardStep, replace = false) => {
    const url = `${pathForStep(step)}${window.location.search}${window.location.hash}`;
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    setActiveStep(step);
    setStepError(undefined);
  }, []);

  const invalidatePendingWork = useCallback(() => {
    if (layoutTimerRef.current !== undefined) {
      window.clearTimeout(layoutTimerRef.current);
      layoutTimerRef.current = undefined;
    }
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
        hasGeneratedCloudRef.current = true;
        setStatus(t("snapshotLoaded"));
        navigateToStep("result", true);
      } catch (error) {
        setState((current) => ({
          ...current,
          mode: "error",
          error: `${t("snapshotInvalid")} ${errorText(error)}`,
        }));
        setStatus(t("snapshotInvalid"));
        navigateToStep("result", true);
      }
    };
    loadHash();
    window.addEventListener("hashchange", loadHash);
    return () => window.removeEventListener("hashchange", loadHash);
  }, [invalidatePendingWork, navigateToStep, t]);

  const tokenPreview = useMemo(() => {
    if (!state.sourceText || state.mode === "remix") return undefined;
    return tokenize(state.sourceText, state.settings);
  }, [state.mode, state.settings, state.sourceText]);

  const stateRef = useRef(state);
  const tokenPreviewRef = useRef(tokenPreview);
  useEffect(() => {
    stateRef.current = state;
    tokenPreviewRef.current = tokenPreview;
  }, [state, tokenPreview]);

  useEffect(() => {
    const syncRoute = () => {
      const hasSnapshot = window.location.hash.startsWith("#wc-pako:");
      const requestedStep = hasSnapshot
        ? "result"
        : stepForPath(window.location.pathname);
      const currentState = stateRef.current;
      const currentPreview = tokenPreviewRef.current;
      const nextStep =
        hasSnapshot || canOpenStep(requestedStep, currentState, currentPreview)
          ? requestedStep
          : firstIncompleteStep(currentState, currentPreview);
      const canonicalUrl = `${pathForStep(nextStep)}${window.location.search}${window.location.hash}`;
      if (
        `${window.location.pathname}${window.location.search}${window.location.hash}` !==
        canonicalUrl
      ) {
        window.history.replaceState(null, "", canonicalUrl);
      }
      setActiveStep(nextStep);
    };

    syncRoute();
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    requestAnimationFrame(() => {
      document.getElementById("wizard-page-title")?.focus();
    });
  }, [activeStep]);

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
      setStatus(t("layoutWorking"));
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
            setStatus(t("workerFallback"));
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
        hasGeneratedCloudRef.current = true;
        setStatus(
          scene.words.some((word) => word.status !== "placed")
            ? t("someOmitted")
            : t("allPlaced"),
        );
      } catch (error) {
        if (runId !== generationRef.current) return;
        setState((current) => ({
          ...current,
          mode: "error",
          error: t("generationFailed", { error: errorText(error) }),
        }));
        setStatus(t("generationFailedStatus"));
      }
    },
    [makeMetrics, t],
  );

  const refreshFromInput = useCallback(
    (
      sourceText: string,
      settings: EditorState["settings"],
      presentation: LayoutStyle,
    ) => {
      if (!sourceIsReady(sourceText)) return;
      const result = tokenize(sourceText, settings);
      if (result.status !== "ok" || result.tokens.length === 0) {
        const diagnostic = result.diagnostics[0];
        const message = diagnostic
          ? translateTokenizerDiagnostic(diagnostic, t)
          : t("noWords");
        setState((current) => ({
          ...current,
          mode: "error",
          tokenization: result,
          wordSet: undefined,
          scene: undefined,
          error: message,
          shareUrl: undefined,
          shareError: undefined,
        }));
        setStatus(message);
        return;
      }

      try {
        const wordSet = buildWordSet(result.tokens, {
          caseMode: settings.caseMode,
          caseInsensitive: settings.caseInsensitive,
          locale: settings.locale,
          tokenizerVersion: result.tokenizerVersion,
        });
        setState((current) => ({
          ...current,
          mode: "generating",
          tokenization: result,
          wordSet,
          scene: undefined,
          error: undefined,
          shareUrl: undefined,
          shareError: undefined,
        }));
        void runLayout(wordSet, presentation, "ready", result);
      } catch (error) {
        const message = errorText(error);
        setState((current) => ({
          ...current,
          mode: "error",
          tokenization: result,
          wordSet: undefined,
          scene: undefined,
          error: message,
          shareUrl: undefined,
          shareError: undefined,
        }));
        setStatus(message);
      }
    },
    [runLayout, t],
  );

  const scheduleInputRefresh = useCallback(
    (
      sourceText: string,
      settings: EditorState["settings"],
      presentation: LayoutStyle,
    ) => {
      if (layoutTimerRef.current !== undefined) {
        window.clearTimeout(layoutTimerRef.current);
      }
      layoutTimerRef.current = window.setTimeout(() => {
        layoutTimerRef.current = undefined;
        refreshFromInput(sourceText, settings, presentation);
      }, 250);
    },
    [refreshFromInput],
  );

  const handleGenerate = useCallback(() => {
    invalidatePendingWork();
    const result = tokenize(state.sourceText, state.settings);
    setState((current) => ({ ...current, tokenization: result }));
    if (result.status !== "ok" || result.tokens.length === 0) {
      const diagnostic = result.diagnostics[0];
      const message = diagnostic
        ? translateTokenizerDiagnostic(diagnostic, t)
        : t("noWords");
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
      setState((current) => ({
        ...current,
        tokenization: result,
        wordSet,
        error: undefined,
        shareUrl: undefined,
        shareError: undefined,
      }));
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
    t,
    state.presentation,
    state.settings,
    state.sourceText,
  ]);

  useEffect(() => {
    if (
      (activeStep !== "style" && activeStep !== "result") ||
      state.mode === "remix" ||
      state.mode === "generating" ||
      state.mode === "error" ||
      state.scene ||
      !sourceIsReady(state.sourceText) ||
      !wordsAreReady(tokenPreview)
    ) {
      return;
    }
    handleGenerate();
  }, [
    activeStep,
    handleGenerate,
    state.mode,
    state.scene,
    state.sourceText,
    tokenPreview,
  ]);

  const handleStepSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setStepError(undefined);

      if (activeStep === "source") {
        if (!state.sourceText.trim()) {
          setStepError(t("diagnosticEmptyInput"));
          requestAnimationFrame(() =>
            document.getElementById("source-text")?.focus(),
          );
          return;
        }
        if (!sourceIsReady(state.sourceText)) {
          setStepError(t("diagnosticSourceLimit"));
          requestAnimationFrame(() =>
            document.getElementById("source-text")?.focus(),
          );
          return;
        }
        navigateToStep("words");
        return;
      }

      if (activeStep === "words") {
        if (!wordsAreReady(tokenPreview)) {
          const diagnostic = tokenPreview?.diagnostics[0];
          setStepError(
            diagnostic
              ? translateTokenizerDiagnostic(diagnostic, t)
              : t("noWords"),
          );
          requestAnimationFrame(() =>
            document.getElementById("wizard-step-error")?.focus(),
          );
          return;
        }
        navigateToStep("style");
        return;
      }

      if (activeStep === "style") {
        if (state.mode === "generating" || !state.scene) {
          setStepError(t("wizardPreviewPending"));
          requestAnimationFrame(() =>
            document.getElementById("wizard-step-error")?.focus(),
          );
          return;
        }
        navigateToStep("result");
      }
    },
    [
      activeStep,
      navigateToStep,
      state.mode,
      state.scene,
      state.sourceText,
      t,
      tokenPreview,
    ],
  );

  const handlePreviousStep = useCallback(() => {
    const index = WIZARD_STEPS.indexOf(activeStep);
    const previous = WIZARD_STEPS[index - 1];
    if (previous && canOpenStep(previous, state, tokenPreview)) {
      navigateToStep(previous);
    }
  }, [activeStep, navigateToStep, state, tokenPreview]);

  const handleSourceChange = useCallback(
    (sourceText: string) => {
      const shouldRefresh = Boolean(
        hasGeneratedCloudRef.current || state.wordSet || state.scene,
      );
      const settings = state.settings;
      const presentation = state.presentation;
      invalidatePendingWork();
      writeCachedSource(sourceText);
      setStepError(undefined);
      setState((current) => ({
        ...current,
        mode:
          shouldRefresh && sourceIsReady(sourceText)
            ? "generating"
            : sourceText
              ? "source"
              : "empty",
        sourceText,
        wordSet: undefined,
        scene: undefined,
        tokenization: undefined,
        error: undefined,
        shareUrl: undefined,
        shareError: undefined,
      }));
      if (shouldRefresh && sourceIsReady(sourceText)) {
        scheduleInputRefresh(sourceText, settings, presentation);
      }
    },
    [
      invalidatePendingWork,
      scheduleInputRefresh,
      state.presentation,
      state.scene,
      state.settings,
      state.wordSet,
    ],
  );

  const handleSettingsChange = useCallback(
    (settings: EditorState["settings"]) => {
      const shouldRefresh = Boolean(
        hasGeneratedCloudRef.current || state.wordSet || state.scene,
      );
      const sourceText = state.sourceText;
      const presentation = state.presentation;
      invalidatePendingWork();
      if (state.settings.stopWords !== settings.stopWords) {
        writeCachedStopWords(settings.stopWords);
      }
      if (state.settings.dictionary !== settings.dictionary) {
        writeCachedDictionary(settings.dictionary);
      }
      writeCachedTokenizerSettings(settings);
      setStepError(undefined);
      setState((current) => ({
        ...current,
        settings,
        mode:
          shouldRefresh && sourceIsReady(sourceText)
            ? "generating"
            : current.sourceText
              ? "source"
              : "empty",
        wordSet: undefined,
        scene: undefined,
        tokenization: undefined,
        error: undefined,
        shareUrl: undefined,
        shareError: undefined,
      }));
      if (shouldRefresh && sourceIsReady(sourceText)) {
        scheduleInputRefresh(sourceText, settings, presentation);
      }
    },
    [
      invalidatePendingWork,
      scheduleInputRefresh,
      state.presentation,
      state.scene,
      state.sourceText,
      state.settings.dictionary,
      state.settings.stopWords,
      state.wordSet,
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
        setStatus(t("colorsUpdated"));
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
      t,
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
      setStatus(t("linkCreated"));
    } catch (error) {
      setState((current) => ({
        ...current,
        shareUrl: undefined,
        shareError: t("linkFailed", { error: errorText(error) }),
      }));
      setStatus(t("linkTooLong"));
    }
  }, [state.mode, state.presentation, state.scene, state.wordSet, t]);

  const handleCopy = useCallback(async () => {
    if (!state.shareUrl) return;
    try {
      if (navigator.clipboard)
        await navigator.clipboard.writeText(state.shareUrl);
      else throw new Error("clipboard unavailable");
      setStatus(t("linkCopied"));
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
      setStatus(t("linkCopied"));
    }
  }, [state.shareUrl, t]);

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
      setStatus(t("snapshotDownloaded"));
    } catch (error) {
      setState((current) => ({
        ...current,
        shareError: t("snapshotDownloadFailed", { error: errorText(error) }),
      }));
      setStatus(t("snapshotDownloadFailed", { error: errorText(error) }));
    }
  }, [
    downloadBytes,
    state.mode,
    state.presentation,
    state.scene,
    state.wordSet,
    t,
  ]);

  const handleExportSvg = useCallback(() => {
    if (state.mode === "generating" || !state.scene) return;
    try {
      const svg = renderSceneSvg(state.scene);
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "wordcloud.svg");
      setStatus(t("svgDownloaded"));
    } catch (error) {
      setState((current) => ({
        ...current,
        shareError: t("svgDownloadFailed", { error: errorText(error) }),
      }));
      setStatus(t("svgDownloadFailed", { error: errorText(error) }));
    }
  }, [downloadBlob, state.mode, state.scene, t]);

  const handleExportPng = useCallback(async () => {
    if (state.mode === "generating" || !state.scene || exporting) return;
    invalidatePendingWork();
    const exportGeneration = generationRef.current;
    const scene = state.scene;
    setExporting(true);
    setStatus(t("pngGenerating"));
    try {
      const png = await renderScenePng(scene);
      if (exportGeneration !== generationRef.current) return;
      downloadBlob(png, "wordcloud.png");
      setStatus(t("pngDownloaded"));
    } catch (error) {
      if (exportGeneration !== generationRef.current) return;
      setState((current) => ({
        ...current,
        shareError: t("pngDownloadFailed", { error: errorText(error) }),
      }));
      setStatus(t("pngDownloadFailed", { error: errorText(error) }));
    } finally {
      if (exportGeneration === generationRef.current) setExporting(false);
    }
  }, [
    downloadBlob,
    exporting,
    invalidatePendingWork,
    state.mode,
    state.scene,
    t,
  ]);

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
        hasGeneratedCloudRef.current = true;
        setStatus(t("snapshotImported"));
        window.history.replaceState(
          null,
          "",
          `${pathForStep("result")}${window.location.search}`,
        );
        setActiveStep("result");
        setStepError(undefined);
      } catch (error) {
        if (importGeneration !== generationRef.current) return;
        setState((current) => ({
          ...current,
          mode: "error",
          error: `${t("snapshotImportFailed")} ${errorText(error)}`,
        }));
        setStatus(t("snapshotImportFailed"));
      }
    },
    [invalidatePendingWork, t],
  );

  const handleNewSource = useCallback(() => {
    invalidatePendingWork();
    clearCachedSource();
    hasGeneratedCloudRef.current = false;
    window.history.replaceState(
      null,
      "",
      `${pathForStep("source")}${window.location.search}`,
    );
    setActiveStep("source");
    setStepError(undefined);
    setState(initialEditorState());
    setStatus(t("newCloudStarted"));
  }, [invalidatePendingWork, t]);

  const [highlightedTerm, setHighlightedTerm] = useState<string>();
  const focusWord = useCallback((term: string) => {
    setHighlightedTerm(term);
  }, []);

  const pageTitleKeys = {
    source: "wizardPageSourceTitle",
    words: "wizardPageWordsTitle",
    style: "wizardPageStyleTitle",
    result: "wizardPageResultTitle",
  } as const;
  const pageDescriptionKeys = {
    source: "wizardPageSourceDescription",
    words: "wizardPageWordsDescription",
    style: "wizardPageStyleDescription",
    result: "wizardPageResultDescription",
  } as const;
  const activeStepNumber = WIZARD_STEPS.indexOf(activeStep) + 1;
  const sourceLimitError =
    state.sourceText &&
    new TextEncoder().encode(state.sourceText).byteLength >
      LIMITS.maxSourceBytes
      ? t("diagnosticSourceLimit")
      : undefined;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            ✳
          </span>
          <div>
            <p className="brand-name">Wordcloud Studio</p>
            <p className="brand-subtitle">{t("brandSubtitle")}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <label className="sr-only" htmlFor="ui-locale">
            {t("language")}
          </label>
          <select
            id="ui-locale"
            className="language-select"
            value={uiLocale}
            aria-label={t("language")}
            onChange={(event) =>
              setLocale(event.target.value as typeof uiLocale)
            }
          >
            {UI_LOCALE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </header>
      <StatusAnnouncer message={status} />
      <main className="wizard-main">
        <WizardStepper
          currentStep={activeStep}
          remix={state.mode === "remix"}
          onNavigate={navigateToStep}
        />
        <section
          className={`wizard-page wizard-page--${activeStep}`}
          aria-labelledby="wizard-page-title"
          aria-busy={state.mode === "generating"}
        >
          <header className="wizard-page-heading">
            <p className="section-kicker">
              {t("wizardProgressLabel", {
                current: activeStepNumber,
                total: 4,
              })}
            </p>
            <h1 id="wizard-page-title" tabIndex={-1}>
              {t(pageTitleKeys[activeStep])}
            </h1>
            <p>{t(pageDescriptionKeys[activeStep])}</p>
          </header>

          {state.mode === "remix" && activeStep === "result" && (
            <div className="remix-banner">
              <strong>{t("remixTitle")}</strong>
              <p>{t("remixBody")}</p>
            </div>
          )}

          {state.error && (
            <div className="wizard-error" role="alert">
              <strong>{t("attention")}</strong>
              <p>{state.error}</p>
              {activeStep === "style" &&
                state.mode !== "remix" &&
                state.wordSet && (
                  <button
                    className="button button-quiet"
                    type="button"
                    onClick={handleGenerate}
                  >
                    {t("wizardRetry")}
                  </button>
                )}
            </div>
          )}

          {state.mode === "generating" && (
            <p className="wizard-updating" role="status">
              {t("wizardUpdating")}
            </p>
          )}

          {activeStep === "source" && (
            <form
              className="wizard-form"
              noValidate
              onSubmit={handleStepSubmit}
            >
              <SourcePanel
                sourceText={state.sourceText}
                disabled={state.mode === "remix"}
                error={stepError ?? sourceLimitError}
                onSourceChange={handleSourceChange}
              />
              <div className="wizard-actions wizard-actions-end">
                <button className="button button-primary" type="submit">
                  {t("wizardContinue")}
                </button>
              </div>
            </form>
          )}

          {activeStep === "words" && (
            <form
              className="wizard-form"
              noValidate
              onSubmit={handleStepSubmit}
            >
              <TokenizationPanel
                settings={state.settings}
                preview={tokenPreview}
                disabled={state.mode === "remix"}
                onSettingsChange={handleSettingsChange}
              />
              <TokenRulesPanel
                settings={state.settings}
                disabled={state.mode === "remix"}
                onSettingsChange={handleSettingsChange}
              />
              {stepError && (
                <p
                  className="warning-note wizard-step-error"
                  id="wizard-step-error"
                  role="alert"
                  tabIndex={-1}
                >
                  {stepError}
                </p>
              )}
              <div className="wizard-actions">
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={handlePreviousStep}
                >
                  {t("wizardBack")}
                </button>
                <button className="button button-primary" type="submit">
                  {t("wizardContinue")}
                </button>
              </div>
            </form>
          )}

          {activeStep === "style" && (
            <form
              className="wizard-form"
              noValidate
              onSubmit={handleStepSubmit}
            >
              <div className="wizard-style-layout">
                <StylePanel
                  presentation={state.presentation}
                  disabled={state.mode === "generating"}
                  onChange={handlePresentationChange}
                />
                <CloudPreview
                  scene={state.scene}
                  highlightedTerm={highlightedTerm}
                />
              </div>
              {stepError && (
                <p
                  className="warning-note wizard-step-error"
                  id="wizard-step-error"
                  role="alert"
                  tabIndex={-1}
                >
                  {stepError}
                </p>
              )}
              <div className="wizard-actions">
                {!(state.mode === "remix" && activeStep === "style") && (
                  <button
                    className="button button-quiet"
                    type="button"
                    onClick={handlePreviousStep}
                  >
                    {t("wizardBack")}
                  </button>
                )}
                <button className="button button-primary" type="submit">
                  {t("wizardContinue")}
                </button>
              </div>
            </form>
          )}

          {activeStep === "result" && (
            <div className="wizard-form">
              <CloudPreview
                scene={state.scene}
                highlightedTerm={highlightedTerm}
                captionAside={
                  <WordTable
                    wordSet={state.wordSet}
                    scene={state.scene}
                    onFocusWord={focusWord}
                  />
                }
              />
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
              {activeStep === "result" && (
                <div className="wizard-actions">
                  <button
                    className="button button-quiet"
                    type="button"
                    onClick={handlePreviousStep}
                  >
                    {t("wizardBack")}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
