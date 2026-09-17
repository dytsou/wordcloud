import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { DEFAULT_PRESENTATION } from "../app/editor-state";
import { encodeJsonFragment, SNAPSHOT_PREFIX } from "../core/codec";
import { layoutWordCloud, type LayoutStyle } from "../core/layout";
import { LIMITS, utf8ByteLength } from "../core/limits";
import type { FontMetric, FontMetricsTable } from "../core/metrics";
import { buildWordSet } from "../core/word-model";
import {
  decodeSnapshotFragment,
  createSnapshot,
  type SnapshotPayload,
} from "../core/snapshot";
import { isSafeFontFamily, isSafeHexColor } from "../core/style-safety";
import {
  DEFAULT_TOKENIZER_SETTINGS,
  FIXED_LOCALES,
  tokenize,
} from "../core/tokenizer";
import type { TokenRule, TokenizerSettings } from "../core/types";
import type { SceneWord } from "../core/scene";
import type { SceneSvgOptions } from "../render/svg";
import { renderSceneSvg } from "../render/svg";

const MCP_SERVER_NAME = "wordcloud";
const MCP_SERVER_VERSION = "0.1.0";
const MAX_SUMMARY_WORDS = 100;
const MAX_GENERATION_SOURCE_BYTES = 32 * 1024;
const MAX_GENERATION_WORDS = 100;
const MAX_GENERATION_PROBES = 20_000;
const MAX_GENERATION_LAYOUT_MS = 500;
const SERVER_METRICS_BASE_FONT_SIZE = 16;

const CASE_MODES = ["preserve", "lower", "upper"] as const;
const POLICY_VALUES = ["exclude", "include"] as const;

// The control-character range is intentional for untrusted MCP metadata.
const SAFE_TEXT_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;
const WIDE_CHARACTER_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\u{1F000}-\u{1FAFF}]/u;

export type SnapshotWordSummary = Pick<
  SceneWord,
  | "term"
  | "count"
  | "rank"
  | "locale"
  | "fontSize"
  | "angle"
  | "status"
  | "reason"
>;

export interface SnapshotSummary {
  schemaVersion: SnapshotPayload["schemaVersion"];
  codecVersion: SnapshotPayload["codecVersion"];
  tokenizerVersion: string;
  layoutVersion: string;
  sceneVersion: SnapshotPayload["sceneVersion"];
  locale: string;
  totalTokens: number;
  wordCount: number;
  placedCount: number;
  unplaceableCount: number;
  budgetLimitedCount: number;
  layoutStatus: SnapshotPayload["scene"]["layoutStatus"];
  canvas: SnapshotPayload["scene"]["canvas"];
  topWords: SnapshotWordSummary[];
}

export interface GeneratedWordcloud {
  vFragment: string;
  svg: string;
  summary: SnapshotSummary;
}

function estimateFontMetric(term: string): FontMetric {
  let units = 0;
  for (const character of term) {
    units += WIDE_CHARACTER_PATTERN.test(character) ? 1 : 0.58;
  }
  return {
    width: Math.max(8, units * SERVER_METRICS_BASE_FONT_SIZE),
    height: SERVER_METRICS_BASE_FONT_SIZE,
  };
}

function createServerFontMetrics(
  words: ReadonlyArray<{ term: string }>,
): FontMetricsTable {
  const metrics: Record<string, FontMetric> = {};
  for (const word of words) metrics[word.term] = estimateFontMetric(word.term);
  return {
    baseFontSize: SERVER_METRICS_BASE_FONT_SIZE,
    fingerprint: "worker-estimated-metrics-v1",
    words: metrics,
  };
}

function invalidVInput(): Error {
  return new Error("A valid V URL or fragment is required.");
}

/**
 * Accept only the local app's encoded V representation. This intentionally
 * does not accept source text, JSON snapshots, or URLs that need fetching.
 */
export function extractSnapshotFragment(value: string): string {
  const input = value.trim();
  if (input.length === 0 || utf8ByteLength(input) > LIMITS.maxShareUrlBytes) {
    throw invalidVInput();
  }

  if (input.startsWith("#")) {
    if (
      !input.startsWith(SNAPSHOT_PREFIX) ||
      utf8ByteLength(input) > LIMITS.maxEncodedFragmentBytes
    ) {
      throw invalidVInput();
    }
    return input;
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw invalidVInput();
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invalidVInput();
  }

  const fragment = url.hash;
  if (
    !fragment.startsWith(SNAPSHOT_PREFIX) ||
    utf8ByteLength(fragment) > LIMITS.maxEncodedFragmentBytes
  ) {
    throw invalidVInput();
  }
  return fragment;
}

export function decodeSnapshotInput(value: string): SnapshotPayload {
  try {
    return decodeSnapshotFragment(extractSnapshotFragment(value));
  } catch {
    throw new Error("The V snapshot is invalid or exceeds safety limits.");
  }
}

function normalizedLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 20;
  return Math.min(MAX_SUMMARY_WORDS, Math.max(1, Math.trunc(limit)));
}

export function summarizeSnapshot(
  value: string,
  limit: number = 20,
): SnapshotSummary {
  return summarizeSnapshotPayload(decodeSnapshotInput(value), limit);
}

function summarizeSnapshotPayload(
  snapshot: SnapshotPayload,
  limit: number,
): SnapshotSummary {
  const sceneByRank = new Map(
    snapshot.scene.words.map((word) => [word.rank, word]),
  );
  const topWords = snapshot.wordSet.words
    .slice(0, normalizedLimit(limit))
    .map((word) => {
      const sceneWord = sceneByRank.get(word.rank);
      if (!sceneWord) {
        throw new Error("The V snapshot is invalid or exceeds safety limits.");
      }
      return {
        term: word.term,
        count: word.count,
        rank: word.rank,
        locale: word.locale,
        fontSize: sceneWord.fontSize,
        angle: sceneWord.angle,
        status: sceneWord.status,
        ...(sceneWord.reason ? { reason: sceneWord.reason } : {}),
      };
    });

  const statusCounts = snapshot.scene.words.reduce(
    (counts, word) => {
      if (word.status === "placed") counts.placedCount += 1;
      else if (word.status === "budget-limited") counts.budgetLimitedCount += 1;
      else counts.unplaceableCount += 1;
      return counts;
    },
    { placedCount: 0, unplaceableCount: 0, budgetLimitedCount: 0 },
  );

  return {
    schemaVersion: snapshot.schemaVersion,
    codecVersion: snapshot.codecVersion,
    tokenizerVersion: snapshot.tokenizerVersion,
    layoutVersion: snapshot.layoutVersion,
    sceneVersion: snapshot.sceneVersion,
    locale: snapshot.wordSet.locale,
    totalTokens: snapshot.wordSet.totalTokens,
    wordCount: snapshot.wordSet.words.length,
    ...statusCounts,
    layoutStatus: snapshot.scene.layoutStatus,
    canvas: snapshot.scene.canvas,
    topWords,
  };
}

export function renderSnapshotSvg(
  value: string,
  options: SceneSvgOptions = {},
): string {
  return renderSceneSvg(decodeSnapshotInput(value).scene, options);
}

function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

const snapshotInputSchema = z.strictObject({
  vUrl: z
    .string()
    .trim()
    .min(1)
    .max(LIMITS.maxShareUrlBytes)
    .describe("An existing V URL or #wc-pako:v1 fragment; never source text."),
});

const summaryInputSchema = z.strictObject({
  vUrl: snapshotInputSchema.shape.vUrl,
  limit: z.number().int().min(1).max(MAX_SUMMARY_WORDS).optional(),
});

const renderInputSchema = z.strictObject({
  vUrl: snapshotInputSchema.shape.vUrl,
  title: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
});

const safeLiteralSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.maxLiteralScalars)
  .refine((value) => !SAFE_TEXT_PATTERN.test(value), {
    message: "Text contains unsupported control or bidirectional characters.",
  });

const safeRuleIdSchema = safeLiteralSchema.max(64);
const rulePrioritySchema = z.number().int().min(-1000).max(1000).optional();

const tokenRuleSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: safeRuleIdSchema,
    kind: z.literal("protected"),
    phrase: safeLiteralSchema,
    priority: rulePrioritySchema,
  }),
  z.strictObject({
    id: safeRuleIdSchema,
    kind: z.literal("split"),
    source: safeLiteralSchema,
    terms: z.array(safeLiteralSchema).min(1).max(16),
    priority: rulePrioritySchema,
  }),
  z.strictObject({
    id: safeRuleIdSchema,
    kind: z.literal("merge"),
    source: safeLiteralSchema,
    term: safeLiteralSchema,
    priority: rulePrioritySchema,
  }),
]);

const hexColorSchema = z.string().refine(isSafeHexColor, {
  message: "Color must be a safe six/eight-digit hex value.",
});

const canvasInputSchema = z
  .strictObject({
    width: z.number().int().min(1).max(LIMITS.maxCanvasDimension).optional(),
    height: z.number().int().min(1).max(LIMITS.maxCanvasDimension).optional(),
  })
  .refine(
    ({ width, height }) =>
      (width ?? DEFAULT_PRESENTATION.canvas.width) *
        (height ?? DEFAULT_PRESENTATION.canvas.height) <=
      LIMITS.maxExportPixels,
    { message: "Canvas area exceeds the export safety limit." },
  );

const styleInputSchema = z.strictObject({
  canvas: canvasInputSchema.optional(),
  minFontSize: z.number().min(1).max(512).optional(),
  maxFontSize: z.number().min(1).max(512).optional(),
  scale: z.enum(["sqrt", "linear", "log"]).optional(),
  padding: z.number().min(LIMITS.minPadding).max(LIMITS.maxPadding).optional(),
  rotations: z.array(z.number().min(-120).max(120)).max(16).optional(),
  palette: z.array(hexColorSchema).min(1).max(16).optional(),
  background: hexColorSchema.optional(),
  fontFamily: z
    .string()
    .trim()
    .min(1)
    .max(LIMITS.maxLiteralScalars)
    .refine(isSafeFontFamily, {
      message: "fontFamily contains an unsupported CSS value.",
    })
    .optional(),
  seed: safeLiteralSchema.max(128).optional(),
  version: safeLiteralSchema.max(64).optional(),
});

const generateInputSchema = z
  .strictObject({
    sourceText: z
      .string()
      .trim()
      .min(1)
      .max(MAX_GENERATION_SOURCE_BYTES)
      .refine((value) => utf8ByteLength(value) <= MAX_GENERATION_SOURCE_BYTES, {
        message: `sourceText must be at most ${MAX_GENERATION_SOURCE_BYTES} UTF-8 bytes.`,
      }),
    locale: z.enum(FIXED_LOCALES).optional(),
    caseMode: z.enum(CASE_MODES).optional(),
    caseInsensitive: z.boolean().optional(),
    stopWords: z.array(safeLiteralSchema).max(LIMITS.maxCustomRules).optional(),
    dictionary: z
      .array(safeLiteralSchema)
      .max(LIMITS.maxCustomRules)
      .optional(),
    rules: z.array(tokenRuleSchema).max(LIMITS.maxCustomRules).optional(),
    numberPolicy: z.enum(POLICY_VALUES).optional(),
    symbolPolicy: z.enum(POLICY_VALUES).optional(),
    style: styleInputSchema.optional(),
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => !SAFE_TEXT_PATTERN.test(value), {
        message: "title contains unsupported control characters.",
      })
      .optional(),
    description: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((value) => !SAFE_TEXT_PATTERN.test(value), {
        message: "description contains unsupported control characters.",
      })
      .optional(),
  })
  .refine(
    (value) =>
      (value.style?.minFontSize ?? DEFAULT_PRESENTATION.minFontSize) <=
      (value.style?.maxFontSize ?? DEFAULT_PRESENTATION.maxFontSize),
    {
      path: ["style", "maxFontSize"],
      message: "minFontSize cannot be greater than maxFontSize.",
    },
  );

type SummaryInput = z.infer<typeof summaryInputSchema>;
type RenderInput = z.infer<typeof renderInputSchema>;
type GenerateInput = z.infer<typeof generateInputSchema>;

function buildGenerationStyle(input: GenerateInput): LayoutStyle {
  const style = input.style;
  return {
    ...DEFAULT_PRESENTATION,
    canvas: {
      ...DEFAULT_PRESENTATION.canvas,
      ...style?.canvas,
    },
    minFontSize: style?.minFontSize ?? DEFAULT_PRESENTATION.minFontSize,
    maxFontSize: style?.maxFontSize ?? DEFAULT_PRESENTATION.maxFontSize,
    scale: style?.scale ?? DEFAULT_PRESENTATION.scale,
    padding: style?.padding ?? DEFAULT_PRESENTATION.padding,
    rotations: [...(style?.rotations ?? DEFAULT_PRESENTATION.rotations)],
    palette: [...(style?.palette ?? DEFAULT_PRESENTATION.palette)],
    background: style?.background ?? DEFAULT_PRESENTATION.background,
    fontFamily: style?.fontFamily ?? DEFAULT_PRESENTATION.fontFamily,
    seed: style?.seed ?? DEFAULT_PRESENTATION.seed,
    version: style?.version ?? DEFAULT_PRESENTATION.version,
  };
}

function generateWordcloudFromParsedInput(
  values: GenerateInput,
): GeneratedWordcloud {
  const locale = values.locale ?? DEFAULT_TOKENIZER_SETTINGS.locale;
  const caseMode = values.caseMode ?? DEFAULT_TOKENIZER_SETTINGS.caseMode;
  const caseInsensitive =
    values.caseInsensitive ?? DEFAULT_TOKENIZER_SETTINGS.caseInsensitive;
  const tokenizerSettings: TokenizerSettings = {
    ...DEFAULT_TOKENIZER_SETTINGS,
    locale,
    caseMode,
    caseInsensitive,
    stopWords: [...(values.stopWords ?? [])],
    dictionary: [...(values.dictionary ?? [])],
    rules: [...(values.rules ?? [])] as TokenRule[],
    numberPolicy:
      values.numberPolicy ?? DEFAULT_TOKENIZER_SETTINGS.numberPolicy,
    symbolPolicy:
      values.symbolPolicy ?? DEFAULT_TOKENIZER_SETTINGS.symbolPolicy,
  };
  const tokenization = tokenize(values.sourceText, tokenizerSettings);
  if (tokenization.status !== "ok") {
    throw new Error(
      tokenization.diagnostics[0]?.message ??
        "Source text could not be converted into words.",
    );
  }

  const wordSet = buildWordSet(tokenization.tokens, {
    caseMode,
    caseInsensitive,
    locale,
    tokenizerVersion: tokenization.tokenizerVersion,
  });
  if (wordSet.words.length > MAX_GENERATION_WORDS) {
    throw new Error(
      `Source text produces too many unique words for MCP generation (maximum ${MAX_GENERATION_WORDS}).`,
    );
  }

  const presentation = buildGenerationStyle(values);
  const scene = layoutWordCloud(
    wordSet,
    presentation,
    createServerFontMetrics(wordSet.words),
    {
      maxProbes: MAX_GENERATION_PROBES,
      maxLayoutMs: MAX_GENERATION_LAYOUT_MS,
    },
  );
  const snapshot = createSnapshot(wordSet, presentation, scene);
  const fragment = encodeJsonFragment(snapshot).fragment;
  return {
    vFragment: fragment,
    svg: renderSceneSvg(scene, {
      title: values.title,
      description: values.description,
    }),
    summary: summarizeSnapshotPayload(snapshot, 20),
  };
}

export function generateWordcloudFromText(
  input: GenerateInput,
): GeneratedWordcloud {
  return generateWordcloudFromParsedInput(generateInputSchema.parse(input));
}

export function createWordcloudMcpServer(): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  server.registerTool(
    "wordcloud-generate-from-text",
    {
      title: "Generate a wordcloud from source text",
      description:
        "Analyze sourceText in memory and return SVG plus a reproducible V fragment. The source text is not persisted, logged, or included in the V fragment, but the rendered SVG necessarily contains the derived terms.",
      inputSchema: generateInputSchema,
    },
    async (input: GenerateInput) => {
      try {
        const generated = generateWordcloudFromParsedInput(input);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                vFragment: generated.vFragment,
                summary: generated.summary,
              }),
            },
            { type: "text" as const, text: generated.svg },
          ],
          structuredContent: generated,
        };
      } catch (error) {
        return toolError(
          error instanceof Error
            ? error.message
            : "Unable to generate a wordcloud from source text.",
        );
      }
    },
  );

  server.registerTool(
    "wordcloud-inspect",
    {
      title: "Inspect a wordcloud V",
      description:
        "Inspect derived word counts, ranks, layout status, and top words from an existing V URL or fragment. Raw source text is never accepted or returned.",
      inputSchema: summaryInputSchema,
    },
    async ({ vUrl, limit }: SummaryInput) => {
      try {
        const summary = summarizeSnapshot(vUrl, limit);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(summary) }],
          structuredContent: summary,
        };
      } catch {
        return toolError(
          "Unable to inspect this V. Provide a valid wc-pako:v1 URL or fragment.",
        );
      }
    },
  );

  server.registerTool(
    "wordcloud-render-svg",
    {
      title: "Render a wordcloud SVG",
      description:
        "Render the validated scene from an existing V URL or fragment as SVG text. Raw source text is never accepted, and external resources are not fetched.",
      inputSchema: renderInputSchema,
    },
    async ({ vUrl, title, description }: RenderInput) => {
      try {
        const svg = renderSnapshotSvg(vUrl, { title, description });
        return { content: [{ type: "text" as const, text: svg }] };
      } catch {
        return toolError(
          "Unable to render this V. Provide a valid wc-pako:v1 URL or fragment.",
        );
      }
    },
  );

  return server;
}
