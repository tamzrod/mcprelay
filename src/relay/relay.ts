/**
 * Relay/forwarding core.
 *
 * Maps downstream MCP requests to upstream MCP calls transparently. The relay
 * holds NO upstream-specific business logic: it forwards whatever tools the
 * upstream exposes, and it invokes tools by name on the upstream. This is the
 * heart of the "transparent bridge" requirement (D-06/D-07).
 *
 * Phase 2: single upstream, no routing table, no authorization.
 */
import type { UpstreamClient } from "../upstream/upstream-client.js";

export interface ForwardedToolList {
  tools: unknown[];
}

export interface Relay {
  listTools: () => Promise<ForwardedToolList>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
}

export function createRelay(upstream: UpstreamClient): Relay {
  return {
    // Forward the upstream tool list verbatim. The connector advertises exactly
    // what the upstream exposes — no filtering, no renaming in Phase 2.
    listTools: async () => {
      const result = await upstream.listTools();
      return { tools: result.tools };
    },
    // Forward a tool call to the upstream by name. The connector does NOT
    // execute the tool itself; the request crosses the boundary to the upstream.
    callTool: async (name, args) => {
      return upstream.callTool({ name, arguments: args });
    },
  };
}
