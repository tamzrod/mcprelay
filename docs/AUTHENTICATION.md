# Authentication

> Status: **Design proposal.** This document investigates how upstream
> authentication (OAuth and API-key/bearer) should be handled **without
> exposing upstream credentials to the OpenHands sandbox**. See
> [DECISIONS.md](DECISIONS.md) for resolved choices and [RISKS.md](RISKS.md)
> for security risks.

## 1. Two separate authentication domains

The connector deliberately separates two authentication domains that must
never be conflated:

| Domain | Who authenticates | Mechanism (proposal) | Where credentials live |
| --- | --- | --- | --- |
| **Downstream** | The MCP client (OpenHands Cloud) → connector | Connector-issued API key / bearer | Connector (verifier); client holds only this key |
| **Upstream** | Connector → remote MCP server (Notion) | OAuth 2.1 + PKCE (Notion); or API-key/bearer where the upstream supports it | Connector's encrypted credential store |

**Invariant:** Upstream credentials never leave the connector. The downstream
client never sees, holds, or forwards a Notion OAuth token. It only ever
presents its connector API key to the connector.

## 2. Upstream: OAuth 2.1 (Notion)

### 2.1 Confirmed protocol requirements

- OAuth 2.1 with PKCE (mandatory for public clients). [^mcp-auth]
- Discovery via RFC 9470 (Protected Resource Metadata) → RFC 8414
  (Authorization Server Metadata). [^notion-build-client]
- Dynamic Client Registration (RFC 7591) where supported. [^mcp-auth]
- `Authorization: Bearer <token>` on **every** upstream request; 401 on
  expired/invalid tokens. [^mcp-auth]
- Notion's token lifecycle (built on Cloudflare's `workers-oauth-provider`):
  refresh ~5–10 minutes before expiry; on `invalid_grant` re-authenticate; on
  transient errors retry with backoff; cache access tokens with accurate
  expiry. [^notion-build-client]

### 2.2 The headless-consent problem

Notion's hosted MCP **requires a human to complete the OAuth consent in a
browser** and explicitly does not support bearer-token/headless auth. [^notion-mcp]
The connector resolves this by separating *who performs consent* from *who
uses the token*:

1. An **operator** (a human, once) performs the Notion OAuth consent against
   the **connector's own OAuth client** (the connector hosts the callback URL).
2. The connector exchanges the authorization code for access/refresh tokens and
   stores them encrypted.
3. From then on, **headless** downstream callers use the connector, which
   attaches the cached/refreshed upstream token transparently.

This is the central authentication design of the project: the interactive step
happens once, at the connector, by a human operator — never inside the agent.

### 2.3 Token lifecycle handling (proposal)

- **Store:** access token, refresh token, absolute expiry, scopes, and the
  Notion workspace/user the token authorizes. Encrypt at rest.
- **Refresh:** proactively refresh before expiry (with a safety margin);
  refresh on receiving a 401 from upstream before retrying once; on
  `invalid_grant` mark the credential as `requires_reauth` and surface a
  clear error (the agent should not silently retry forever).
- **Concurrency:** serialize refresh per credential to avoid thundering-herd
  refresh races (one refresh wins, others reuse the new token).
- **Audience/scope:** keep the token audience/scopes as granted by Notion; do
  not attempt to broaden them.

## 3. Upstream: API key / bearer (non-OAuth upstreams)

For upstreams that accept a static API key or bearer token (e.g. a self-hosted
MCP server, or GitHub-style tokens where applicable):

- The connector stores the key encrypted, attaches it as the upstream auth
  header, and rotates it through the same credential-store mechanism.
- No OAuth flow, consent, or refresh is needed, but the same isolation
  invariant applies: the key never reaches the downstream client.

## 4. Downstream: connector → client auth

### 4.1 MVP proposal

- The connector exposes its MCP endpoint and authenticates the downstream
  client with a **connector-issued API key** sent as a bearer header.
- This maps cleanly onto OpenHands's documented remote-MCP config, which
  supports an `api_key` field for SHTTP/SSE servers. [^oh-mcp-settings]
- OpenHands's MCP config has a **known limitation**: it supports `api_key` but
  does not support arbitrary custom headers. [^oh-headers] A bearer API key is
  therefore the most compatible choice for the downstream side.

### 4.2 Why not OAuth downstream (for MVP)?

- The whole point is to give the cloud agent a **non-interactive** endpoint.
  Adding OAuth downstream reintroduces the consent problem for the agent.
- A connector API key is simple, compatible, and sufficient for the single-user
  MVP. Per-client OAuth downstream can be revisited for multi-tenant cases.

## 5. Credential storage and security

### 5.1 Confirmed requirements

- Never store secrets in version control. [^sec]
- Least privilege; validate/sanitize inputs; secure error reporting; never
  expose sensitive data in error messages. [^sec]

### 5.2 Proposal

- **At rest:** credentials encrypted with a master key from a secrets manager
  / KMS / environment-injected key (exact backend TBD — see open questions).
- **In memory:** tokens held only as long as needed; never logged; never
  returned in tool results or error messages. Redact tokens in logs.
- **Access:** only the auth-manager component reads/writes the store.
- **Audit:** record *that* a credential was used, by whom, for which upstream
  — never the credential value itself.
- **Rotation:** support rotating the master key and individual credentials
  without downtime.

## 6. Authorization boundary between downstream and upstream

- A downstream caller authenticated with connector key K may use only the
  upstreams/credentials that K is authorized for. The router enforces this.
- MVP: one key, one upstream (Notion). The data model is `(downstream_key →
  upstream_credential)` so multi-tenant extension is additive, not a rewrite
  (see [DECISIONS.md](DECISIONS.md) D-04).

## 7. Failure handling

- **401 upstream:** attempt one refresh+retry; if still failing, return a clear
  MCP error to the client indicating upstream auth failure (no token leaked).
- **Network/transport failure:** retry with backoff, then surface a
  structured error. Do not hang the downstream session indefinitely.
- **Reauth required:** the connector reports a distinct, actionable state so
  an operator can re-run the consent flow.

## 8. Logging and auditing

- Log: timestamp, downstream principal (key id, not the secret), upstream
  name, tool/method, outcome, latency.
- Never log: tokens, refresh tokens, client secrets, authorization codes,
  Notion workspace tokens, or full tool arguments that may contain secrets
  (hash or redact sensitive arguments).
- Audit log is append-only and retained per a policy (TBD).

## 9. Open authentication questions

- Credential-store backend and master-key source (KMS vs. local secret vs.
  env-injected). [^sec]
- How the operator performs the initial Notion consent: a connector-hosted
  `/authorize`/callback page vs. an out-of-band CLI flow.
- Whether Notion's refresh token is long-lived and revocable, and how the
  connector survives a token that cannot be refreshed.
- Exact downstream auth semantics (single shared key vs. per-client keys) and
  key-issuance/rotation workflow.

## References

[^mcp-auth]: MCP spec — Authorization (2025-06-18): https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
[^notion-mcp]: Notion — Connect to Notion MCP (OAuth-only, no headless bearer): https://developers.notion.com/guides/mcp/get-started-with-mcp
[^notion-build-client]: Notion — Build an MCP client (RFC 9470/8414, token lifecycle): https://developers.notion.com/guides/mcp/build-mcp-client
[^oh-mcp-settings]: OpenHands — MCP settings (api_key support, OAuth headless caveat): https://docs.openhands.dev/openhands/usage/settings/mcp-settings
[^oh-headers]: Observation that OpenHands MCP config supports `api_key` but not arbitrary custom headers — via third-party OpenHands routing guide (corroborates official `api_key` field): https://maybedont.ai/docs/agents/mcp/openhands
[^sec]: OpenHands security skill guidance: least privilege, no secrets in VCS, validate inputs, secure error reporting.
