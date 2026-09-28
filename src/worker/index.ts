import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Env } from "../worker-configuration";
import { createWordcloudMcpServer } from "../mcp/wordcloud";

export const MCP_PATH = "/mcp";
export const MAX_MCP_REQUEST_BYTES = 64 * 1024;

const mcpHandler = createMcpHandler(() => createWordcloudMcpServer(), {
  legacy: "stateless",
  onerror: () => {
    // Application error logs must exclude request data; platform telemetry may apply.
    console.error("Wordcloud MCP request failed.");
  },
});

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "Accept, Content-Type, Last-Event-Id, Mcp-Method, Mcp-Name, Mcp-Protocol-Version, Mcp-Session-Id",
  );
  headers.set("access-control-expose-headers", "Last-Event-Id, Mcp-Session-Id");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withNoIndex(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isAtOrBelowPath(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function tooLargeResponse(): Response {
  return withCors(
    Response.json({ error: "MCP request body is too large." }, { status: 413 }),
  );
}

function hasOversizedContentLength(request: Request): boolean {
  const contentLength = request.headers.get("content-length");
  if (contentLength === null) return false;
  const parsed = Number(contentLength);
  return (
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > MAX_MCP_REQUEST_BYTES
  );
}

type BoundedRequestResult =
  | { status: "ok"; request: Request }
  | { status: "too-large" }
  | { status: "unreadable" };

async function boundMcpRequestBody(
  request: Request,
): Promise<BoundedRequestResult> {
  if (request.method !== "POST" || request.body === null) {
    return { status: "ok", request };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_MCP_REQUEST_BYTES) {
        await reader.cancel();
        return { status: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    return { status: "unreadable" };
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { status: "ok", request: new Request(request, { body }) };
}

function unreadableResponse(): Response {
  return withCors(
    Response.json(
      { error: "MCP request body could not be read." },
      { status: 400 },
    ),
  );
}

async function handleMcpRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }
  if (hasOversizedContentLength(request)) return tooLargeResponse();
  const bounded = await boundMcpRequestBody(request);
  if (bounded.status === "too-large") return tooLargeResponse();
  if (bounded.status === "unreadable") return unreadableResponse();
  return withCors(await mcpHandler.fetch(bounded.request));
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === MCP_PATH) {
      return withNoIndex(await handleMcpRequest(request));
    }

    const response = await env.ASSETS.fetch(request);
    const isNoIndexRoute = [MCP_PATH, "/view", "/create"].some((path) =>
      isAtOrBelowPath(url.pathname, path),
    );
    return isNoIndexRoute ? withNoIndex(response) : response;
  },
};

export default worker;
