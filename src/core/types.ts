export type CaseMode = "preserve" | "lower" | "upper";
export type NumberPolicy = "exclude" | "include";
export type SymbolPolicy = "exclude" | "include";

export interface ProtectedRule {
  id: string;
  kind: "protected";
  phrase: string;
  priority?: number;
}

export interface SplitRule {
  id: string;
  kind: "split";
  source: string;
  terms: string[];
  priority?: number;
}

export interface MergeRule {
  id: string;
  kind: "merge";
  source: string;
  term: string;
  priority?: number;
}

export type TokenRule = ProtectedRule | SplitRule | MergeRule;

export interface TokenizerSettings {
  locale: string;
  caseMode: CaseMode;
  caseInsensitive: boolean;
  stopWords: string[];
  numberPolicy: NumberPolicy;
  symbolPolicy: SymbolPolicy;
  dictionary: string[];
  rules: TokenRule[];
  tokenizerVersion?: string;
}

export interface Token {
  term: string;
  locale: string;
  sourceIndex: number;
  sourceStart?: number;
  sourceEnd?: number;
  ruleId?: string;
  ruleKind?: TokenRule["kind"];
}

export type FilterReason =
  | "stop-word"
  | "number"
  | "symbol"
  | "empty"
  | "term-too-long";

export interface FilteredToken {
  term: string;
  sourceIndex: number;
  reason: FilterReason;
}

export interface RuleTrace {
  ruleId: string;
  kind: TokenRule["kind"];
  status: "applied" | "shadowed" | "rejected";
  sourceStart?: number;
  sourceEnd?: number;
  message?: string;
}

export interface TokenizerCapabilities {
  selectedLocale: string;
  supported: boolean;
  capabilityVersion: string;
  fixedLocales: string[];
}

export interface TokenizerDiagnostic {
  code:
    | "SOURCE_LIMIT"
    | "RULE_LIMIT"
    | "RULE_INVALID"
    | "RULE_CYCLE"
    | "UNSUPPORTED_LOCALE"
    | "SEGMENTER_UNAVAILABLE"
    | "TOKEN_LIMIT"
    | "UNIQUE_TERM_LIMIT"
    | "TERM_LIMIT"
    | "EMPTY_INPUT"
    | "NO_WORDS";
  message: string;
}

export interface TokenizationResult {
  status: "ok" | "empty" | "error";
  tokenizerVersion: string;
  tokens: Token[];
  filtered: FilteredToken[];
  traces: RuleTrace[];
  diagnostics: TokenizerDiagnostic[];
  capabilities: TokenizerCapabilities;
}

export interface Word {
  term: string;
  count: number;
  firstSeen: number;
  rank: number;
  locale: string;
}

export interface WordSet {
  words: Word[];
  totalTokens: number;
  tokenizerVersion: string;
  locale: string;
}
