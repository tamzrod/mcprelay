/**
 * Downstream leg: an MCP server exposed to clients (OpenHands Cloud in Phase 4)
 * over Streamable HTTP.
 *
 * Phase 2: the downstream server handles `initialize`, `tools/list`, and
 * `tools/call`, forwarding list/call to the relay (and thus to the upstream).
 * It adds NO upstream-specific logic; whatever tools the upstream exposes are
 * advertised and invoked transparently.
 *
 * Stateless (no Mcp-Session-Id) for the prototype, matching the MVP-allowed
 * stateless path (D-08). A fresh McpServer is created per request (the SDK's
 * stateless pattern), while the relay/upstream client is long-lived and shared.
 */
import { createServer } from "node:http";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Relay } from "../relay/relay.js";

export interface DownstreamServer {
  url: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function createDownstreamServer(
  port: number,
  relay: Relay,
  host = "127.0.0.1",
): DownstreamServer {
  const url = `http://${host}:${port}/mcp`;

  // Factory: a fresh McpServer per request. The forwarding handlers close over
  // the long-lived relay; the server itself holds no per-session state.
  const getServer = () => {
    const mcp = new McpServer(
      { name: "mcprelay-connector", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );

    // initialize is handled by the Server base class automatically.

    // tools/list: forward the upstream's tool list verbatim.
    mcp.setRequestHandler(ListToolsRequestSchema, async () => {
      const forwarded = await relay.listTools();
      return { tools: forwarded.tools as never[] };
    });

    // tools/call: forward the call to the upstream by name. The connector does
    // not execute the tool itself.
    mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
      const result = (await relay.callTool(req.params.name, req.params.arguments as never)) as {
        content?: unknown;
        isError?: boolean;
      };
      return {
        content: (result?.content ?? []) as never,
        isError: result?.isError ?? false,
      } as never;
    });

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
