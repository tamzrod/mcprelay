/**
 * Smoke test: client -> mock upstream directly (no connector).
 * Verifies the mock upstream's Streamable HTTP server works on its own.
 * Also runs the full relay: client -> connector -> mock upstream.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMockUpstream } from "./mock-upstream.js";
import { createUpstreamClient } from "../upstream/upstream-client.js";
import { createRelay } from "../relay/relay.js";
import { createDownstreamServer } from "../downstream/downstream-server.js";

async function direct() {
  const upstream = createMockUpstream(19101, "127.0.0.1");
  await upstream.start();
  console.log("[smoke] mock upstream at", upstream.url);
  const transport = new StreamableHTTPClientTransport(new URL(upstream.url));
  const client = new Client({ name: "smoke-client", version: "0.1.0" }, { capabilities: {} });
  console.log("[smoke] connecting client...");
  await client.connect(transport);
  console.log("[smoke] connected. listing tools...");
  const list = (await client.listTools()) as { tools: { name: string }[] };
  console.log("[smoke] tools:", list.tools.map((t) => t.name));
  const res = (await client.callTool({ name: "g1_test", arguments: { message: "smoke" } })) as {
    content: { type: string; text: string }[];
  };
  console.log("[smoke] result:", res.content[0].text);
  await transport.close();
  await upstream.stop();
  console.log("[smoke] direct done");
}

async function throughConnector() {
  const upstream = createMockUpstream(19201, "127.0.0.1");
  await upstream.start();
  const upstreamClient = createUpstreamClient(upstream.url);
  await upstreamClient.connect();
  const relay = createRelay(upstreamClient);
  const downstream = createDownstreamServer({ port: 19202, relay });
  await downstream.start();
  console.log("[smoke-connector] connector at", downstream.url, "upstream", upstream.url);

  const transport = new StreamableHTTPClientTransport(new URL(downstream.url));
  const client = new Client({ name: "smoke-connector-client", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  console.log("[smoke-connector] connected via connector. listing tools...");
  const list = (await client.listTools()) as { tools: { name: string }[] };
  console.log("[smoke-connector] tools:", list.tools.map((t) => t.name));
  const res = (await client.callTool({ name: "g1_test", arguments: { message: "through-connector" } })) as {
    content: { type: string; text: string }[];
  };
  console.log("[smoke-connector] result:", res.content[0].text);
  await transport.close();
  await downstream.stop();
  await upstreamClient.close();
  await upstream.stop();
  console.log("[smoke-connector] done");
}

await direct();
await throughConnector();

