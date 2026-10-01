import { describe, expect, it, vi } from "vitest";
import { fromSnapshot } from "../../src/app/editor-state";
import { BUILT_IN_SHAPES } from "../../src/core/shapes";
import {
  decodeSnapshotFragment,
  encodeSnapshot,
} from "../../src/core/snapshot";
import { decodeSnapshotInput } from "../../src/mcp/wordcloud";
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
    tools?: Array<{
      inputSchema?: {
        properties?: Record<string, McpSchemaProperty>;
      };
      name?: string;
    }>;
  };
}

interface McpSchemaProperty {
  default?: number;
  enum?: string[];
  maximum?: number;
  minimum?: number;
  properties?: Record<string, McpSchemaProperty>;
  required?: string[];
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
    const generateTool = listPayload.result?.tools?.find(
      (tool) => tool.name === "wordcloud-generate-from-text",
    );
    const shapeSchema =
      generateTool?.inputSchema?.properties?.style?.properties?.shape;
    expect(shapeSchema?.properties?.id?.enum).toEqual(
      BUILT_IN_SHAPES.map((shape) => shape.id),
    );
    expect(shapeSchema?.required).toContain("id");
    expect(shapeSchema?.properties?.widthScale).toMatchObject({
      minimum: 0.2,
      maximum: 1,
      default: 1,
    });
    expect(shapeSchema?.properties?.heightScale).toMatchObject({
      minimum: 0.2,
      maximum: 1,
      default: 1,
    });
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

    const inspectResponse = await worker.fetch(
      mcpRequest({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: {
          name: "wordcloud-inspect",
          arguments: {
            vUrl: encodeSnapshot(snapshotWordSet, snapshotStyle, snapshotScene)
              .fragment,
          },
        },
      }),
      env,
    );
    const inspectPayload = await readMcpPayload(inspectResponse);
    expect(inspectResponse.status).toBe(200);
    expect(inspectPayload.result?.structuredContent).toMatchObject({
      schemaVersion: "wc-snapshot-v1",
      layoutVersion: "layout-v1",
    });
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
    const snapshot = decodeSnapshotInput(result.vFragment);

    expect(response.status).toBe(200);
    expect(result.vFragment).toMatch(/^#wc-pako:v2:/);
    expect(snapshot.schemaVersion).toBe("wc-snapshot-v1");
    expect(result.vFragment).not.toContain("Apple apple Cloudflare");
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

  it("generates shaped snapshots accepted unchanged by inspect, render, and the editor", async () => {
    const env = createEnv();
    const sourceText = "community shape containment keeps words inside";
    const response = await worker.fetch(
      mcpRequest({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "wordcloud-generate-from-text",
          arguments: {
            sourceText,
            locale: "en",
            style: {
              shape: {
                id: "ellipse",
                widthScale: 0.75,
                heightScale: 0.6,
              },
            },
          },
        },
      }),
      env,
    );
    const generatedPayload = await readMcpPayload(response);
    const generatedText = generatedPayload.result?.content?.[0]?.text;
    const generated = JSON.parse(generatedText ?? "{}");
    const snapshot = decodeSnapshotInput(generated.vFragment);

    expect(response.status).toBe(200);
    expect(generated.vFragment).toMatch(/^#wc-pako:v2:/);
    expect(snapshot).toMatchObject({
      schemaVersion: "wc-snapshot-v2",
      layoutVersion: "layout-v2",
      presentation: {
        shape: { id: "ellipse", widthScale: 0.75, heightScale: 0.6 },
      },
    });
    expect(generated.vFragment).not.toContain(sourceText);
    expect(generatedPayload.result?.structuredContent).not.toHaveProperty(
      "sourceText",
    );
    expect(
      fromSnapshot(decodeSnapshotFragment(generated.vFragment)).presentation
        .shape,
    ).toEqual({
      id: "ellipse",
      widthScale: 0.75,
      heightScale: 0.6,
    });

    const inspectResponse = await worker.fetch(
      mcpRequest({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "wordcloud-inspect",
          arguments: { vUrl: generated.vFragment },
        },
      }),
      env,
    );
    const inspectPayload = await readMcpPayload(inspectResponse);
    const inspectResult = inspectPayload.result?.structuredContent;
    expect(inspectResponse.status).toBe(200);
    expect(inspectPayload.result?.isError).not.toBe(true);
    expect(inspectResult).toMatchObject({
      schemaVersion: "wc-snapshot-v2",
      layoutVersion: "layout-v2",
    });

    const renderResponse = await worker.fetch(
      mcpRequest({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "wordcloud-render-svg",
          arguments: { vUrl: generated.vFragment },
        },
      }),
      env,
    );
    const renderPayload = await readMcpPayload(renderResponse);
    expect(renderResponse.status).toBe(200);
    expect(renderPayload.result?.content?.[0]?.text).toContain("<svg");
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
