/**
 * Downstream leg: an MCP server exposed to clients (OpenHands Cloud in Phase 4)
 * over Streamable HTTP.
 *
 * Phase 3: the downstream server:
 *   - authenticates every MCP request with a connector bearer API key (D-13):
 *     `Authorization: Bearer <key>`; missing/invalid → HTTP 401;
 *   - serves the operator OAuth consent flow (D-11): `GET /oauth/authorize`
 *     (redirect to Notion) + `GET /oauth/callback` (exchange + persist);
 *   - exposes `GET /health` (grant status, no secrets) for the operator;
 *   - forwards `initialize`/`tools/list`/`tools/call` to the relay (and thus to
 *     the authenticated upstream). It adds NO upstream-specific logic.
 *
 * Stateless (no Mcp-Session-Id) downstream, matching the MVP-allowed stateless
 * path (D-08). A fresh McpServer is created per request; the relay/upstream
 * client is long-lived and shared.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Relay } from "../relay/relay.js";
import type { AuthManager } from "../auth/auth-manager.js";
import { ReauthRequiredError } from "../auth/auth-manager.js";
import { apiKeyFingerprint } from "../store/crypto.js";

export interface DownstreamServer {
  url: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface DownstreamServerDeps {
  port: number;
  relay: Relay;
  host?: string;
  /** Validates a downstream bearer API key (D-13). */
  verifyDownstreamKey?: (key: string) => boolean;
  /** OAuth manager for the operator consent flow + upstream token (D-11/D-12). */
  auth?: AuthManager;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (!res.headersSent) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
  }
  res.end(JSON.stringify(body));
}

export function createDownstreamServer(deps: DownstreamServerDeps): DownstreamServer {
  const { port, relay, host = "127.0.0.1", verifyDownstreamKey, auth } = deps;
  const url = `http://${host}:${port}/mcp`;

  // Factory: a fresh McpServer per request. The forwarding handlers close over
  // the long-lived relay; the server itself holds no per-session state.
  const getServer = () => {
    const mcp = new McpServer(
      { name: "mcprelay-connector", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );

    // tools/list: forward the upstream's tool list verbatim.
    mcp.setRequestHandler(ListToolsRequestSchema, async () => {
      const forwarded = await relay.listTools();
      return { tools: forwarded.tools as never[] };
    });

    // tools/call: forward the call to the upstream by name. If the upstream
    // auth grant is terminal, surface a structured reauth-required error (no
    // token leak).
    mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
      try {
        const result = (await relay.callTool(req.params.name, req.params.arguments as never)) as {
          content?: unknown;
          isError?: boolean;
        };
        return {
          content: (result?.content ?? []) as never,
          isError: result?.isError ?? false,
        } as never;
      } catch (err) {
        if (err instanceof ReauthRequiredError) {
          return {
            content: [
              {
                type: "text",
                text: "Upstream re-authorization required. An operator must authorize the connector to access Notion.",
              },
            ],
            isError: true,
          } as never;
        }
        throw err;
      }
    });

    return mcp;
  };

  /**
   * D-13: enforce the downstream bearer API key on MCP requests. Returns the
   * extracted key on success, or null if missing/invalid (caller sends 401).
   * The key is never logged — only its fingerprint is, and only on accept.
   */
  function authenticate(req: IncomingMessage): string | null {
    if (!verifyDownstreamKey) return "unauthenticated"; // no gate configured (tests)
    const header = req.headers["authorization"];
    if (typeof header !== "string") return null;
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) return null;
    const key = match[1];
    if (!verifyDownstreamKey(key)) return null;
    console.log(`[connector] downstream auth ok key=${apiKeyFingerprint(key)}`);
    return key;
  }

  const httpServer = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", `http://${host}`).pathname;

    // --- Operator OAuth consent flow (D-11) ---
    if (path === "/oauth/authorize" && req.method === "GET" && auth) {
      try {
        const start = await auth.beginAuthorization();
        res.statusCode = 302;
        res.setHeader("location", start.authorizationUrl);
        res.end();
      } catch (err) {
        console.error("[connector] /oauth/authorize failed:", String(err));
        sendJson(res, 500, { error: "authorization_start_failed" });
      }
      return;
    }

    if (path === "/oauth/callback" && req.method === "GET" && auth) {
      const cbUrl = new URL(req.url ?? "/", `http://${host}`);
      const code = cbUrl.searchParams.get("code");
      const state = cbUrl.searchParams.get("state");
      const errParam = cbUrl.searchParams.get("error");
      if (errParam) {
        sendJson(res, 400, { error: "oauth_error", error_description: errParam });
        return;
      }
      if (!code || !state) {
        sendJson(res, 400, { error: "missing_code_or_state" });
        return;
      }
      try {
        await auth.completeAuthorization(state, code);
        sendJson(res, 200, { status: "authorized", message: "Notion OAuth completed. Tokens stored encrypted." });
      } catch (err) {
        console.error("[connector] /oauth/callback failed:", String(err));
        if (err instanceof ReauthRequiredError) {
          sendJson(res, 400, { error: "invalid_state", error_description: String(err) });
        } else {
          sendJson(res, 500, { error: "authorization_complete_failed" });
        }
      }
      return;
    }

    // --- Health / grant status (no secrets) ---
    if (path === "/health" && req.method === "GET") {
      const gs = auth ? auth.grantState() : { status: "absent" };
      sendJson(res, 200, {
        status: "ok",
        upstream_grant: gs,
        downstream_key_configured: !!verifyDownstreamKey,
      });
      return;
    }

    // --- MCP endpoint (D-13 gated) ---
    if (path === "/mcp") {
      const key = authenticate(req);
      if (key === null) {
        res.setHeader("www-authenticate", 'Bearer realm="mcprelay"');
        sendJson(res, 401, { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
        return;
      }

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
      return;
    }

    sendJson(res, 404, { error: "not_found", path });
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
