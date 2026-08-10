/**
 * MCP Connector entry point.
 *
 * Wires the three layers:
 *   downstream server (Streamable HTTP, toward the client)
 *     -> relay (transparent forwarding)
 *       -> upstream client (Streamable HTTP, toward Notion MCP)
 *
 * Phase 3: real authentication boundary.
 *   - Downstream: bearer connector API key (D-13), validated via scrypt.
 *   - Upstream: Notion OAuth via the AuthManager (D-10/D-11/D-12), bearer token
 *     attached upstream-side; refresh/rotation/invalid_grant managed here.
 *   - Credentials encrypted at rest in SQLite (D-10).
 *
 * Startup is grant-aware: the connector starts even if the operator has not
 * yet authorized (so it can serve /oauth/authorize); the upstream connection is
 * established lazily on first request once a grant exists.
 */
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { loadMasterKey, apiKeyFingerprint } from "./store/crypto.js";
import { createCredentialStore } from "./store/credential-store.js";
import { createAuthManager } from "./auth/auth-manager.js";
import { createUpstreamClient } from "./upstream/upstream-client.js";
import { createRelay } from "./relay/relay.js";
import { createDownstreamServer } from "./downstream/downstream-server.js";

const UPSTREAM_URL = process.env.MCPRELAY_UPSTREAM_URL ?? "http://127.0.0.1:8788/mcp";
const PORT = Number(process.env.MCPRELAY_PORT ?? "8789");
const HOST = process.env.MCPRELAY_HOST ?? "127.0.0.1";
const DB_PATH = process.env.MCPRELAY_DB_PATH ?? resolve("./data/connector.db");
// The connector's externally-reachable base URL (behind TLS reverse proxy). Used
// for the OAuth redirect_uri. Defaults to the listening address for local dev.
const PUBLIC_BASE_URL =
  process.env.MCPRELAY_PUBLIC_BASE_URL ?? `http://${HOST}:${PORT}`;
const CLIENT_NAME = process.env.MCPRELAY_OAUTH_CLIENT_NAME ?? "MCP Connector";
const NOTION_SCOPE = process.env.MCPRELAY_NOTION_SCOPE; // optional

function ensureDir(filePath: string): void {
  mkdirSync(resolve(filePath, ".."), { recursive: true });
}

async function main() {
  // D-10: load the master key (fail-fast if missing — never start unencrypted).
  const masterKey = loadMasterKey(process.env.MCPRELAY_MASTER_KEY);
  ensureDir(DB_PATH);
  const store = createCredentialStore(DB_PATH, masterKey);

  // D-13: provision the downstream API key from env (scrypt-hashed in store).
  const downstreamEnvKey = process.env.MCPRELAY_CONNECTOR_API_KEY;
  if (downstreamEnvKey) {
    if (!store.hasDownstreamKey()) {
      store.setDownstreamKey(downstreamEnvKey);
      console.log(`[connector] downstream API key provisioned (fingerprint ${apiKeyFingerprint(downstreamEnvKey)})`);
    } else if (!store.verifyDownstreamKey(downstreamEnvKey)) {
      // Env key differs from stored hash — operator rotated via env; re-store.
      store.setDownstreamKey(downstreamEnvKey);
      console.log(`[connector] downstream API key rotated (fingerprint ${apiKeyFingerprint(downstreamEnvKey)})`);
    }
  } else if (!store.hasDownstreamKey()) {
    console.warn(
      "[connector] WARNING: MCPRELAY_CONNECTOR_API_KEY not set and no key stored — downstream /mcp is UNGATED. Set it before production use.",
    );
  }

  const redirectUri = `${PUBLIC_BASE_URL}/oauth/callback`;
  const authConfig: {
    serverUrl: string;
    redirectUri: string;
    clientName: string;
    scope?: string;
  } = {
    serverUrl: UPSTREAM_URL,
    redirectUri,
    clientName: CLIENT_NAME,
  };
  if (NOTION_SCOPE) authConfig.scope = NOTION_SCOPE;
  const auth = createAuthManager(authConfig, store);

  // D-12: upstream client attaches the bearer token via a custom fetch and
  // does a single 401 → refresh → retry cycle.
  const upstream = createUpstreamClient({
    url: UPSTREAM_URL,
    getToken: () => auth.getAccessToken(),
    refreshOn401: () => auth.refreshOn401(),
  });
  const relay = createRelay(upstream);

  const downstream = createDownstreamServer({
    port: PORT,
    relay,
    host: HOST,
    verifyDownstreamKey: store.hasDownstreamKey()
      ? (k) => store.verifyDownstreamKey(k)
      : undefined,
    auth,
  });

  await downstream.start();
  console.log(`[connector] listening downstream at ${downstream.url}`);
  console.log(`[connector] OAuth authorize URL: ${PUBLIC_BASE_URL}/oauth/authorize`);
  console.log(`[connector] OAuth callback URL: ${redirectUri}`);

  // Connect upstream eagerly only if a grant already exists (restart survival);
  // otherwise wait for the operator to authorize, then connect lazily.
  if (auth.hasGrant()) {
    try {
      await upstream.connect();
      console.log(`[connector] connected to upstream at ${upstream.url} (grant active)`);
    } catch (err) {
      console.error(`[connector] upstream connect failed (will retry on demand): ${String(err)}`);
    }
  } else {
    console.log(
      "[connector] no Notion grant yet — operator must visit /oauth/authorize to authorize",
    );
  }

  const shutdown = async () => {
    try {
      await downstream.stop();
      await upstream.close();
      store.close();
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
