# MCP and automation

The Worker exposes an unauthenticated, stateless Streamable HTTP MCP endpoint at `/mcp`.

## Tools

- `wordcloud-inspect` returns metadata, ranked counts, and layout status for an existing V URL or fragment.
- `wordcloud-render-svg` returns SVG for a validated scene in an existing V URL or fragment.
- `wordcloud-generate-from-text` accepts `sourceText` and tokenizer options, then returns SVG, a reproducible V fragment, and summary data.

The inspect and render tools accept only V data; they do not fetch remote URLs. The generator is the only tool that accepts source text. It sends that text to the Worker for the request, processes it in memory, and does not persist or log it. The returned SVG and V data contain derived terms. Because the endpoint has no authentication, do not send sensitive source text or word lists to it.

Generation is limited to 32 KiB of source text and 100 unique terms. The Worker rejects MCP request bodies larger than 64 KiB. The complete HTTP and JSON-RPC contract, schemas, examples, and errors are documented in [`openapi.yaml`](../openapi.yaml).
