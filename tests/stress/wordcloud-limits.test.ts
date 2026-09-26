import { describe, expect, it, vi } from "vitest";
import { layoutWordCloud, type LayoutStyle } from "../../src/core/layout";
import { LIMITS } from "../../src/core/limits";
import { createFontMetricsTable } from "../../src/core/metrics";
import { createGlyphSprites } from "../../src/render/glyph-sprites";
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
      caseInsensitive: false,
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

  it("checks a near-cap sprite hit and a full-span mask miss within bounded work", () => {
    const canvasSize = 4000;
    const spriteWidth = 4000;
    const spriteHeight = 3999;
    const rows = Array.from({ length: 1_999 }, (_, index) => {
      const y = index + 1_000;
      const x = y === 2_998 ? 0 : 1_999;
      return [y, x, x + 1];
    }).flat();
    const missThenHit = {
      baseFontSize: 16,
      fingerprint: "near-cap-shapes",
      words: { alpha: { width: 20, height: 20 } },
      sprites: {
        alpha: {
          0: {
            width: spriteWidth,
            height: spriteHeight,
            pixels: new Uint32Array([0, spriteWidth * spriteHeight - 1]),
            inkSpans: new Uint16Array(rows),
          },
          90: {
            width: spriteHeight,
            height: spriteWidth,
            pixels: new Uint32Array([8_000_000]),
            inkSpans: new Uint16Array([2_000, 2_000, 2_001]),
          },
        },
      },
    };
    const wordSet = {
      locale: "en",
      tokenizerVersion: "stress",
      totalTokens: 4,
      words: [{ term: "alpha", count: 1, firstSeen: 0, rank: 3, locale: "en" }],
    };
    const style: LayoutStyle = {
      canvas: { width: canvasSize, height: canvasSize },
      minFontSize: 16,
      maxFontSize: 16,
      scale: "sqrt",
      padding: 0,
      rotations: [0, 90],
      palette: ["#111111"],
      background: "#ffffff",
      fontFamily: "system-ui",
      seed: "near-cap-shape-stress",
      version: "layout-v2",
      shape: { id: "circle", widthScale: 1, heightScale: 1 },
    };
    const started = performance.now();
    const hitAfterFullMiss = layoutWordCloud(wordSet, style, missThenHit, {
      maxProbes: 2,
      maxLayoutMs: 2_000,
    });
    const elapsed = performance.now() - started;
    const allMissMetrics = {
      ...missThenHit,
      sprites: {
        alpha: {
          0: {
            ...missThenHit.sprites.alpha[0],
            inkSpans: new Uint16Array([1_999, 0, 1]),
          },
          90: {
            ...missThenHit.sprites.alpha[90],
            inkSpans: new Uint16Array([2_000, 0, 1]),
          },
        },
      },
    };
    const fullMiss = layoutWordCloud(wordSet, style, allMissMetrics, {
      maxProbes: 2,
    });

    expect(spriteWidth * spriteHeight * 2).toBeGreaterThan(31_000_000);
    expect(spriteWidth * spriteHeight * 2).toBeLessThanOrEqual(32_000_000);
    expect(hitAfterFullMiss.words[0]).toEqual(
      expect.objectContaining({ status: "placed", angle: 90 }),
    );
    expect(fullMiss.words[0]?.reason).toBe("no-fit");
    expect(elapsed).toBeLessThan(2_000);
  });

  it("falls back before generating sprites beyond the aggregate pixel cap", async () => {
    const getImageData = vi.fn(
      (_: number, __: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
    );
    const context = {
      font: "",
      textAlign: "",
      textBaseline: "",
      measureText: () => ({
        width: 4_030,
        actualBoundingBoxLeft: 2_015,
        actualBoundingBoxRight: 2_015,
        actualBoundingBoxAscent: 2_015,
        actualBoundingBoxDescent: 2_015,
        fontBoundingBoxAscent: 2_015,
        fontBoundingBoxDescent: 2_015,
      }),
      translate: vi.fn(),
      rotate: vi.fn(),
      fillText: vi.fn(),
      getImageData,
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => context,
    };
    vi.stubGlobal("document", {
      createElement: () => fakeCanvas,
    });
    const wordSet = {
      locale: "en",
      tokenizerVersion: "stress",
      totalTokens: 3,
      words: [
        { term: "alpha", count: 2, firstSeen: 0, rank: 1, locale: "en" },
        { term: "beta", count: 1, firstSeen: 1, rank: 2, locale: "en" },
      ],
    };
    const style: LayoutStyle = {
      canvas: { width: 4096, height: 4096 },
      minFontSize: 16,
      maxFontSize: 16,
      scale: "sqrt",
      padding: 0,
      rotations: [0],
      palette: ["#111111"],
      background: "#ffffff",
      fontFamily: "system-ui",
      seed: "near-cap-sprite-budget",
      version: "layout-v1",
    };

    try {
      const sprites = await createGlyphSprites(wordSet, style, () => false);
      expect(sprites).toBeUndefined();
      expect(getImageData).toHaveBeenCalledTimes(1);
      expect(fakeCanvas.width).toBeLessThanOrEqual(LIMITS.maxCanvasDimension);
      expect(fakeCanvas.height).toBeLessThanOrEqual(LIMITS.maxCanvasDimension);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
