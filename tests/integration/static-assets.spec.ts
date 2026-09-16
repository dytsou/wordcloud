import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const wrangler = readFileSync(resolve(root, "wrangler.toml"), "utf8");
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
) as { scripts?: Record<string, string> };

describe("Static Assets shell", () => {
  it("uses SPA fallback without a Worker API or storage binding", () => {
    expect(wrangler).toContain(
      'not_found_handling = "single-page-application"',
    );
    expect(wrangler).toContain('directory = "./dist"');
    expect(wrangler).not.toContain("main =");
    expect(wrangler).not.toMatch(
      /run_worker_first|durable_objects|kv_namespaces|d1_databases|r2_buckets/,
    );
  });

  it("enables sampled invocation logs and traces", () => {
    expect(wrangler).toContain("[observability]");
    expect(wrangler).toContain("[observability.logs]");
    expect(wrangler).toContain("invocation_logs = true");
    expect(wrangler).toContain("[observability.traces]");
    expect(wrangler).toContain("head_sampling_rate = 1");
  });

  it("exposes the planned local verification scripts", () => {
    expect(packageJson.scripts).toMatchObject({
      build: "vite build",
      typecheck: "tsc -b --pretty false",
      "test:integration": "vitest run tests/integration",
      "wrangler:dry-run": "wrangler deploy --dry-run",
    });
  });
});
