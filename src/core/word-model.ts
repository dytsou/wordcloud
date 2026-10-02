import { LIMITS } from "./limits";
import type { Token, Word, WordSet } from "./types";

export interface WordModelSettings {
  caseMode: "preserve" | "lower" | "upper";
  caseInsensitive: boolean;
  locale: string;
  tokenizerVersion: string;
}

function normalizeTerm(
  term: string,
  caseMode: WordModelSettings["caseMode"],
): string {
  const normalized = term.normalize("NFKC").trim();
  if (caseMode === "lower") return normalized.toLocaleLowerCase();
  if (caseMode === "upper") return normalized.toLocaleUpperCase();
  return normalized;
}

function compareUnicode(left: string, right: string): number {
  const leftScalars = [...left];
  const rightScalars = [...right];
  const length = Math.min(leftScalars.length, rightScalars.length);
  for (let index = 0; index < length; index += 1) {
    const difference =
      leftScalars[index].codePointAt(0)! - rightScalars[index].codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return leftScalars.length - rightScalars.length;
}

export function countUniqueTerms(
  tokens: Token[],
  settings: Pick<WordModelSettings, "caseMode" | "caseInsensitive">,
): number {
  const terms = new Set<string>();
  for (const token of tokens) {
    const term = normalizeTerm(token.term, settings.caseMode);
    if (!term) continue;
    terms.add(settings.caseInsensitive ? term.toLocaleLowerCase() : term);
  }
  return terms.size;
}

export function buildWordSet(
  tokens: Token[],
  settings: WordModelSettings,
): WordSet {
  const byTerm = new Map<string, Word>();
  for (const [index, token] of tokens.entries()) {
    const term = normalizeTerm(token.term, settings.caseMode);
    if (!term) continue;
    const key = settings.caseInsensitive ? term.toLocaleLowerCase() : term;
    const existing = byTerm.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    if (byTerm.size >= LIMITS.maxUniqueTerms) {
      throw new Error(
        `Unique terms are at least ${byTerm.size + 1}; the limit is ${LIMITS.maxUniqueTerms}.`,
      );
    }
    byTerm.set(key, {
      term,
      count: 1,
      firstSeen: token.sourceIndex ?? index,
      rank: 0,
      locale: token.locale,
    });
  }

  const words = [...byTerm.values()]
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.firstSeen - right.firstSeen ||
        compareUnicode(left.term, right.term),
    )
    .slice(0, LIMITS.maxWordsPerCloud);
  words.forEach((word, index) => {
    word.rank = index + 1;
  });

  return {
    words,
    totalTokens: tokens.length,
    tokenizerVersion: settings.tokenizerVersion,
    locale: settings.locale,
  };
}
