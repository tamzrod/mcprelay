/**
 * Upstream leg: an MCP client that connects to an upstream MCP server over
 * Streamable HTTP.
 *
 * Phase 3: authenticates to the upstream by attaching `Authorization:
 * Bearer <token>` (the refreshed Notion access token from the AuthManager) on
 * every request via a custom `fetch` wrapper, and performs a single 401 →
 * refresh → retry cycle. It does NOT use the transport's `authProvider`
 * auto-path (D-12): the connector controls refresh / serialization /
 * `invalid_grant` itself so a downstream tool call either succeeds or returns a
 * structured reauth-required error.
 *
 * The bearer header is injected per request via the custom fetch (not static
 * `requestInit.headers`) because the access token rotates on refresh.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface UpstreamClient {
  url: string;
  connect: () => Promise<void>;
  close: () => Promise<void>;
  listTools: () => Promise<{ tools: unknown[] }>;
  callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
  serverInfo: () => unknown;
}

/**
 * A function returning the current valid access token (refreshing if needed).
 * Throws ReauthRequiredError when the grant is terminal.
 */
export type TokenProvider = () => Promise<string>;

export interface UpstreamClientOptions {
  url: string;
  /** Provides the current access token; throws if reauth is required. */
  getToken?: TokenProvider;
  /**
   * Called when the upstream returns 401, to perform one refresh+retry cycle.
   * Implementations serialize refresh per grant (G2). Throws if reauth required.
   */
  refreshOn401?: () => Promise<string>;
}

export function createUpstreamClient(url: string): UpstreamClient;
export function createUpstreamClient(opts: UpstreamClientOptions): UpstreamClient;
export function createUpstreamClient(urlOrOpts: string | UpstreamClientOptions): UpstreamClient {
  const opts: UpstreamClientOptions =
    typeof urlOrOpts === "string" ? { url: urlOrOpts } : urlOrOpts;
  const { url, getToken, refreshOn401 } = opts;

  // Custom fetch: inject the (rotating) bearer token on every outgoing request.
  // The SDK merges requestInit.headers statically, so a fetch wrapper is the
  // correct mechanism for a token that changes on refresh.
  const fetchWithAuth: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (getToken) {
      const token = await getToken();
      headers.set("authorization", `Bearer ${token}`);
    }
    return fetch(input, { ...init, headers });
  };

  const transport = new StreamableHTTPClientTransport(new URL(url), { fetch: fetchWithAuth });
  const client = new Client(
    { name: "mcprelay-connector", version: "0.1.0" },
    { capabilities: {} },
  );

  let connected = false;

  /**
   * Run an MCP operation; if it fails with a 401-class error and a refresh
   * hook is configured, refresh once and retry the operation exactly once.
   */
  async function withRefreshRetry<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (is401(err) && refreshOn401) {
        await refreshOn401(); // serializes per grant; throws ReauthRequiredError if terminal
        return op();
      }
      throw err;
    }
  }

  return {
    url,
    connect: async () => {
      if (connected) return;
      await client.connect(transport);
      connected = true;
    },
    close: async () => {
      if (!connected) return;
      await transport.close();
      connected = false;
    },
    listTools: async () => {
      const doList = () => client.listTools() as Promise<{ tools: unknown[] }>;
      return withRefreshRetry(doList);
    },
    callTool: async (params) => {
      const doCall = () => client.callTool(params) as Promise<unknown>;
      return withRefreshRetry(doCall);
    },
    serverInfo: () => {
      const info = client.getServerVersion();
      return info;
    },
  };
}

/**
 * Heuristic: did an upstream MCP operation fail due to a 401? The SDK throws
 * `StreamableHTTPError(code=401, ...)` for non-OK POST responses, or
 * `UnauthorizedError` from the auth path. Match both without importing the
 * (error-typed) classes to avoid coupling.
 */
function is401(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: number | string; statusCode?: number; message?: string; name?: string };
  if (e.name === "UnauthorizedError") return true;
  const code = typeof e.code === "number" ? e.code : Number(e.code);
  if (code === 401) return true;
  if (typeof e.statusCode === "number" && e.statusCode === 401) return true;
  return /401|unauthorized/i.test(e.message ?? "");
}
