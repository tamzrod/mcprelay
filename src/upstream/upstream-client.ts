/**
 * Upstream leg: an MCP client that connects to an upstream MCP server over
 * Streamable HTTP.
 *
 * Phase 2: connects to the mock upstream. No OAuth, no credentials. The
 * connector holds a single upstream connection and proxies through it.
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

export function createUpstreamClient(url: string): UpstreamClient {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const client = new Client(
    { name: "mcprelay-connector", version: "0.1.0" },
    { capabilities: {} },
  );

  let connected = false;

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
      return (await client.listTools()) as { tools: unknown[] };
    },
    callTool: async (params) => {
      return await client.callTool(params);
    },
    serverInfo: () => {
      const info = client.getServerVersion();
      return info;
    },
  };
}
