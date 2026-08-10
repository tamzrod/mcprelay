/**
 * Mock OAuth authorization server + authenticated upstream MCP (Phase 3 test
 * harness).
 *
 * Stands in for Notion's hosted MCP + its authorization server so the full
 * G2 lifecycle can be exercised WITHOUT real Notion credentials (which must
 * never appear in test fixtures per the Phase 3 security requirements):
 *   - RFC 9728 protected-resource metadata + RFC 8414 authorization-server
 *     metadata (the discovery chain the SDK's discoverOAuthServerInfo follows);
 *   - RFC 7591 dynamic client registration;
 *   - authorization endpoint (redirects back with code+state);
 *   - token endpoint (authorization_code → tokens; refresh_token → rotated
 *     tokens; returns invalid_grant when the grant is revoked);
 *   - an authenticated MCP upstream that requires `Authorization: Bearer
 *     <access_token>` and returns 401 otherwise.
 *
 * The mock is in-process (http.Server) so tests can drive it deterministically,
 * including token expiry, rotation, revocation, and concurrent refresh. All
 * tokens are random throwaway values — never real credentials.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export interface MockAuthServerOptions {
  port: number;
  host?: string;
  /** Access-token TTL in seconds (default 8h like Notion, but tests shrink it). */
  accessTokenTtlSec?: number;
}

export interface MockAuthServer {
  baseUrl: string; // the MCP resource URL (also the OAuth-protected resource)
  authServerUrl: string; // the authorization server base URL
  start: () => Promise<void>;
  /** Revoke the current grant → next refresh returns invalid_grant. */
  revokeGrant(): void;
  /** Whether the refresh endpoint has been called (for concurrency tests). */
  refreshCallCount(): number;
  close(): Promise<void>;
}

export function createMockAuthServer(opts: MockAuthServerOptions): MockAuthServer {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port;
  const ttl = opts.accessTokenTtlSec ?? 8 * 3600;
  const baseUrl = `http://${host}:${port}/mcp`;
  const authServerUrl = `http://${host}:${port}`;

  // Registered client (from DCR).
  let clientId = "mock-client-" + randomBytes(4).toString("hex");
  let clientSecret: string | undefined;
  // PKCE + state captured at authorize (code → verifier).
  const codeToVerifier = new Map<string, string>();
  const codeToRedirect = new Map<string, string>();
  // Current grant.
  let grantActive = true;
  let currentAccessToken: string | null = null;
  let currentRefreshToken: string | null = null;
  let tokenExpiresAt = 0;
  let refreshes = 0;

  function newAccessToken(): string {
    return "at_" + randomBytes(12).toString("hex");
  }
  function newRefreshToken(): string {
    return "rt_" + randomBytes(12).toString("hex");
  }

  const httpServer: Server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", `http://${host}:${port}`);
    const path = u.pathname;

    // --- RFC 9728: protected resource metadata ---
    if (path === "/.well-known/oauth-protected-resource") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          resource: baseUrl,
          authorization_servers: [authServerUrl],
          bearer_methods_supported: ["header"],
        }),
      );
      return;
    }

    // --- RFC 8414: authorization server metadata ---
    if (path === "/.well-known/oauth-authorization-server") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          issuer: authServerUrl,
          authorization_endpoint: `${authServerUrl}/authorize`,
          token_endpoint: `${authServerUrl}/token`,
          registration_endpoint: `${authServerUrl}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
        }),
      );
      return;
    }

    // --- RFC 7591: dynamic client registration ---
    if (path === "/register" && req.method === "POST") {
      readBody(req).then((body) => {
        const meta = JSON.parse(body || "{}");
        // Honor the redirect_uris the client sent; reuse our client_id.
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            token_endpoint_auth_method: "none",
            redirect_uris: meta.redirect_uris ?? [`${authServerUrl}/callback`],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            client_name: meta.client_name ?? "mock-client",
          }),
        );
      });
      return;
    }

    // --- Authorization endpoint: redirect back with code+state ---
    if (path === "/authorize" && req.method === "GET") {
      const redirectUri = u.searchParams.get("redirect_uri") ?? "";
      const state = u.searchParams.get("state") ?? "";
      const code = "code_" + randomBytes(8).toString("hex");
      codeToVerifier.set(code, "pending"); // verifier comes via token exchange
      codeToRedirect.set(code, redirectUri);
      const cb = new URL(redirectUri);
      cb.searchParams.set("code", code);
      cb.searchParams.set("state", state);
      res.statusCode = 302;
      res.setHeader("location", cb.toString());
      res.end();
      return;
    }

    // --- Token endpoint: authorization_code grant + refresh_token grant ---
    if (path === "/token" && req.method === "POST") {
      readBody(req).then((body) => {
        const params = new URLSearchParams(body);
        const grantType = params.get("grant_type");
        res.setHeader("content-type", "application/json");
        if (grantType === "authorization_code") {
          const code = params.get("code") ?? "";
          // Issue a fresh grant.
          grantActive = true;
          currentAccessToken = newAccessToken();
          currentRefreshToken = newRefreshToken();
          tokenExpiresAt = Date.now() + ttl * 1000;
          res.end(
            JSON.stringify({
              access_token: currentAccessToken,
              token_type: "Bearer",
              expires_in: ttl,
              refresh_token: currentRefreshToken,
              scope: params.get("scope") ?? "",
              bot_id: "bot_mock",
              owner: { type: "user", user: { id: "user_mock" } },
            }),
          );
          return;
        }
        if (grantType === "refresh_token") {
          refreshes++;
          const rt = params.get("refresh_token") ?? "";
          if (!grantActive || rt !== currentRefreshToken) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "invalid_grant" }));
            return;
          }
          // Rotate: new access + new refresh.
          currentAccessToken = newAccessToken();
          currentRefreshToken = newRefreshToken();
          tokenExpiresAt = Date.now() + ttl * 1000;
          res.end(
            JSON.stringify({
              access_token: currentAccessToken,
              token_type: "Bearer",
              expires_in: ttl,
              refresh_token: currentRefreshToken,
            }),
          );
          return;
        }
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "unsupported_grant_type" }));
      });
      return;
    }

    // --- Authenticated MCP upstream ---
    if (path === "/mcp") {
      const auth = req.headers["authorization"];
      const tok = typeof auth === "string" ? /^Bearer\s+(.+)$/i.exec(auth)?.[1] : undefined;
      if (!tok || tok !== currentAccessToken || Date.now() >= tokenExpiresAt) {
        res.statusCode = 401;
        res.setHeader("www-authenticate", `Bearer resource_metadata="${authServerUrl}/.well-known/oauth-protected-resource"`);
        res.end(JSON.stringify({ error: "invalid_token" }));
        return;
      }
      // Serve a stateless MCP upstream with one tool.
      const mcp = new McpServer(
        { name: "mock-auth-upstream", version: "0.1.0" },
        { capabilities: { tools: {} } },
      );
      mcp.tool(
        "notion_echo",
        { message: z.string().describe("Text to echo back.") },
        async (args) => ({
          content: [{ type: "text", text: `[mock-notion:echo] ${args.message}` }],
        }),
      );
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      readBody(req).then((body) => {
        const parsed = body ? JSON.parse(body) : undefined;
        mcp.connect(transport).then(() => {
          transport.handleRequest(req as never, res as never, parsed);
          res.on("close", () => {
            transport.close();
            mcp.close();
          });
        });
      });
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found", path }));
  });

  return {
    baseUrl,
    authServerUrl,
    start() {
      return new Promise<void>((resolve) => {
        httpServer.listen(port, host, () => resolve());
      });
    },
    revokeGrant() {
      grantActive = false;
      currentAccessToken = null;
      currentRefreshToken = null;
    },
    refreshCallCount() {
      return refreshes;
    },
    close() {
      return new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    },
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  return (async () => {
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  })();
}
