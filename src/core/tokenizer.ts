import {
  hasLetterOrNumber,
  isNumberOnly,
  LIMITS,
  scalarLength,
  utf8ByteLength,
} from "./limits";
import {
  applyTokenRules,
  compileTokenRules,
  findProtectedSpans,
} from "./token-rules";
import type {
  Token,
  TokenizationResult,
  TokenizerCapabilities,
  TokenizerDiagnostic,
  TokenizerSettings,
  TokenRule,
} from "./types";

export const TOKENIZER_VERSION = "wc-tokenizer-v1";
export const ICU_CAPABILITY_VERSION = "intl-segmenter-runtime-v1";

export const DEFAULT_TOKENIZER_SETTINGS: TokenizerSettings = {
  locale: "zh-Hant",
  caseMode: "preserve",
  caseInsensitive: false,
  stopWords: [],
  numberPolicy: "exclude",
  symbolPolicy: "exclude",
  dictionary: [],
  rules: [],
  tokenizerVersion: TOKENIZER_VERSION,
};

/**
 * Common Intl.Segmenter locales exposed by the editor and MCP API.
 *
 * Intl.Segmenter may support more locales than this curated list on a given
 * runtime. The list stays explicit so snapshots and the API schema remain
 * deterministic, while getSupportedTokenizerLocales filters it at runtime.
 */
export const FIXED_LOCALES = [
  "en",
  "zh-Hant",
  "zh-Hans",
  "ja",
  "ko",
  "th",
  "vi",
  "id",
  "ms",
  "fr",
  "de",
  "es",
  "it",
  "pt",
  "ru",
  "uk",
  "pl",
  "nl",
  "tr",
  "ar",
  "he",
  "hi",
  "bn",
  "fa",
  "ur",
  "sv",
  "da",
  "nb",
  "fi",
  "no",
  "cs",
  "sk",
  "ro",
  "bg",
  "el",
  "hu",
  "ca",
  "hr",
  "sl",
  "sr",
  "et",
  "lv",
  "lt",
  "sw",
] as const;
const SIMPLIFIED_MARKERS = new Set(
  "们这个学习国发发现数据云网与为说".split(""),
);

type Lane = "latin" | "han" | "japanese" | "thai" | "other";

interface SegmenterSegment {
  segment: string;
  index: number;
  isWordLike?: boolean;
}

function supportsLocale(locale: string): boolean {
  if (typeof Intl.Segmenter !== "function") return false;
  try {
    return Intl.Segmenter.supportedLocalesOf([locale]).length > 0;
  } catch {
    return false;
  }
}

function localeProfile(locale: string): {
  language: string;
  script?: string;
} | null {
  if (typeof Intl.Locale !== "function") return null;
  try {
    const parsed = new Intl.Locale(locale).maximize();
    return { language: parsed.language, script: parsed.script };
  } catch {
    return null;
  }
}

export function getSupportedTokenizerLocales(): string[] {
  if (typeof Intl.Segmenter !== "function") return [];
  try {
    return Intl.Segmenter.supportedLocalesOf(FIXED_LOCALES);
  } catch {
    return [];
  }
}

/**
 * Pick the closest curated segmentation locale from the browser preference.
 * Regional tags such as zh-TW are mapped to the matching script variant so
 * the value stays stable in snapshots and in the locale selector.
 */
export function detectBrowserTokenizerLocale(): string {
  const available = getSupportedTokenizerLocales();
  const fallback = available.includes(DEFAULT_TOKENIZER_SETTINGS.locale)
    ? DEFAULT_TOKENIZER_SETTINGS.locale
    : (available[0] ?? DEFAULT_TOKENIZER_SETTINGS.locale);
  if (typeof navigator === "undefined") return fallback;

  const candidates = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
  ].filter((locale): locale is string => Boolean(locale));

  for (const candidate of candidates) {
    const profile = localeProfile(candidate);
    if (!profile) continue;
    const match = FIXED_LOCALES.find((locale) => {
      if (!available.includes(locale)) return false;
      const optionProfile = localeProfile(locale);
      if (optionProfile?.language !== profile.language) return false;
      return !optionProfile.script || !profile.script
        ? true
        : optionProfile.script === profile.script;
    });
    if (match) return match;
  }

  return fallback;
}

function capability(
  selectedLocale: string,
  supported: boolean,
): TokenizerCapabilities {
  return {
    selectedLocale,
    supported,
    capabilityVersion: ICU_CAPABILITY_VERSION,
    fixedLocales: getSupportedTokenizerLocales(),
  };
}

function diagnostic(
  code: TokenizerDiagnostic["code"],
  message: string,
  details: Pick<
    TokenizerDiagnostic,
    "actual" | "actualIsMinimum" | "limit"
  > = {},
): TokenizerDiagnostic {
  return { code, message, ...details };
}

function classifyCharacter(character: string): Lane {
  if (character === "ー") return "japanese";
  if (/\p{Script=Thai}/u.test(character)) return "thai";
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character))
    return "japanese";
  if (/\p{Script=Han}/u.test(character)) return "han";
  if (/\p{Script=Latin}/u.test(character)) return "latin";
  return "other";
}

function localeForSegment(segment: string, selectedLocale: string): string {
  if (
    [...segment].some((character) =>
      /\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character),
    )
  ) {
    return "ja";
  }
  const lanes = new Set<Lane>();
  for (const character of segment) {
    const lane = classifyCharacter(character);
    if (lane !== "other") lanes.add(lane);
  }

  if (lanes.size !== 1) return selectedLocale;
  const lane = [...lanes][0];
  if (lane === "latin") return "en";
  if (lane === "thai") return "th";
  if (lane === "japanese") return "ja";
  if (lane === "han") {
    if (selectedLocale === "ja") return "ja";
    return [...segment].some((character) => SIMPLIFIED_MARKERS.has(character))
      ? "zh-Hans"
      : "zh-Hant";
  }
  return selectedLocale;
}

function mergeLanes(left: Lane, right: Lane): Lane | undefined {
  if (left === right) return left;
  if (left === "other") return right;
  if (right === "other") return left;
  if (
    (left === "han" && right === "japanese") ||
    (left === "japanese" && right === "han")
  ) {
    return "japanese";
  }
  return undefined;
}

interface SourceRun {
  start: number;
  end: number;
  lane: Lane;
}

function characterLane(character: string, runLane: Lane | undefined): Lane {
  const lane = classifyCharacter(character);
  if (
    /\p{Mark}/u.test(character) &&
    runLane !== undefined &&
    runLane !== "other"
  ) {
    return runLane;
  }
  return lane;
}

function splitsAtNeutralGap(
  lane: Lane,
  runLane: Lane,
  neutralGap: boolean,
): boolean {
  return (
    lane !== "other" && neutralGap && (runLane !== lane || runLane === "han")
  );
}

function appendSourceRun(
  runs: SourceRun[],
  start: number,
  end: number,
  lane: Lane | undefined,
): void {
  if (lane !== undefined) runs.push({ start, end, lane });
}

function sourceRuns(source: string): SourceRun[] {
  const runs: SourceRun[] = [];
  let runStart = 0;
  let runLane: Lane | undefined;
  let neutralGap = false;
  let offset = 0;

  for (const character of source) {
    const characterStart = offset;
    offset += character.length;
    const lane = characterLane(character, runLane);

    if (runLane === undefined) {
      runStart = characterStart;
      runLane = lane;
      continue;
    }

    if (splitsAtNeutralGap(lane, runLane, neutralGap)) {
      appendSourceRun(runs, runStart, characterStart, runLane);
      runStart = characterStart;
      runLane = lane;
      neutralGap = false;
      continue;
    }

    const merged = mergeLanes(runLane, lane);
    if (merged === undefined) {
      appendSourceRun(runs, runStart, characterStart, runLane);
      runStart = characterStart;
      runLane = lane;
      neutralGap = false;
    } else {
      runLane = merged;
      if (lane === "other" && runLane !== "other") neutralGap = true;
    }
  }

  appendSourceRun(runs, runStart, offset, runLane);
  return runs;
}

function createSegmenter(locale: string): Intl.Segmenter | null {
  if (!supportsLocale(locale)) return null;
  return new Intl.Segmenter(locale, { granularity: "word" });
}

function segmentLiteral(value: string, locale: string): string[] {
  const segmenter = createSegmenter(locale);
  if (!segmenter) return [];
  return [...segmenter.segment(value)]
    .filter((part: SegmenterSegment) => part.isWordLike)
    .map((part: SegmenterSegment) => part.segment);
}

function appendSegmentedTokens(
  source: string,
  sourceOffset: number,
  selectedLocale: string,
  symbolPolicy: TokenizerSettings["symbolPolicy"],
  tokens: Token[],
): void {
  if (!source) return;
  const segmenters = new Map<string, Intl.Segmenter>();
  for (const run of sourceRuns(source)) {
    const value = source.slice(run.start, run.end);
    const locale = localeForSegment(value, selectedLocale);
    const segmenter =
      segmenters.get(locale) ??
      createSegmenter(locale) ??
      createSegmenter(selectedLocale);
    if (!segmenter) continue;
    segmenters.set(locale, segmenter);
    for (const part of segmenter.segment(value) as Iterable<SegmenterSegment>) {
      if (!part.segment.trim()) continue;
      if (!part.isWordLike && symbolPolicy === "exclude") continue;
      const start = sourceOffset + run.start + part.index;
      tokens.push({
        term: part.segment,
        locale,
        sourceIndex: tokens.length,
        sourceStart: start,
        sourceEnd: start + part.segment.length,
      });
    }
  }
}

function addProtectedAndUnprotectedTokens(
  source: string,
  selectedLocale: string,
  symbolPolicy: TokenizerSettings["symbolPolicy"],
  protectedSpans: ReturnType<typeof findProtectedSpans>["spans"],
): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  for (const span of protectedSpans) {
    appendSegmentedTokens(
      source.slice(cursor, span.start),
      cursor,
      selectedLocale,
      symbolPolicy,
      tokens,
    );
    tokens.push({
      term: span.phrase,
      locale: localeForSegment(span.phrase, selectedLocale),
      sourceIndex: tokens.length,
      sourceStart: span.start,
      sourceEnd: span.end,
      ruleId: span.ruleId,
      ruleKind: "protected",
    });
    cursor = span.end;
  }
  appendSegmentedTokens(
    source.slice(cursor),
    cursor,
    selectedLocale,
    symbolPolicy,
    tokens,
  );
  return tokens;
}

function normalizeTerm(
  term: string,
  caseMode: TokenizerSettings["caseMode"],
): string {
  const normalized = term.normalize("NFKC").trim();
  if (caseMode === "lower") return normalized.toLocaleLowerCase();
  if (caseMode === "upper") return normalized.toLocaleUpperCase();
  return normalized;
}

type ComparisonNormalizer = (term: string) => string;

function comparisonNormalizer(
  settings: Pick<TokenizerSettings, "caseInsensitive">,
): ComparisonNormalizer {
  if (settings.caseInsensitive) return (term) => term.toLocaleLowerCase();
  return (term) => term;
}

function normalizedStopWords(settings: TokenizerSettings): Set<string> {
  const normalizeComparison = comparisonNormalizer(settings);
  return new Set(
    settings.stopWords.map((word) =>
      normalizeComparison(normalizeTerm(word, settings.caseMode)),
    ),
  );
}

function withDictionary(settings: TokenizerSettings): TokenRule[] {
  const dictionaryRules: TokenRule[] = settings.dictionary.map(
    (phrase, index) => ({
      id: `dictionary-${index + 1}`,
      kind: "protected" as const,
      phrase,
      priority: -100,
    }),
  );
  return [...settings.rules, ...dictionaryRules];
}

interface TokenizationContext {
  settings: TokenizerSettings;
  tokenizerVersion: string;
  capabilities: TokenizationResult["capabilities"];
}

function emptyTokenizationResult(
  context: TokenizationContext,
  status: TokenizationResult["status"],
  diagnostics: TokenizerDiagnostic[],
): TokenizationResult {
  return {
    status,
    tokenizerVersion: context.tokenizerVersion,
    tokens: [],
    filtered: [],
    traces: [],
    diagnostics,
    capabilities: context.capabilities,
  };
}

function validateTokenizerInput(
  source: string,
  context: TokenizationContext,
): TokenizationResult | undefined {
  const sourceBytes = utf8ByteLength(source);
  if (sourceBytes > LIMITS.maxSourceBytes) {
    return emptyTokenizationResult(context, "error", [
      diagnostic(
        "SOURCE_LIMIT",
        `Source text is ${sourceBytes} bytes; the limit is ${LIMITS.maxSourceBytes} bytes.`,
        { actual: sourceBytes, limit: LIMITS.maxSourceBytes },
      ),
    ]);
  }
  if (!source.trim()) {
    return emptyTokenizationResult(context, "empty", [
      diagnostic("EMPTY_INPUT", "Enter source text first."),
    ]);
  }
  if (typeof Intl.Segmenter !== "function") {
    return emptyTokenizationResult(context, "error", [
      diagnostic(
        "SEGMENTER_UNAVAILABLE",
        "This browser does not support Intl.Segmenter.",
      ),
    ]);
  }
  if (!context.capabilities.supported) {
    return emptyTokenizationResult(context, "error", [
      diagnostic(
        "UNSUPPORTED_LOCALE",
        `Unsupported locale ${context.settings.locale}. Choose another locale.`,
      ),
    ]);
  }
  return undefined;
}

function filteredReason(
  term: string,
  comparison: string,
  stopWords: Set<string>,
  settings: TokenizerSettings,
): TokenizationResult["filtered"][number]["reason"] | undefined {
  if (!term) return "empty";
  if (scalarLength(term) > LIMITS.maxLiteralScalars) return "term-too-long";
  if (stopWords.has(comparison)) return "stop-word";
  if (settings.numberPolicy === "exclude" && isNumberOnly(term))
    return "number";
  if (settings.symbolPolicy === "exclude" && !hasLetterOrNumber(term))
    return "symbol";
  return undefined;
}

function filterTokens(
  sourceTokens: Token[],
  settings: TokenizerSettings,
  stopWords: Set<string>,
  normalizeComparison: ComparisonNormalizer,
): Pick<TokenizationResult, "tokens" | "filtered"> {
  const tokens: Token[] = [];
  const filtered: TokenizationResult["filtered"] = [];
  for (const token of sourceTokens) {
    const term = normalizeTerm(token.term, settings.caseMode);
    const reason = filteredReason(
      term,
      normalizeComparison(term),
      stopWords,
      settings,
    );
    if (reason) {
      filtered.push({ term, sourceIndex: token.sourceIndex, reason });
      continue;
    }
    tokens.push({ ...token, term, sourceIndex: token.sourceIndex });
  }
  return { tokens, filtered };
}

export function tokenize(
  source: string,
  inputSettings: TokenizerSettings = DEFAULT_TOKENIZER_SETTINGS,
): TokenizationResult {
  const settings = { ...DEFAULT_TOKENIZER_SETTINGS, ...inputSettings };
  const supported = supportsLocale(settings.locale);
  const context: TokenizationContext = {
    settings,
    tokenizerVersion: settings.tokenizerVersion ?? TOKENIZER_VERSION,
    capabilities: capability(settings.locale, supported),
  };
  const inputError = validateTokenizerInput(source, context);
  if (inputError) return inputError;

  const rules = withDictionary(settings);
  const compiled = compileTokenRules(rules, (value) =>
    segmentLiteral(value, settings.locale),
  );
  if (compiled.diagnostics.length > 0) {
    return emptyTokenizationResult(context, "error", compiled.diagnostics);
  }

  const protectedResult = findProtectedSpans(source, compiled.protectedRules);
  if (protectedResult.exceededLimit) {
    return emptyTokenizationResult(context, "error", [
      diagnostic(
        "TOKEN_LIMIT",
        `Candidate tokens are at least ${LIMITS.maxCandidateTokens + 1}; the limit is ${LIMITS.maxCandidateTokens}.`,
        {
          actual: LIMITS.maxCandidateTokens + 1,
          actualIsMinimum: true,
          limit: LIMITS.maxCandidateTokens,
        },
      ),
    ]);
  }
  const rawTokens = addProtectedAndUnprotectedTokens(
    source,
    settings.locale,
    settings.symbolPolicy,
    protectedResult.spans,
  );
  if (rawTokens.length > LIMITS.maxCandidateTokens) {
    return emptyTokenizationResult(context, "error", [
      diagnostic(
        "TOKEN_LIMIT",
        `Candidate tokens are ${rawTokens.length}; the limit is ${LIMITS.maxCandidateTokens}.`,
        { actual: rawTokens.length, limit: LIMITS.maxCandidateTokens },
      ),
    ]);
  }

  const applied = applyTokenRules(rawTokens, compiled);
  if (applied.tokens.length > LIMITS.maxCandidateTokens) {
    return emptyTokenizationResult(context, "error", [
      diagnostic(
        "TOKEN_LIMIT",
        `Token rules produce ${applied.tokens.length} candidate tokens; the limit is ${LIMITS.maxCandidateTokens}.`,
        {
          actual: applied.tokens.length,
          limit: LIMITS.maxCandidateTokens,
        },
      ),
    ]);
  }

  const normalizeComparison = comparisonNormalizer(settings);
  const stopWords = normalizedStopWords(settings);
  const { tokens, filtered } = filterTokens(
    applied.tokens,
    settings,
    stopWords,
    normalizeComparison,
  );
  const traces = [...protectedResult.traces, ...applied.traces];
  if (tokens.length === 0) {
    return {
      status: "empty",
      tokenizerVersion: context.tokenizerVersion,
      tokens,
      filtered,
      traces,
      diagnostics: [
        diagnostic(
          "NO_WORDS",
          "No drawable terms remain. Adjust the source text or filters.",
        ),
      ],
      capabilities: context.capabilities,
    };
  }

  const uniqueTermCount = new Set(
    tokens.map((token) => normalizeComparison(token.term)),
  ).size;
  if (uniqueTermCount > LIMITS.maxUniqueTerms) {
    return emptyTokenizationResult(context, "error", [
      diagnostic(
        "UNIQUE_TERM_LIMIT",
        `There are ${uniqueTermCount} unique terms; the limit is ${LIMITS.maxUniqueTerms}.`,
        { actual: uniqueTermCount, limit: LIMITS.maxUniqueTerms },
      ),
    ]);
  }

  return {
    status: "ok",
    tokenizerVersion: context.tokenizerVersion,
    tokens,
    filtered,
    traces,
    diagnostics: [],
    capabilities: context.capabilities,
  };
}
