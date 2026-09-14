import { LIMITS, scalarLength } from "./limits";
import type { RuleTrace, Token, TokenRule, TokenizerDiagnostic } from "./types";

interface ProtectedSpan {
  ruleId: string;
  phrase: string;
  priority: number;
  order: number;
  start: number;
  end: number;
}

interface CompiledPattern {
  rule: Extract<TokenRule, { kind: "split" | "merge" }>;
  input: string[];
  output: string[];
  priority: number;
  order: number;
}

export interface CompiledTokenRules {
  protectedRules: Extract<TokenRule, { kind: "protected" }>[];
  patterns: CompiledPattern[];
  diagnostics: TokenizerDiagnostic[];
}

function normalizeLiteral(value: string): string {
  return value.normalize("NFKC");
}

function rulePriority(rule: TokenRule): number {
  return rule.priority ?? 0;
}

function ruleSource(rule: TokenRule): string {
  return rule.kind === "protected" ? rule.phrase : rule.source;
}

function ruleOutput(rule: TokenRule): string[] {
  return rule.kind === "protected"
    ? [rule.phrase]
    : rule.kind === "split"
      ? rule.terms
      : [rule.term];
}

function findCycle(edges: Map<string, Set<string>>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of edges.get(node) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };

  return [...edges.keys()].some(visit);
}

export function validateTokenRules(rules: TokenRule[]): TokenizerDiagnostic[] {
  const diagnostics: TokenizerDiagnostic[] = [];

  if (rules.length > LIMITS.maxCustomRules) {
    diagnostics.push({
      code: "RULE_LIMIT",
      message: `最多只能設定 ${LIMITS.maxCustomRules} 條自訂規則。`,
    });
  }

  const edges = new Map<string, Set<string>>();
  rules.forEach((rule) => {
    const source = ruleSource(rule);
    const outputs = ruleOutput(rule);
    if (
      !rule.id.trim() ||
      !source.trim() ||
      scalarLength(source) > LIMITS.maxLiteralScalars
    ) {
      diagnostics.push({
        code: "RULE_INVALID",
        message: `規則 ${rule.id || "未命名"} 的來源必須是非空且不超過 ${LIMITS.maxLiteralScalars} 個 Unicode 字元的 literal。`,
      });
    }
    if (
      outputs.some(
        (output) =>
          !output.trim() || scalarLength(output) > LIMITS.maxLiteralScalars,
      )
    ) {
      diagnostics.push({
        code: "RULE_INVALID",
        message: `規則 ${rule.id || "未命名"} 的輸出必須是非空且受長度限制的 literal。`,
      });
    }
    if (rule.kind === "split" && rule.terms.length === 0) {
      diagnostics.push({
        code: "RULE_INVALID",
        message: `拆分規則 ${rule.id} 至少需要一個輸出詞。`,
      });
    }

    if (rule.kind !== "protected") {
      const sourceKey = normalizeLiteral(source).toLocaleLowerCase();
      const targets = edges.get(sourceKey) ?? new Set<string>();
      for (const output of outputs) {
        targets.add(normalizeLiteral(output).toLocaleLowerCase());
      }
      edges.set(sourceKey, targets);
    }
  });

  if (findCycle(edges)) {
    diagnostics.push({
      code: "RULE_CYCLE",
      message: "拆分與合併規則形成循環，請移除其中一條規則。",
    });
  }

  return diagnostics;
}

export function compileTokenRules(
  rules: TokenRule[],
  segmentLiteral: (value: string) => string[],
): CompiledTokenRules {
  const diagnostics = validateTokenRules(rules);
  const protectedRules = rules.filter(
    (rule): rule is Extract<TokenRule, { kind: "protected" }> =>
      rule.kind === "protected",
  );
  const patterns = rules.flatMap((rule, order) => {
    if (rule.kind === "protected") return [];
    const input = segmentLiteral(rule.source).map(normalizeLiteral);
    if (input.length === 0) return [];
    return [
      {
        rule,
        input,
        output: ruleOutput(rule).map(normalizeLiteral),
        priority: rulePriority(rule),
        order,
      },
    ];
  });

  return { protectedRules, patterns, diagnostics };
}

export function findProtectedSpans(
  source: string,
  rules: Extract<TokenRule, { kind: "protected" }>[],
): { spans: ProtectedSpan[]; traces: RuleTrace[] } {
  const candidates: ProtectedSpan[] = [];
  const traces: RuleTrace[] = [];

  rules.forEach((rule, order) => {
    let start = source.indexOf(rule.phrase);
    while (start >= 0) {
      candidates.push({
        ruleId: rule.id,
        phrase: rule.phrase,
        priority: rulePriority(rule),
        order,
        start,
        end: start + rule.phrase.length,
      });
      start = source.indexOf(rule.phrase, start + 1);
    }
  });

  candidates.sort(
    (a, b) =>
      b.priority - a.priority ||
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start ||
      a.order - b.order,
  );

  const selected: ProtectedSpan[] = [];
  for (const candidate of candidates) {
    const overlaps = selected.some(
      (span) => candidate.start < span.end && candidate.end > span.start,
    );
    if (overlaps) {
      traces.push({
        ruleId: candidate.ruleId,
        kind: "protected",
        status: "shadowed",
        sourceStart: candidate.start,
        sourceEnd: candidate.end,
        message: "此 literal 與優先順序較高的 protected rule 重疊。",
      });
      continue;
    }
    selected.push(candidate);
    traces.push({
      ruleId: candidate.ruleId,
      kind: "protected",
      status: "applied",
      sourceStart: candidate.start,
      sourceEnd: candidate.end,
    });
  }

  selected.sort((a, b) => a.start - b.start);
  return { spans: selected, traces };
}

function sameTerms(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((term, index) => term === right[index])
  );
}

export function applyTokenRules(
  tokens: Token[],
  compiled: CompiledTokenRules,
): { tokens: Token[]; traces: RuleTrace[] } {
  const output: Token[] = [];
  const traces: RuleTrace[] = [];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token.ruleKind === "protected") {
      output.push(token);
      index += 1;
      continue;
    }

    const candidates = compiled.patterns.filter((pattern) =>
      sameTerms(
        tokens
          .slice(index, index + pattern.input.length)
          .map((item) => normalizeLiteral(item.term)),
        pattern.input,
      ),
    );
    const pattern = candidates.sort(
      (a, b) =>
        b.priority - a.priority ||
        b.input.length - a.input.length ||
        a.order - b.order,
    )[0];

    if (!pattern) {
      output.push(token);
      index += 1;
      continue;
    }

    const source = tokens.slice(index, index + pattern.input.length);
    for (const term of pattern.output) {
      output.push({
        term,
        locale: source[0]?.locale ?? "und",
        sourceIndex: source[0]?.sourceIndex ?? token.sourceIndex,
        sourceStart: source[0]?.sourceStart,
        sourceEnd: source.at(-1)?.sourceEnd,
        ruleId: pattern.rule.id,
        ruleKind: pattern.rule.kind,
      });
    }
    traces.push({
      ruleId: pattern.rule.id,
      kind: pattern.rule.kind,
      status: "applied",
    });
    index += pattern.input.length;
  }

  return { tokens: output, traces };
}
