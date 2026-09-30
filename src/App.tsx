import type { ChangeEvent, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createInitialEditorState,
  DEFAULT_PRESENTATION,
  type EditorState,
  fromSnapshot,
  hasShapeFontDefaults,
  isGeometryChanging,
  withShapeFontDefaults,
} from "./app/editor-state";
import {
  createBrowserEngineClient,
  EngineClient,
  runLayoutFallback,
} from "./app/engine-client";
import type { CachedEditorPreferences } from "./app/local-draft";
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
import {
  pathForStep,
  SHARE_PNG_PATH,
  SHARE_SVG_PATH,
  SHARE_VIEW_PATH,
  sharedImageFormatForPath,
  stepForPath,
  WIZARD_STEPS,
  type WizardStep,
} from "./app/wizard-route";
import { CloudPreview } from "./components/CloudPreview";
import { SharedImageRoute } from "./components/SharedImageRoute";
import { SharePanel } from "./components/SharePanel";
import { SourcePanel } from "./components/SourcePanel";
import { StatusAnnouncer } from "./components/StatusAnnouncer";
import { StylePanel } from "./components/StylePanel";
import { TokenizationPanel } from "./components/TokenizationPanel";
import { TokenRulesPanel } from "./components/TokenRulesPanel";
import { WizardStepper } from "./components/WizardStepper";
import { WordTable } from "./components/WordTable";
import {
  assertShareUrlNotTruncated,
  buildShareUrl,
  CodecError,
  type EncodedJsonFragment,
  encodeJsonFragment,
  snapshotFormatFromFragment,
} from "./core/codec";
import {
  decodeSnapshotFile,
  encodeSnapshotFile,
  SNAPSHOT_FILE_EXTENSION,
} from "./core/file-snapshot";
import type { LayoutStyle } from "./core/layout";
import { LIMITS } from "./core/limits";
import {
  createFontMetricsTable,
  type FontMetric,
  waitForFonts,
} from "./core/metrics";
import { recolorScene } from "./core/scene";
import { createSnapshot, decodeSnapshotFragment } from "./core/snapshot";
import { tokenize } from "./core/tokenizer";
import { buildWordSet, countUniqueTerms } from "./core/word-model";
import {
  type Translate,
  translateTokenizerDiagnostic,
  UI_LOCALE_OPTIONS,
  useI18n,
} from "./i18n";
import { createGlyphSprites } from "./render/glyph-sprites";
import { renderScenePng } from "./render/png";
import { renderSceneSvg } from "./render/svg";

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

function shareLoadErrorText(error: unknown, t: Translate): string {
  if (
    error instanceof CodecError &&
    error.code === "TRUNCATED" &&
    error.shareUrlLengths
  ) {
    return t("shareUrlTruncated", {
      actual: error.shareUrlLengths.actualChars,
      expected: error.shareUrlLengths.expectedChars,
    });
  }
  return errorText(error);
}

type ShareEncoder = (
  snapshot: ReturnType<typeof createSnapshot>,
) => EncodedJsonFragment | Promise<EncodedJsonFragment>;

function isSharedViewPath(pathname: string): boolean {
  let end = pathname.length;
  while (end > 0 && pathname[end - 1] === "/") end -= 1;
  return pathname.slice(0, end) === SHARE_VIEW_PATH;
}

function modeAfterInputChange(
  shouldRefresh: boolean,
  sourceText: string,
): EditorState["mode"] {
  if (shouldRefresh && sourceIsReady(sourceText)) return "generating";
  if (sourceText) return "source";
  return "empty";
}

function isSnapshotLocation(): boolean {
  return (
    typeof window !== "undefined" &&
    (isSharedViewPath(window.location.pathname) ||
      sharedImageFormatForPath(window.location.pathname) !== undefined ||
      snapshotFormatFromFragment(window.location.hash) !== undefined)
  );
}

function initialCachedSource(): string {
  if (isSnapshotLocation()) return "";
  return readCachedSource();
}

function initialCachedPreferences(): CachedEditorPreferences {
  if (isSnapshotLocation()) return {};
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
      ...cached.tokenizerSettings,
      stopWords: [...(cached.stopWords ?? initial.settings.stopWords)],
      dictionary: [...(cached.dictionary ?? initial.settings.dictionary)],
      rules: [...(cached.tokenizerSettings?.rules ?? initial.settings.rules)],
    },
    presentation: {
      ...initial.presentation,
      ...cachedPresentation,
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
  if (snapshotFormatFromFragment(window.location.hash)) return "result";
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

function shareLinkCreationStatusKey(v1Created: boolean, v2Created: boolean) {
  if (v1Created && v2Created) return "linksCreatedBoth";
  if (v1Created) return "linkCreatedV1Only";
  if (v2Created) return "linkCreatedV2Only";
  return "linkCreationFailed";
}

export function App() {
  const { locale: uiLocale, setLocale, t } = useI18n();
  const [state, setState] = useState<EditorState>(initialEditorState);
  const [activeStep, setActiveStep] = useState<WizardStep>(initialWizardStep);
  const [stepError, setStepError] = useState<string>();
  const [focusShapeSizeAfterNavigation, setFocusShapeSizeAfterNavigation] =
    useState(false);
  const [status, setStatus] = useState(() =>
    state.sourceText ? t("readyRestored") : t("ready"),
  );
  const [exporting, setExporting] = useState(false);
  const clientRef = useRef<EngineClient | null>(null);
  const generationRef = useRef(0);
  const shareGenerationRef = useRef(0);
  const layoutTimerRef = useRef<number | undefined>(undefined);
  const hasGeneratedCloudRef = useRef(Boolean(state.scene || state.wordSet));

  const navigateToStep = useCallback((step: WizardStep, replace = false) => {
    const path = sharedImageFormatForPath(window.location.pathname)
      ? window.location.pathname
      : isSharedViewPath(window.location.pathname) ||
          snapshotFormatFromFragment(window.location.hash) !== undefined
        ? SHARE_VIEW_PATH
        : pathForStep(step);
    const url = `${path}${window.location.search}${window.location.hash}`;
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
    shareGenerationRef.current += 1;
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
    const loadHash = async () => {
      const hash = window.location.hash;
      try {
        assertShareUrlNotTruncated(window.location.href);
      } catch (error) {
        setState((current) => ({
          ...current,
          mode: "error",
          error: `${t("snapshotInvalid")} ${shareLoadErrorText(error, t)}`,
        }));
        setStatus(t("snapshotInvalid"));
        navigateToStep("result", true);
        return;
      }
      const format = snapshotFormatFromFragment(hash);
      if (!format) {
        if (sharedImageFormatForPath(window.location.pathname)) {
          invalidatePendingWork();
          setState((current) => ({
            ...current,
            mode: "error",
            scene: undefined,
            error: t("snapshotInvalid"),
            shareUrl: undefined,
            shareUrlV2: undefined,
            shareError: undefined,
            shareErrorV1: undefined,
            shareErrorV2: undefined,
            shareEncoding: false,
          }));
          setStatus(t("snapshotInvalid"));
          navigateToStep("result", true);
        }
        return;
      }
      invalidatePendingWork();
      const loadId = shareGenerationRef.current;
      try {
        const snapshot =
          format === "v2"
            ? await (clientRef.current?.decodeShare(hash) ??
                Promise.reject(new Error(t("v2WorkerUnavailable"))))
            : decodeSnapshotFragment(hash);
        if (loadId !== shareGenerationRef.current) return;
        const shareUrl = buildShareUrl(
          `${window.location.origin}${SHARE_VIEW_PATH}`,
          hash,
        );
        setState({
          ...fromSnapshot(snapshot),
          ...(format === "v1" ? { shareUrl } : { shareUrlV2: shareUrl }),
        });
        hasGeneratedCloudRef.current = true;
        setStatus(t("snapshotLoaded"));
        navigateToStep("result", true);
      } catch (error) {
        if (loadId !== shareGenerationRef.current) return;
        setState((current) => ({
          ...current,
          mode: "error",
          error: `${t("snapshotInvalid")} ${shareLoadErrorText(error, t)}`,
        }));
        setStatus(t("snapshotInvalid"));
        navigateToStep("result", true);
      }
    };
    void loadHash();
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
      if (sharedImageFormatForPath(window.location.pathname)) {
        setActiveStep("result");
        return;
      }
      const hasSnapshot =
        snapshotFormatFromFragment(window.location.hash) !== undefined;
      const sharedView = isSharedViewPath(window.location.pathname);
      const requestedStep = hasSnapshot
        ? "result"
        : stepForPath(window.location.pathname);
      const currentState = stateRef.current;
      const currentPreview = tokenPreviewRef.current;
      const nextStep =
        hasSnapshot || canOpenStep(requestedStep, currentState, currentPreview)
          ? requestedStep
          : firstIncompleteStep(currentState, currentPreview);
      const canonicalPath =
        hasSnapshot || sharedView ? SHARE_VIEW_PATH : pathForStep(nextStep);
      const canonicalUrl = `${canonicalPath}${window.location.search}${window.location.hash}`;
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
      shareGenerationRef.current += 1;
      setState((current) => ({
        ...current,
        mode: "generating",
        error: undefined,
        shareUrl: undefined,
        shareUrlV2: undefined,
        shareError: undefined,
        shareErrorV1: undefined,
        shareErrorV2: undefined,
        shareEncoding: false,
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
          shareUrlV2: undefined,
          shareError: undefined,
          shareErrorV1: undefined,
          shareErrorV2: undefined,
          shareEncoding: false,
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
          shareUrlV2: undefined,
          shareError: undefined,
          shareErrorV1: undefined,
          shareErrorV2: undefined,
          shareEncoding: false,
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
          shareUrlV2: undefined,
          shareError: undefined,
          shareErrorV1: undefined,
          shareErrorV2: undefined,
          shareEncoding: false,
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
        shareUrlV2: undefined,
        shareError: undefined,
        shareErrorV1: undefined,
        shareErrorV2: undefined,
        shareEncoding: false,
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
          setStepError(
            t("diagnosticSourceLimit", {
              actual: new TextEncoder().encode(state.sourceText).byteLength,
              limit: LIMITS.maxSourceBytes,
            }),
          );
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
        mode: modeAfterInputChange(shouldRefresh, sourceText),
        sourceText,
        wordSet: undefined,
        scene: undefined,
        tokenization: undefined,
        error: undefined,
        shareUrl: undefined,
        shareUrlV2: undefined,
        shareError: undefined,
        shareErrorV1: undefined,
        shareErrorV2: undefined,
        shareEncoding: false,
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
        mode: modeAfterInputChange(shouldRefresh, current.sourceText),
        wordSet: undefined,
        scene: undefined,
        tokenization: undefined,
        error: undefined,
        shareUrl: undefined,
        shareUrlV2: undefined,
        shareError: undefined,
        shareErrorV1: undefined,
        shareErrorV2: undefined,
        shareEncoding: false,
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
      const previous = state.presentation;
      const requestedPresentation = {
        ...presentation,
        version: presentation.shape ? "layout-v2" : "layout-v1",
      };
      const nextPresentation = withShapeFontDefaults(
        previous,
        requestedPresentation,
        state.wordSet?.words.length ?? 36,
      );
      writeCachedStylePreferences(
        hasShapeFontDefaults(
          nextPresentation,
          state.wordSet?.words.length ?? 36,
        )
          ? {
              ...nextPresentation,
              minFontSize: DEFAULT_PRESENTATION.minFontSize,
              maxFontSize: DEFAULT_PRESENTATION.maxFontSize,
            }
          : nextPresentation,
      );
      setState((current) => ({
        ...current,
        presentation: nextPresentation,
        shareUrl: undefined,
        shareUrlV2: undefined,
        shareError: undefined,
        shareErrorV1: undefined,
        shareErrorV2: undefined,
        shareEncoding: false,
      }));
      if (!state.wordSet || !state.scene) return;
      if (!isGeometryChanging(previous, nextPresentation)) {
        setState((current) => ({
          ...current,
          scene: current.scene
            ? recolorScene(
                current.scene,
                nextPresentation.palette,
                nextPresentation.background,
              )
            : current.scene,
        }));
        setStatus(t("colorsUpdated"));
        return;
      }
      void runLayout(
        state.wordSet,
        nextPresentation,
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

  const createShareLink = useCallback(
    async (
      version: "v1" | "v2",
      snapshot: ReturnType<typeof createSnapshot>,
      isShareRunCurrent: () => boolean,
      encode: ShareEncoder,
    ): Promise<boolean> => {
      try {
        const { fragment } = await encode(snapshot);
        const url = buildShareUrl(
          `${window.location.origin}${SHARE_VIEW_PATH}`,
          fragment,
        );
        if (!isShareRunCurrent()) return false;
        const urlKey = version === "v1" ? "shareUrl" : "shareUrlV2";
        setState((current) => ({ ...current, [urlKey]: url }));
        return true;
      } catch (error) {
        if (!isShareRunCurrent()) return false;
        const errorKey = version === "v1" ? "shareErrorV1" : "shareErrorV2";
        const messageKey = version === "v1" ? "linkFailedV1" : "linkFailedV2";
        setState((current) => ({
          ...current,
          [errorKey]: t(messageKey, { error: errorText(error) }),
        }));
        return false;
      }
    },
    [t],
  );

  const handleCreateLink = useCallback(async () => {
    if (
      state.mode === "generating" ||
      state.shareEncoding ||
      !state.wordSet ||
      !state.scene
    ) {
      return;
    }
    const shareRunId = ++shareGenerationRef.current;
    const isCurrent = () => shareRunId === shareGenerationRef.current;
    setState((current) => ({
      ...current,
      shareUrl: undefined,
      shareUrlV2: undefined,
      shareError: undefined,
      shareErrorV1: undefined,
      shareErrorV2: undefined,
      shareEncoding: true,
    }));
    setStatus(t("creatingLinks"));

    let v1Created = false;
    let v2Created = false;
    try {
      const snapshot = createSnapshot(
        state.wordSet,
        state.presentation,
        state.scene,
      );
      v1Created = await createShareLink(
        "v1",
        snapshot,
        isCurrent,
        encodeJsonFragment,
      );
      if (!isCurrent()) return;
      v2Created = await createShareLink("v2", snapshot, isCurrent, (value) => {
        const client = clientRef.current;
        if (!client) throw new Error(t("v2WorkerUnavailable"));
        return client.encodeShare(value);
      });
    } catch (error) {
      if (!isCurrent()) return;
      const message = errorText(error);
      setState((current) => ({
        ...current,
        shareErrorV1: t("linkFailedV1", { error: message }),
        shareErrorV2: t("linkFailedV2", { error: message }),
      }));
    } finally {
      if (isCurrent()) {
        setState((current) => ({ ...current, shareEncoding: false }));
        setStatus(t(shareLinkCreationStatusKey(v1Created, v2Created)));
      }
    }
  }, [
    createShareLink,
    state.mode,
    state.presentation,
    state.scene,
    state.shareEncoding,
    state.wordSet,
    t,
  ]);

  const handleCopy = useCallback(
    async (target: "v1" | "v2" | { url: string } = "v1") => {
      const shareUrl =
        typeof target === "string"
          ? target === "v1"
            ? state.shareUrl
            : state.shareUrlV2
          : target.url;
      if (!shareUrl) return;
      try {
        if (!navigator.clipboard?.writeText) {
          setStatus(t("copyUnavailable"));
          return;
        }
        await navigator.clipboard.writeText(shareUrl);
        const statusKey =
          target === "v1"
            ? "linkCopiedV1"
            : target === "v2"
              ? "linkCopiedV2"
              : "linkCopied";
        setStatus(t(statusKey));
      } catch {
        setStatus(t("copyUnavailable"));
      }
    },
    [state.shareUrl, state.shareUrlV2, t],
  );

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
  const focusWord = useCallback((term: string | undefined) => {
    setHighlightedTerm(term);
  }, []);
  const handleAdjustShapeSize = useCallback(() => {
    if (activeStep === "style") {
      window.requestAnimationFrame(() =>
        document.getElementById("shape-size")?.focus(),
      );
      return;
    }
    setFocusShapeSizeAfterNavigation(true);
    navigateToStep("style");
  }, [activeStep, navigateToStep]);
  const handleRemoveShape = useCallback(() => {
    handlePresentationChange({ ...state.presentation, shape: undefined });
  }, [handlePresentationChange, state.presentation]);

  useEffect(() => {
    if (!focusShapeSizeAfterNavigation || activeStep !== "style") return;
    const frame = window.requestAnimationFrame(() => {
      const control = document.getElementById("shape-size");
      if (!control) return;
      control.focus();
      setFocusShapeSizeAfterNavigation(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeStep, focusShapeSizeAfterNavigation]);

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
      ? t("diagnosticSourceLimit", {
          actual: new TextEncoder().encode(state.sourceText).byteLength,
          limit: LIMITS.maxSourceBytes,
        })
      : undefined;
  const hasSharedFragment =
    typeof window !== "undefined" &&
    snapshotFormatFromFragment(window.location.hash) !== undefined;
  const maxWordsNotice = useMemo(() => {
    if (!state.tokenization || !state.wordSet) return undefined;
    const uniqueTerms = countUniqueTerms(
      state.tokenization.tokens,
      state.settings,
    );
    const omitted = uniqueTerms - LIMITS.maxWordsPerCloud;
    if (omitted <= 0) return undefined;
    return t("maxWordsPerCloudNotice", {
      uniqueTerms,
      kept: LIMITS.maxWordsPerCloud,
      omitted,
    });
  }, [state.settings, state.tokenization, state.wordSet, t]);
  const sharedImageFormat =
    typeof window !== "undefined"
      ? sharedImageFormatForPath(window.location.pathname)
      : undefined;
  const sharedImageError =
    state.mode === "error"
      ? (state.error ?? t("snapshotInvalid"))
      : hasSharedFragment
        ? undefined
        : t("snapshotInvalid");
  const sharedImageUrls = useMemo(() => {
    const baseShareUrl = state.shareUrl ?? state.shareUrlV2;
    if (!baseShareUrl) return undefined;
    const fragment = new URL(baseShareUrl).hash;
    const origin = window.location.origin;
    return {
      png: buildShareUrl(`${origin}${SHARE_PNG_PATH}`, fragment),
      svg: buildShareUrl(`${origin}${SHARE_SVG_PATH}`, fragment),
    };
  }, [state.shareUrl, state.shareUrlV2]);
  const sharedImageShareProps = {
    pngShareUrl: sharedImageUrls?.png,
    svgShareUrl: sharedImageUrls?.svg,
    onCopyPng: () => {
      if (sharedImageUrls?.png)
        void handleCopy({ url: sharedImageUrls.png });
    },
    onCopySvg: () => {
      if (sharedImageUrls?.svg)
        void handleCopy({ url: sharedImageUrls.svg });
    },
  };
  const isSharedView =
    typeof window !== "undefined" &&
    (isSharedViewPath(window.location.pathname) || hasSharedFragment);
  const wordIndex = (
    <WordTable
      wordSet={state.wordSet}
      scene={state.scene}
      onFocusWord={focusWord}
    />
  );

  if (sharedImageFormat) {
    return (
      <SharedImageRoute
        format={sharedImageFormat}
        scene={state.scene}
        error={sharedImageError}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            ✳
          </span>
          <div>
            <p className="brand-name">wordcloud.download</p>
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
      {!isSharedView && (
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
              <h1
                id={isSharedView ? "studio-page-title" : "wizard-page-title"}
                tabIndex={-1}
              >
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
              <output className="wizard-updating" aria-live="polite">
                {t("wizardUpdating")}
              </output>
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
                    captionAside={wordIndex}
                    hasSelectedShape={Boolean(state.presentation.shape)}
                    onAdjustShapeSize={handleAdjustShapeSize}
                    onRemoveShape={handleRemoveShape}
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
                  hasSelectedShape={Boolean(state.presentation.shape)}
                  onAdjustShapeSize={handleAdjustShapeSize}
                  onRemoveShape={handleRemoveShape}
                  captionAside={wordIndex}
                />
                <SharePanel
                  shareUrl={state.shareUrl}
                  shareUrlV2={state.shareUrlV2}
                  {...sharedImageShareProps}
                  shareError={state.shareError}
                  shareErrorV1={state.shareErrorV1}
                  shareErrorV2={state.shareErrorV2}
                  shareEncoding={state.shareEncoding}
                  wordLimitNotice={maxWordsNotice}
                  disabled={
                    !state.scene ||
                    state.mode === "generating" ||
                    state.shareEncoding
                  }
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
      )}
      {isSharedView && (
        <main className="wizard-main">
          <section
            className="wizard-page wizard-page--style"
            aria-labelledby="wizard-page-title"
            aria-busy={state.mode === "generating"}
          >
            <header className="wizard-page-heading">
              <p className="section-kicker">{t("previewHeading")}</p>
              <h1 id="wizard-page-title" tabIndex={-1}>
                {state.mode === "error" || !hasSharedFragment
                  ? t("snapshotInvalid")
                  : t("wizardPageStyleTitle")}
              </h1>
              <p>{t("wizardPageStyleDescription")}</p>
            </header>
            {state.scene && state.mode !== "error" && (
              <div className="wizard-form">
                <div className="wizard-style-layout">
                  <StylePanel
                    presentation={state.presentation}
                    disabled={state.mode === "generating"}
                    onChange={handlePresentationChange}
                  />
                  <CloudPreview
                    scene={state.scene}
                    highlightedTerm={highlightedTerm}
                    hasSelectedShape={Boolean(state.presentation.shape)}
                    onAdjustShapeSize={handleAdjustShapeSize}
                    onRemoveShape={handleRemoveShape}
                  />
                </div>
                <SharePanel
                  shareUrl={state.shareUrl}
                  shareUrlV2={state.shareUrlV2}
                  {...sharedImageShareProps}
                  shareError={state.shareError}
                  shareErrorV1={state.shareErrorV1}
                  shareErrorV2={state.shareErrorV2}
                  shareEncoding={state.shareEncoding}
                  wordLimitNotice={maxWordsNotice}
                  disabled={
                    !state.scene ||
                    state.mode === "generating" ||
                    state.shareEncoding
                  }
                  onCreateLink={handleCreateLink}
                  onCopy={handleCopy}
                  onDownload={handleDownload}
                  onExportSvg={handleExportSvg}
                  onExportPng={handleExportPng}
                  exporting={exporting}
                  onImport={handleImport}
                  onNewSource={handleNewSource}
                />
              </div>
            )}
            {!state.scene && hasSharedFragment && state.mode !== "error" && (
              <output className="wizard-updating" aria-live="polite">
                {t("wizardUpdating")}
              </output>
            )}
            {(state.mode === "error" || !hasSharedFragment) && (
              <div className="wizard-error" role="alert">
                <strong>{t("attention")}</strong>
                <p>{state.error ?? t("snapshotInvalid")}</p>
                <button
                  className="button button-primary"
                  type="button"
                  onClick={handleNewSource}
                >
                  {t("newCloud")}
                </button>
              </div>
            )}
          </section>
        </main>
      )}
      <footer className="site-footer">
        <span className="site-footer-brand">wordcloud.download</span>
        <span className="site-footer-description">{t("brandSubtitle")}</span>
        <span className="site-footer-copyright">
          © {new Date().getFullYear()}
        </span>
      </footer>
    </div>
  );
}
