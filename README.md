# Wordcloud Studio

Wordcloud Studio is a local-first word-cloud generator for individual creators. Paste multilingual text, preview the tokenizer output, tune the visual treatment, and share a reproducible V link without uploading the source text.

## Privacy and data flow

All source analysis, counting, font measurement, layout, rendering, and export happen in the browser. The Cloudflare Worker serves the static application and has no source-text API, database, KV, R2, or application analytics. Cloudflare Workers Logs and tracing are enabled in `wrangler.toml` for platform-level invocation telemetry; the app emits no custom logs and does not send source text. The browser layout engine uses a Web Worker when available and falls back to the same bounded core algorithm if it cannot start.

The V link uses the fixed fragment format `#wc-pako:v1:<payload>`:

1. Snapshot data is canonical JSON with sorted object keys.
2. Pako DEFLATE level 9 compresses the JSON with a zlib wrapper.
3. The bytes become unpadded URL-safe Base64 (`+` → `-`, `/` → `_`).

A V contains normalized terms, counts, ranks, style, and derived placements. It never contains the raw source or editable tokenizer rule bodies, and it is not a secret-bearing link. A loaded V remains style-remixable and can produce another V. The `.wc` download is the larger local fallback when a URL would exceed the safe share limit.

The latest source draft is kept in this browser's versioned `localStorage` cache so a refresh does not erase pasted text. Stop words and custom dictionary entries are cached locally for 24 hours after their last edit; font sizes, spacing, rotation, and palette preferences persist without a TTL. These values never leave the device. Clearing the source or starting a new cloud removes the cached draft; browser storage can be cleared separately through the browser's site-data controls.

## Tokenization and ranking

The selected locale is the default lane for `Intl.Segmenter`; mixed scripts are routed to fixed English, Traditional/Simplified Han, Japanese, or Thai lanes. Users can normalize case, or enable **忽略大小寫** to count `Apple`, `apple`, and `APPLE` as one word while keeping the first spelling for display. Stop-word matching follows the same setting. Stop words, dictionary phrases, and palette colors are entered one tag at a time with Enter; spaces and commas inside a tag are preserved, and Backspace removes the last tag when the entry is empty. Users can also keep numbers/symbols, protect a dictionary phrase, split a literal into terms, or merge a literal sequence into one term. Rules are validated for length, conflicts, cycles, and count before analysis.

The word size is a visual mapping of frequency, not a second count. The default dense-fill profile uses a linear scale from 8px to 128px, 0px spacing, and horizontal/±35° fallback rotations; square-root and logarithmic mappings are also available. The style panel includes curated palette presets as well as the editable hex input. Ranking is deterministic: count descending, first occurrence ascending, then normalized Unicode scalar order. Ranks are one-based and preserved in the table, SceneModel, SVG metadata, PNG render plan, and V snapshot.

Placement processes words from highest to lowest frequency. Prominent words stay horizontal; smaller words try horizontal positions first, then the configured tilt angles inside the current search ring before moving outward. Browser-rasterized glyph masks let small words occupy empty spaces inside and between large glyphs, rather than reserving their entire rectangles. The spacing control ranges from `-12px` to `24px`: non-negative values protect painted strokes; negative values erode collision masks and deliberately permit overlap (thin strokes can lose their exclusion area entirely).

## Safety limits

The application rejects or bounds work at the following product limits:

- 1 MiB UTF-8 source; 200,000 candidate tokens; 500 unique terms.
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
pnpm run wrangler:dry-run
pnpm run deploy
```

Cloudflare Static Assets serves `dist` and uses SPA fallback for direct application paths. Configure Wrangler authentication before `pnpm run deploy`; v1 does not require a Worker binding or secret. The committed `wrangler.toml` enables 100% sampled invocation logs and traces; see [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) and [Workers tracing](https://developers.cloudflare.com/workers/observability/traces/) for dashboard access and sampling guidance. Request metadata may still be recorded by Cloudflare, so V links are not secrets. The runtime capability gates are `Intl.Segmenter`, Canvas 2D, Web Worker, font readiness, SVG, Blob, and clipboard. Unsupported analysis capabilities produce an actionable local error; a valid V can still be opened when source analysis is unavailable.

## CI/CD

The GitHub Actions pipeline follows the split CI/deploy shape used by the [site repository](https://github.com/dytsou/site): [`ci.yml`](.github/workflows/ci.yml) checks pull requests and pushes to `main`, then uploads the exact `dist` artifact from successful `main` builds. [`deploy.yml`](.github/workflows/deploy.yml) deploys only a successful `main` artifact, supports a manual `main` deployment, and serializes production deployments. CI runs formatting, linting, Cloudflare type generation, type checking, deterministic tests, browser tests, the production build, and a Wrangler dry-run. [`dependabot.yml`](.github/dependabot.yml) checks pnpm dependencies and GitHub Actions every Friday, grouping related updates into reviewable pull requests.

Before enabling deployment, add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as repository or production-environment secrets. Use a narrowly scoped Cloudflare API token with Workers Editor access for the existing `wordcloud` Worker; creating the Worker for the first time may require product-level Admin access. Cloudflare's [GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) covers token creation and account scoping.

The repository keeps MCP integration deferred to the next implementation; v1 intentionally exposes no MCP endpoint or tool surface.
