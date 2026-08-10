/**
 * Mock upstream MCP server.
 *
 * Phase 2 stand-in for a real authenticated upstream (Notion). Exposes a single
 * deterministic tool `g1_test` so the relay path can be exercised end-to-end
 * without any upstream business logic, OAuth, or credentials.
 *
 * Transport: Streamable HTTP, served via Node's http server, using the official
 * @modelcontextprotocol/sdk. Stateless (no Mcp-Session-Id) for the prototype.
 */
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export interface MockUpstream {
  url: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function createMockUpstream(port: number, host = "127.0.0.1"): MockUpstream {
  const url = `http://${host}:${port}/mcp`;

  // Factory: a fresh McpServer per request (stateless pattern from the SDK's
  // simpleStatelessStreamableHttp example). The same tool definition is
  // registered each time; it carries no per-server state.
  const getServer = () => {
    const mcp = new McpServer(
      { name: "mcprelay-mock-upstream", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    // Deterministic tool: echoes the provided message with a fixed prefix.
    // The name `g1_test` echoes the Phase 1 G1 validation milestone.
    mcp.tool(
      "g1_test",
      {
        message: z.string().describe("Text to echo back from the mock upstream."),
      },
      async (args) => {
        return {
          content: [{ type: "text", text: `[mock-upstream:g1_test] ${args.message}` }],
        };
      },
    );
    return mcp;
  };

  const httpServer = createServer(async (req, res) => {
    const mcp = getServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const parsedBody =
      req.method === "POST" ? JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") : undefined;
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
      res.on("close", () => {
        transport.close();
        mcp.close();
      });
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
      }
      res.end(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error", data: String(err) }, id: null }),
      );
    }
  });

  let listening = false;

  return {
    url,
    start: () =>
      new Promise<void>((resolve) => {
        httpServer.listen(port, host, () => {
          listening = true;
          resolve();
        });
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        if (!listening) return resolve();
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

// Allow running standalone: `npm run mock-upstream`
const isMain = process.argv[1] && process.argv[1].endsWith("mock-upstream.js");
if (isMain) {
  const port = Number(process.env.MOCK_UPSTREAM_PORT ?? "8788");
  const host = process.env.MOCK_UPSTREAM_HOST ?? "127.0.0.1";
  const upstream = createMockUpstream(port, host);
  upstream.start().then(() => {
    console.log(`[mock-upstream] listening at ${upstream.url} (tool: g1_test)`);
  });
  process.on("SIGINT", async () => {
    await upstream.stop();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await upstream.stop();
    process.exit(0);
  });
}
