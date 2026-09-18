# Wordcloud Studio

Wordcloud Studio is a local-first word-cloud generator for individual creators. Paste multilingual text, preview the tokenizer output, tune the visual treatment, and share a reproducible V link without uploading the source text.

## Privacy and data flow

For the editor workflow, source analysis, counting, font measurement, layout, rendering, and export happen in the browser. The Cloudflare Worker serves the static application and exposes a stateless MCP endpoint. Its V-only tools handle already-derived data, while the opt-in source generator analyzes a bounded `sourceText` request in memory and returns an SVG plus a V fragment. The Worker does not persist or log source text and has no database, KV, R2, analytics, or application telemetry path. The browser layout engine uses a Web Worker when available and falls back to the same bounded core algorithm if it cannot start.

The V link uses the fixed fragment format `#wc-pako:v1:<payload>`:

1. Snapshot data is canonical JSON with sorted object keys.
2. Pako DEFLATE level 9 compresses the JSON with a zlib wrapper.
3. The bytes become unpadded URL-safe Base64 (`+` → `-`, `/` → `_`).

A V contains normalized terms, counts, ranks, style, and derived placements. It never contains the raw source or editable tokenizer rule bodies, and it is not a secret-bearing link. A loaded V remains style-remixable and can produce another V. The `.wc` download is the larger local fallback when a URL would exceed the safe share limit.

The latest source draft is kept in this browser's versioned `localStorage` cache so a refresh does not erase pasted text. It never leaves the device; clearing the source or starting a new cloud removes the cached draft. Browser storage can be cleared separately through the browser's site-data controls.

## MCP interface

The Worker exposes an authless, stateless Streamable HTTP MCP endpoint at `/mcp`:

- `wordcloud-inspect` returns metadata, ranked counts, and layout status from an existing V URL or `#wc-pako:v1:` fragment.
- `wordcloud-render-svg` returns SVG text for the validated scene in an existing V URL or fragment.
- `wordcloud-generate-from-text` accepts bounded `sourceText`, locale and tokenizer options (including stop words, dictionary, custom rules, and case handling), then returns SVG text, a reproducible V fragment, and derived summary data.

The inspect and render tools accept only the V representation; they do not fetch remote URLs. The generator is the explicit exception: `sourceText` is sent to the Worker for this request, is not written into the V fragment, and is not returned as a separate field. The SVG, summary, and V-derived records necessarily contain the resulting terms. Because the endpoint is public, do not use it for sensitive word lists until an authentication layer is added.

The machine-readable HTTP and JSON-RPC contract is available in [`openapi.yaml`](openapi.yaml), including request examples, tool input schemas, response schemas, limits, and error behavior.

## Tokenization and ranking

The interface includes English, Traditional and Simplified Chinese, Japanese, Korean, Spanish, French, German, Portuguese, Thai, Vietnamese, Indonesian, Italian, Russian, Arabic, Hindi, and more. The UI language follows the browser on first visit and can be changed from the top-right selector. The initial tokenizer locale is independently selected from the browser's preferred languages; changing the interface language does not silently change the tokenizer locale. A manually selected tokenizer locale remains in the current editor state, while a loaded V keeps the locale encoded in its derived word set.

The selected locale is the default lane for `Intl.Segmenter`; mixed scripts are routed to fixed English, Traditional/Simplified Han, Japanese, or Thai lanes where script detection is unambiguous. The editor exposes a broad runtime-filtered locale catalog, including `en`, `zh-Hant`, `zh-Hans`, `ja`, `ko`, `th`, `vi`, `id`, `ms`, `fr`, `de`, `es`, `it`, `pt`, `ru`, `uk`, `pl`, `nl`, `tr`, `ar`, `he`, `hi`, `bn`, `fa`, `ur`, `sv`, `da`, `nb`, `fi`, `no`, `cs`, `sk`, `ro`, `bg`, `el`, `hu`, `ca`, `hr`, `sl`, `sr`, `et`, `lv`, `lt`, and `sw` when the browser's ICU data supports them. Users can normalize case, keep numbers/symbols, add stop words, protect a dictionary phrase, split a literal into terms, or merge a literal sequence into one term. Rules are validated for length, conflicts, cycles, and count before analysis.

The word size is a visual mapping of frequency, not a second count. By default it uses a linear scale between the configured minimum and maximum font sizes; square-root and logarithmic mappings are also available. Ranking is deterministic: count descending, first occurrence ascending, then normalized Unicode scalar order. Ranks are one-based and preserved in the table, SceneModel, SVG metadata, PNG render plan, and V snapshot.

Placement processes words from highest to lowest frequency. Prominent words stay horizontal; smaller words try horizontal positions first, then the configured tilt angles inside the current search ring before moving outward. Browser-rasterized glyph masks let small words occupy empty spaces inside and between large glyphs, rather than reserving their entire rectangles. The spacing control ranges from `-12px` to `24px`: non-negative values protect painted strokes; negative values erode collision masks and deliberately permit overlap (thin strokes can lose their exclusion area entirely).

## Safety limits

The application rejects or bounds work at the following product limits:

- 1 MiB UTF-8 source; 200,000 candidate tokens; 500 unique terms.
- MCP source generation is capped at 32 KiB UTF-8 and 100 unique terms; the Worker rejects MCP request bodies above 64 KiB.
- 100 custom rules; 128 Unicode scalars per literal term.
- 8 KiB encoded URL fragment; 12 KiB complete share URL; 512 KiB `.wc` file.
- 256 KiB inflated JSON; 64× inflate ratio; 4,096 px canvas dimension; 16 MP export.
- 100,000 layout probes and an 8-second layout safety budget.

Unplaceable terms are retained in the ranked table with a reason. SVG and PNG use the same validated SceneModel as the live preview; SVG writes terms as text nodes/escaped text and permits no scripts, event attributes, external URLs, `foreignObject`, or arbitrary CSS.

## Local development and deployment

The intended package/script entry point is the [pnpm package manager](https://pnpm.io/) (pinned to pnpm 11), with the committed `pnpm-lock.yaml`:

```sh
pnpm install
pnpm run dev
pnpm run test
pnpm run test:browser
pnpm run build
pnpm run api:lint
pnpm run api:build
pnpm run wrangler:dry-run
pnpm run deploy
```

`pnpm run api:lint` validates the OpenAPI 3.1 contract, and `pnpm run api:build` bundles it into one `dist/client/api/openapi.yaml` file and generates a self-hosted Swagger UI at `dist/client/api/index.html`. CI runs both steps after the application checks pass; the post-CI deployment then publishes them with the existing Worker Static Assets deployment. After deployment, open `https://<worker-origin>/api/` for the online API reference or `https://<worker-origin>/api/openapi.yaml` for the compiled contract.

Cloudflare Static Assets serves `dist` through the `ASSETS` binding and uses SPA fallback for direct application paths; `/mcp` is handled by the custom Worker. Configure Wrangler authentication before `pnpm run deploy`; the app does not require storage bindings or secrets. The runtime capability gates are `Intl.Segmenter`, Canvas 2D, Web Worker, font readiness, SVG, Blob, and clipboard. Unsupported analysis capabilities produce an actionable local error; a valid V can still be opened when source analysis is unavailable.
