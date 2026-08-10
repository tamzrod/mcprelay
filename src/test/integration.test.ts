/**
 * Phase 2 integration test.
 *
 * Proves the full relay path end-to-end:
 *   MCP Client -> Connector (downstream) -> Relay -> Upstream client -> Mock upstream
 *
 * The downstream client connects to the connector over Streamable HTTP, then:
 *   1. initializes (connect() performs the initialize handshake),
 *   2. discovers the upstream tool via tools/list,
 *   3. invokes the upstream tool via tools/call,
 *   4. receives the upstream result unchanged.
 *
 * Run with: node --test dist/test/integration.test.js  (after `npm run build`)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMockUpstream } from "./mock-upstream.js";
import { createUpstreamClient } from "../upstream/upstream-client.js";
import { createRelay } from "../relay/relay.js";
import { createDownstreamServer } from "../downstream/downstream-server.js";

interface Harness {
  connectorUrl: string;
  upstreamUrl: string;
  stop: () => Promise<void>;
}

async function startHarness(upstreamPort: number, connectorPort: number): Promise<Harness> {
  const upstream = createMockUpstream(upstreamPort);
  await upstream.start();

  const upstreamClient = createUpstreamClient(upstream.url);
  await upstreamClient.connect();
  const relay = createRelay(upstreamClient);
  const downstream = createDownstreamServer({ port: connectorPort, relay });
  await downstream.start();

  return {
    connectorUrl: downstream.url,
    upstreamUrl: upstream.url,
    stop: async () => {
      await downstream.stop();
      await upstreamClient.close();
      await upstream.stop();
    },
  };
}

test("relay: initialize + tools/list discovers g1_test through the connector", async () => {
  const harness = await startHarness(18801, 18802);
  try {
    const transport = new StreamableHTTPClientTransport(new URL(harness.connectorUrl));
    const client = new Client({ name: "integration-test-client", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);

    const listResult = (await client.listTools()) as { tools: { name: string; description?: string }[] };
    const names = listResult.tools.map((t) => t.name);
    assert.ok(names.includes("g1_test"), `tools/list must include g1_test; got: ${JSON.stringify(names)}`);

    await transport.close();
  } finally {
    await harness.stop();
  }
});

test("relay: tools/call reaches the mock upstream and returns its result unchanged", async () => {
  const harness = await startHarness(18803, 18804);
  try {
    const transport = new StreamableHTTPClientTransport(new URL(harness.connectorUrl));
    const client = new Client({ name: "integration-test-client", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);

    const result = (await client.callTool({ name: "g1_test", arguments: { message: "hello-relay" } })) as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };

    assert.equal(result.isError, false, "tool call must not report an error");
    assert.ok(result.content && result.content.length > 0, "result must have content");
    assert.equal(result.content[0].type, "text");
    // The connector must NOT execute the tool — the result must carry the
    // mock-upstream's distinctive prefix, proving the call crossed the boundary.
    assert.equal(
      result.content[0].text,
      "[mock-upstream:g1_test] hello-relay",
      "result must be the mock upstream's echoed response, unchanged",
    );

    await transport.close();
  } finally {
    await harness.stop();
  }
});

test("relay: connector advertises only what the upstream exposes (no extra tools)", async () => {
  const harness = await startHarness(18805, 18806);
  try {
    const transport = new StreamableHTTPClientTransport(new URL(harness.connectorUrl));
    const client = new Client({ name: "integration-test-client", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);

    const listResult = (await client.listTools()) as { tools: { name: string }[] };
    const names = listResult.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["g1_test"], "connector must forward only the upstream tools, no additions");

    await transport.close();
  } finally {
    await harness.stop();
  }
});
