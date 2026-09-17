import { describe, expect, it, vi } from "vitest";
import { encodeSnapshot } from "../../src/core/snapshot";
import worker from "../../src/worker/index";
import {
  snapshotScene,
  snapshotStyle,
  snapshotWordSet,
} from "../fixtures/snapshots";

const assetResponse = new Response("asset", {
  headers: { "content-type": "text/plain" },
});

function createEnv() {
  return {
    ASSETS: {
      fetch: vi.fn(async () => assetResponse.clone()),
    },
  };
}

function mcpRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://wordcloud.example/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

interface McpPayload {
  error?: unknown;
  result?: {
    capabilities?: { tools?: Record<string, unknown> };
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    tools?: Array<{ name?: string }>;
  };
}

async function readMcpPayload(response: Response): Promise<McpPayload> {
  const body = await response.text();
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return JSON.parse(body) as McpPayload;
  }

  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine)
    throw new Error("MCP SSE response did not contain a data event.");
  return JSON.parse(dataLine.slice("data: ".length)) as McpPayload;
}

describe("MCP Worker", () => {
  it("passes non-MCP requests to Static Assets", async () => {
    const env = createEnv();

    const response = await worker.fetch(
      new Request("https://wordcloud.example/"),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("asset");
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it("answers CORS preflight requests without invoking MCP", async () => {
    const env = createEnv();

    const response = await worker.fetch(
      new Request("https://wordcloud.example/mcp", { method: "OPTIONS" }),
      env,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("exposes the stateless MCP tool surface", async () => {
    const env = createEnv();

    const response = await worker.fetch(
      mcpRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "wordcloud-test", version: "1.0.0" },
        },
      }),
      env,
    );
    const payload = await readMcpPayload(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(payload.result?.capabilities?.tools).toBeDefined();

    const listResponse = await worker.fetch(
      mcpRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
      env,
    );
    const listPayload = await readMcpPayload(listResponse);
    expect(listPayload.result?.tools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "wordcloud-generate-from-text",
        "wordcloud-inspect",
        "wordcloud-render-svg",
      ]),
    );
  });

  it("rejects declared MCP bodies above the Worker limit", async () => {
    const env = createEnv();

    const response = await worker.fetch(
      mcpRequest({}, { "content-length": String(65 * 1024) }),
      env,
    );

    expect(response.status).toBe(413);
    expect(await response.text()).toContain("too large");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("rejects chunked MCP bodies above the Worker limit", async () => {
    const env = createEnv();
    const response = await worker.fetch(
      new Request("https://wordcloud.example/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: "x".repeat(65 * 1024),
      }),
      env,
    );

    expect(response.status).toBe(413);
    expect(await response.text()).toContain("too large");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("can render a V snapshot through the MCP tool", async () => {
    const env = createEnv();
    const vUrl = `https://wordcloud.example/share${
      encodeSnapshot(snapshotWordSet, snapshotStyle, snapshotScene).fragment
    }`;

    const response = await worker.fetch(
      mcpRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "wordcloud-render-svg",
          arguments: { vUrl },
        },
      }),
      env,
    );
    const payload = await readMcpPayload(response);

    expect(response.status).toBe(200);
    expect(payload.result?.content?.[0]?.text).toContain("<svg");
    expect(payload.result?.content?.[0]?.text).toContain(">hello</text>");
  });

  it("generates SVG and a V fragment from source text", async () => {
    const env = createEnv();

    const response = await worker.fetch(
      mcpRequest({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "wordcloud-generate-from-text",
          arguments: {
            sourceText: "Apple apple Cloudflare",
            locale: "en",
            caseInsensitive: true,
          },
        },
      }),
      env,
    );
    const payload = await readMcpPayload(response);
    const resultText = payload.result?.content?.[0]?.text;
    const result = JSON.parse(resultText ?? "{}");

    expect(response.status).toBe(200);
    expect(result.vFragment).toMatch(/^#wc-pako:v1:/);
    expect(result.summary.topWords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ term: "Apple", count: 2 }),
        expect.objectContaining({ term: "Cloudflare", count: 1 }),
      ]),
    );
    expect(payload.result?.content?.[1]?.text).toContain(">Apple</text>");
    expect(payload.result?.content?.[1]?.text).toContain(">Cloudflare</text>");
    expect(payload.result?.structuredContent).not.toHaveProperty("sourceText");
  });

  it("rejects unknown source-generation fields", async () => {
    const env = createEnv();

    const response = await worker.fetch(
      mcpRequest({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "wordcloud-generate-from-text",
          arguments: {
            sourceText: "hello",
            unexpected: "raw source should not be silently ignored",
          },
        },
      }),
      env,
    );
    const payload = await readMcpPayload(response);

    expect(response.status).toBe(200);
    expect(payload.result?.isError ?? Boolean(payload.error)).toBe(true);
  });
});
