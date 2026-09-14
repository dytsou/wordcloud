import { describe, expect, it } from "vitest";
import { layoutWordCloud, type LayoutStyle } from "../../src/core/layout";
import { LIMITS } from "../../src/core/limits";
import { createFontMetricsTable } from "../../src/core/metrics";
import { DEFAULT_TOKENIZER_SETTINGS, tokenize } from "../../src/core/tokenizer";
import { buildWordSet } from "../../src/core/word-model";
import { uniqueLatinWords } from "../fixtures/multilingual-text";

describe("wordcloud safety budgets", () => {
  it("rejects source text above the UTF-8 budget before segmentation", () => {
    const result = tokenize("x".repeat(LIMITS.maxSourceBytes + 1), {
      ...DEFAULT_TOKENIZER_SETTINGS,
      locale: "en",
    });

    expect(result.status).toBe("error");
    expect(result.diagnostics[0]?.code).toBe("SOURCE_LIMIT");
    expect(result.tokens).toHaveLength(0);
  });

  it("rejects more unique terms than the bounded word model allows", () => {
    const result = tokenize(
      uniqueLatinWords(LIMITS.maxUniqueTerms + 1).join(" "),
      {
        ...DEFAULT_TOKENIZER_SETTINGS,
        locale: "en",
      },
    );

    expect(result.status).toBe("error");
    expect(result.diagnostics[0]?.code).toBe("UNIQUE_TERM_LIMIT");
  });

  it("rejects candidate tokens above the segmentation budget", () => {
    const result = tokenize("x ".repeat(LIMITS.maxCandidateTokens + 1), {
      ...DEFAULT_TOKENIZER_SETTINGS,
      locale: "en",
    });

    expect(result.status).toBe("error");
    expect(result.diagnostics[0]?.code).toBe("TOKEN_LIMIT");
  });

  it("keeps a crowded layout bounded and preserves every ranked record", () => {
    const terms = uniqueLatinWords(LIMITS.maxUniqueTerms);
    const tokenization = tokenize(terms.join(" "), {
      ...DEFAULT_TOKENIZER_SETTINGS,
      locale: "en",
    });
    expect(tokenization.status).toBe("ok");
    const wordSet = buildWordSet(tokenization.tokens, {
      caseMode: "preserve",
      locale: "en",
      tokenizerVersion: tokenization.tokenizerVersion,
    });
    const style: LayoutStyle = {
      canvas: { width: 120, height: 120 },
      minFontSize: 72,
      maxFontSize: 72,
      scale: "sqrt",
      padding: 8,
      rotations: [0, 90],
      palette: ["#111111"],
      background: "#ffffff",
      fontFamily: "system-ui",
      seed: "stress",
      version: "layout-v1",
    };
    const metrics = createFontMetricsTable(
      terms,
      { id: "system", family: "system-ui", weight: 500, style: "normal" },
      16,
      (term) => ({ width: Math.max(36, term.length * 9), height: 16 }),
    );
    const started = performance.now();
    const scene = layoutWordCloud(wordSet, style, metrics, {
      maxLayoutMs: 40,
      maxProbes: LIMITS.maxLayoutProbes,
    });
    const elapsed = performance.now() - started;

    expect(scene.words).toHaveLength(terms.length);
    expect(scene.words.some((word) => word.status !== "placed")).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });
});
