/**
 * MCP Connector entry point.
 *
 * Wires the three layers:
 *   downstream server (Streamable HTTP, toward the client)
 *     -> relay (transparent forwarding)
 *       -> upstream client (Streamable HTTP, toward the mock upstream)
 *
 * Phase 2: no OAuth, no credential store, no multi-user, single upstream.
 */
import { createUpstreamClient } from "./upstream/upstream-client.js";
import { createRelay } from "./relay/relay.js";
import { createDownstreamServer } from "./downstream/downstream-server.js";

const UPSTREAM_URL = process.env.MCPRELAY_UPSTREAM_URL ?? "http://127.0.0.1:8788/mcp";
const PORT = Number(process.env.MCPRELAY_PORT ?? "8789");
const HOST = process.env.MCPRELAY_HOST ?? "127.0.0.1";

const upstream = createUpstreamClient(UPSTREAM_URL);
const relay = createRelay(upstream);
const downstream = createDownstreamServer(PORT, relay, HOST);

async function main() {
  await upstream.connect();
  console.log(`[connector] connected to upstream at ${upstream.url}`);

  await downstream.start();
  console.log(`[connector] listening downstream at ${downstream.url}`);

  const shutdown = async () => {
    try {
      await downstream.stop();
      await upstream.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[connector] fatal:", err);
  process.exit(1);
});
