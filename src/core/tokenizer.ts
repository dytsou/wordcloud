import {
  LIMITS,
  hasLetterOrNumber,
  isNumberOnly,
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
  stopWords: [],
  numberPolicy: "exclude",
  symbolPolicy: "exclude",
  dictionary: [],
  rules: [],
  tokenizerVersion: TOKENIZER_VERSION,
};

const FIXED_LOCALES = ["en", "zh-Hant", "zh-Hans", "ja", "th"] as const;
const SIMPLIFIED_MARKERS = new Set(
  "们这個个学习国发发现数据云网与为说".split(""),
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

function capability(
  selectedLocale: string,
  supported: boolean,
): TokenizerCapabilities {
  return {
    selectedLocale,
    supported,
    capabilityVersion: ICU_CAPABILITY_VERSION,
    fixedLocales: [...FIXED_LOCALES],
  };
}

function diagnostic(
  code: TokenizerDiagnostic["code"],
  message: string,
): TokenizerDiagnostic {
  return { code, message };
}

function classifyCharacter(character: string): Lane {
  if (/\p{Script=Thai}/u.test(character)) return "thai";
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character))
    return "japanese";
  if (/\p{Script=Han}/u.test(character)) return "han";
  if (/\p{Script=Latin}/u.test(character)) return "latin";
  return "other";
}

function localeForSegment(segment: string, selectedLocale: string): string {
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
    return [...segment].some((character) => SIMPLIFIED_MARKERS.has(character))
      ? "zh-Hans"
      : "zh-Hant";
  }
  return selectedLocale;
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
  tokens: Token[],
): void {
  if (!source) return;
  const locale = localeForSegment(source, selectedLocale);
  const segmenter = createSegmenter(locale) ?? createSegmenter(selectedLocale);
  if (!segmenter) return;
  for (const part of segmenter.segment(source) as Iterable<SegmenterSegment>) {
    if (!part.isWordLike) continue;
    const start = sourceOffset + part.index;
    tokens.push({
      term: part.segment,
      locale,
      sourceIndex: tokens.length,
      sourceStart: start,
      sourceEnd: start + part.segment.length,
    });
  }
}

function addProtectedAndUnprotectedTokens(
  source: string,
  selectedLocale: string,
  protectedSpans: ReturnType<typeof findProtectedSpans>["spans"],
): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  for (const span of protectedSpans) {
    appendSegmentedTokens(
      source.slice(cursor, span.start),
      cursor,
      selectedLocale,
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
  appendSegmentedTokens(source.slice(cursor), cursor, selectedLocale, tokens);
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

function normalizedStopWords(settings: TokenizerSettings): Set<string> {
  return new Set(
    settings.stopWords.map((word) => normalizeTerm(word, settings.caseMode)),
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

export function tokenize(
  source: string,
  inputSettings: TokenizerSettings = DEFAULT_TOKENIZER_SETTINGS,
): TokenizationResult {
  const settings = { ...DEFAULT_TOKENIZER_SETTINGS, ...inputSettings };
  const tokenizerVersion = settings.tokenizerVersion ?? TOKENIZER_VERSION;
  const supported = supportsLocale(settings.locale);
  const capabilities = capability(settings.locale, supported);
  const emptyResult = (
    status: TokenizationResult["status"],
    diagnostics: TokenizerDiagnostic[],
  ): TokenizationResult => ({
    status,
    tokenizerVersion,
    tokens: [],
    filtered: [],
    traces: [],
    diagnostics,
    capabilities,
  });

  if (utf8ByteLength(source) > LIMITS.maxSourceBytes) {
    return emptyResult("error", [
      diagnostic(
        "SOURCE_LIMIT",
        `原文超過 ${LIMITS.maxSourceBytes} bytes 上限。`,
      ),
    ]);
  }
  if (!source.trim()) {
    return emptyResult("empty", [diagnostic("EMPTY_INPUT", "請先輸入文字。")]);
  }
  if (typeof Intl.Segmenter !== "function") {
    return emptyResult("error", [
      diagnostic("SEGMENTER_UNAVAILABLE", "此瀏覽器不支援 Intl.Segmenter。"),
    ]);
  }
  if (!supported) {
    return emptyResult("error", [
      diagnostic(
        "UNSUPPORTED_LOCALE",
        `瀏覽器不支援 ${settings.locale} 的分詞能力，請改選其他 locale。`,
      ),
    ]);
  }

  const rules = withDictionary(settings);
  const compiled = compileTokenRules(rules, (value) =>
    segmentLiteral(value, settings.locale),
  );
  if (compiled.diagnostics.length > 0) {
    return emptyResult("error", compiled.diagnostics);
  }

  const protectedResult = findProtectedSpans(source, compiled.protectedRules);
  const rawTokens = addProtectedAndUnprotectedTokens(
    source,
    settings.locale,
    protectedResult.spans,
  );
  if (rawTokens.length > LIMITS.maxCandidateTokens) {
    return emptyResult("error", [
      diagnostic(
        "TOKEN_LIMIT",
        `候選詞超過 ${LIMITS.maxCandidateTokens} 個上限。`,
      ),
    ]);
  }

  const applied = applyTokenRules(rawTokens, compiled);
  if (applied.tokens.length > LIMITS.maxCandidateTokens) {
    return emptyResult("error", [
      diagnostic(
        "TOKEN_LIMIT",
        `套用規則後候選詞超過 ${LIMITS.maxCandidateTokens} 個上限。`,
      ),
    ]);
  }

  const stopWords = normalizedStopWords(settings);
  const tokens: Token[] = [];
  const filtered: TokenizationResult["filtered"] = [];
  for (const token of applied.tokens) {
    const term = normalizeTerm(token.term, settings.caseMode);
    let reason: TokenizationResult["filtered"][number]["reason"] | undefined;
    if (!term) reason = "empty";
    else if (scalarLength(term) > LIMITS.maxLiteralScalars)
      reason = "term-too-long";
    else if (stopWords.has(term)) reason = "stop-word";
    else if (settings.numberPolicy === "exclude" && isNumberOnly(term))
      reason = "number";
    else if (settings.symbolPolicy === "exclude" && !hasLetterOrNumber(term))
      reason = "symbol";

    if (reason) {
      filtered.push({ term, sourceIndex: token.sourceIndex, reason });
      continue;
    }
    tokens.push({ ...token, term, sourceIndex: token.sourceIndex });
  }

  if (tokens.length === 0) {
    return {
      status: "empty",
      tokenizerVersion,
      tokens,
      filtered,
      traces: [...protectedResult.traces, ...applied.traces],
      diagnostics: [
        diagnostic(
          "NO_WORDS",
          "目前設定沒有可繪製的詞語，請調整原文或篩選規則。",
        ),
      ],
      capabilities,
    };
  }

  if (new Set(tokens.map((token) => token.term)).size > LIMITS.maxUniqueTerms) {
    return emptyResult("error", [
      diagnostic(
        "UNIQUE_TERM_LIMIT",
        `唯一詞語超過 ${LIMITS.maxUniqueTerms} 個上限。`,
      ),
    ]);
  }

  return {
    status: "ok",
    tokenizerVersion,
    tokens,
    filtered,
    traces: [...protectedResult.traces, ...applied.traces],
    diagnostics: [],
    capabilities,
  };
}
