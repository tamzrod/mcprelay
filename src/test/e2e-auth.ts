/**
 * End-to-end smoke driver for Phase 3 (G5).
 *
 * Starts a mock OAuth authorization server + authenticated MCP upstream, then
 * starts the real connector (connector.ts) pointed at it, and drives the full
 * operator OAuth flow + an authenticated downstream MCP call. Validates the
 * auth boundary holds end-to-end with NO real Notion credentials.
 *
 * Run: MCPRELAY_MASTER_KEY=<base64-32> MCPRELAY_CONNECTOR_API_KEY=<key> \
 *      node dist/test/e2e-auth.js
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMockAuthServer } from "./mock-auth-server.js";
import { loadMasterKey } from "../store/crypto.js";
import { createCredentialStore } from "../store/credential-store.js";
import { createAuthManager } from "../auth/auth-manager.js";
import { createUpstreamClient } from "../upstream/upstream-client.js";
import { createRelay } from "../relay/relay.js";
import { createDownstreamServer } from "../downstream/downstream-server.js";

async function main() {
  const masterKey = loadMasterKey(process.env.MCPRELAY_MASTER_KEY);
  const apiKey = process.env.MCPRELAY_CONNECTOR_API_KEY ?? "e2e-key-" + randomBytes(8).toString("hex");
  const dir = mkdtempSync(join(tmpdir(), "mcprelay-e2e-"));
  const dbPath = join(dir, "e2e.db");

  const mockAuth = createMockAuthServer({ port: 18800, accessTokenTtlSec: 8 * 3600 });
  await mockAuth.start();
  console.log(`[e2e] mock auth server at ${mockAuth.baseUrl}`);

  const store = createCredentialStore(dbPath, masterKey);
  store.setDownstreamKey(apiKey);
  const auth = createAuthManager(
    { serverUrl: mockAuth.baseUrl, redirectUri: "http://127.0.0.1:18801/oauth/callback", clientName: "e2e-connector" },
    store,
  );
  const upstream = createUpstreamClient({
    url: mockAuth.baseUrl,
    getToken: () => auth.getAccessToken(),
    refreshOn401: () => auth.refreshOn401(),
  });
  const relay = createRelay(upstream);
  const downstream = createDownstreamServer({
    port: 18801,
    relay,
    verifyDownstreamKey: (k) => store.verifyDownstreamKey(k),
    auth,
  });
  await downstream.start();
  console.log(`[e2e] connector at ${downstream.url}`);

  // 1. Health: no grant yet.
  let health = (await (await fetch(`http://127.0.0.1:18801/health`)).json()) as {
    upstream_grant: { status: string };
  };
  console.log("[e2e] health (pre-auth):", JSON.stringify(health));
  if (health.upstream_grant.status !== "absent") throw new Error("expected absent grant pre-auth");

  // 2. Unauthorized downstream request → 401.
  let res = await fetch(downstream.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", params: {}, id: 1 }),
  });
  console.log(`[e2e] unauthorized (no key) → HTTP ${res.status}`);
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);

  res = await fetch(downstream.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer wrong-key" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", params: {}, id: 1 }),
  });
  console.log(`[e2e] unauthorized (bad key) → HTTP ${res.status}`);
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);

  // 3. Operator OAuth: GET /oauth/authorize → redirects to mock auth /authorize,
  //    which redirects to the connector /oauth/callback?code=...&state=...
  //    Follow the chain manually to extract code+state.
  const authRes = await fetch(`http://127.0.0.1:18801/oauth/authorize`, { redirect: "manual" });
  console.log(`[e2e] /oauth/authorize → HTTP ${authRes.status} (redirect to mock)`);
  const mockAuthorizeUrl = authRes.headers.get("location");
  if (!mockAuthorizeUrl) throw new Error("authorize did not redirect to mock auth");
  // Follow the mock auth /authorize redirect (it 302s to /oauth/callback).
  const mockAuthRes = await fetch(mockAuthorizeUrl, { redirect: "manual" });
  const location = mockAuthRes.headers.get("location");
  if (!location) throw new Error("mock authorize did not redirect to callback");
  const cb = new URL(location);
  const code = cb.searchParams.get("code");
  const state = cb.searchParams.get("state");
  if (!code || !state) throw new Error("authorize redirect missing code/state");

  // 4. Complete OAuth: GET /oauth/callback.
  const cbRes = await fetch(`http://127.0.0.1:18801/oauth/callback?code=${code}&state=${state}`);
  const cbBody = await cbRes.json();
  console.log(`[e2e] /oauth/callback → HTTP ${cbRes.status}:`, JSON.stringify(cbBody));
  if (cbRes.status !== 200) throw new Error("callback failed");

  // 5. Health: grant now active.
  health = (await (await fetch(`http://127.0.0.1:18801/health`)).json()) as {
    upstream_grant: { status: string };
  };
  console.log("[e2e] health (post-auth):", JSON.stringify(health));
  if (health.upstream_grant.status !== "active") throw new Error("expected active grant post-auth");

  // 6. Connect upstream + make an authenticated downstream MCP call.
  await upstream.connect();
  const transport = new StreamableHTTPClientTransport(new URL(downstream.url), {
    requestInit: { headers: { authorization: `Bearer ${apiKey}` } },
  });
  const client = new Client({ name: "e2e-client", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  const tools = (await client.listTools()) as { tools: { name: string }[] };
  console.log("[e2e] downstream tools:", tools.tools.map((t) => t.name));
  if (!tools.tools.some((t) => t.name === "notion_echo")) throw new Error("notion_echo not listed");

  const call = (await client.callTool({ name: "notion_echo", arguments: { message: "e2e-end-to-end" } })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  console.log("[e2e] callTool result:", call.content[0].text);
  if (call.content[0].text !== "[mock-notion:echo] e2e-end-to-end") throw new Error("unexpected echo");

  // 7. No credential leak.
  const serialized = JSON.stringify(call);
  const grant = store.getGrant()!;
  if (serialized.includes(grant.access_token) || serialized.includes(grant.refresh_token)) {
    throw new Error("CREDENTIAL LEAK: token in downstream response");
  }
  console.log("[e2e] no credential leak in downstream response ✓");

  await transport.close();
  await downstream.stop();
  await upstream.close();
  store.close();
  await mockAuth.close();
  rmSync(dir, { recursive: true, force: true });
  console.log("[e2e] ALL CHECKS PASSED — Phase 3 auth boundary holds end-to-end.");
}

main().catch((err) => {
  console.error("[e2e] FAILED:", err);
  process.exit(1);
});
