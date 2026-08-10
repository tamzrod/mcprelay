# AGENTS.md â€” MCP Connector repository memory

Repository-specific knowledge for the MCP Connector project. Loaded
automatically each session.

## Project state

- **Phase:** Phase 0 (architecture baseline) COMPLETE. **Phase 1 COMPLETE.**
  **Phase 2 COMPLETE (G4 = PASS).** **Phase 3 COMPLETE (G5 = PASS,
  2026-08-10).**   **Phase 4 IN PROGRESS — BLOCKED: OAuth callback failed (stale authorize
  URL); retry required (G6 BLOCKED, 2026-08-10).** The auth boundary holds: downstream bearer
  API-key gate; connector-hosted operator OAuth consent (`/oauth/authorize` +
  `/oauth/callback`); Notion OAuth lifecycle (discovery → DCR → PKCE → exchange
  → refresh → rotation → `invalid_grant` → restart survival) via the SDK's
  first-party helpers; encrypted SQLite credential store (AES-256-GCM, atomic
  rotation, per-grant mutex); authenticated upstream MCP connection via explicit
  bearer header + 401-refresh-retry; no upstream credentials ever reach the
  downstream client. Validated against a mock auth server (no real Notion
  credentials in tests). Evidence: docs/evidence/G5.md.
  **Phase 4 (G6) status:** the production Docker image was built (D-14) and the
  connector deployed behind the TLS work-host ingress with a persistent
  encrypted SQLite volume. Validated live: downstream bearer-`api_key` boundary
  (401 on missing/invalid), MCP `initialize` over TLS, OpenHands Cloud
  `api_key` configuration + connection, and the **real** Notion OAuth automated
  chain (RFC 9728 → RFC 8414 → RFC 7591 DCR → PKCE S256 → 302 authorize
  redirect). A human Notion consent was attempted but the callback **failed**
  with `state not found or already consumed` — the operator used a stale
  authorize URL whose single-use state was not in the current store; **no grant
  was persisted** (`notion_grant` empty). The connector's state mechanism was
  independently verified **correct** (correct-state callback passes the state
  check and proceeds to token exchange) → **operational failure, not a code
  defect**; no workaround applied. **10 of 16 G6 criteria PASS; 5 are BLOCKED
  on a successful consent (retry with a fresh `/oauth/authorize` URL); 1 is
  PARTIAL (restart mechanism verified, grant-survival pending consent).** Work
  STOPPED per Phase 4 instructions; Phase 5 not begun. The deployed connector
  remains live and ready to complete consent. Evidence: docs/evidence/G6.md.
  All three Phase 1 gates passed: **G1 = PASS** (OpenHands Cloud consumes a
  bearer `api_key` SHTTP MCP endpoint, no OAuth, no custom headers;
  docs/evidence/G1.md); **G2 = PASS** (Notion hosted MCP is OAuth 2.0 Auth Code
  + PKCE + DCR, browser-consent, OAuth-only; access token ~8h/use `expires_in`;
  refresh token rotates each refresh, 180-day absolute non-sliding cap or 30-day
  inactivity; `invalid_grant` terminal; docs/evidence/G2.md); **G3 = SUFFICIENT**
  (Notion hosted MCP exposes `notion-search`+`notion-fetch` for read,
  `notion-create-pages`/`notion-update-page` for create/update, and
  `notion-get-comments` for reading comments; docs/evidence/G3.md). **D-09 =
  DECIDED (2026-08-10):** TypeScript/Node.js + `@modelcontextprotocol/sdk`
  (server + client Streamable HTTP), first-party MCP OAuth client helpers in
  `@modelcontextprotocol/sdk/client/auth.js` (NO `openid-client` â€” SDK helpers
  are sufficient per D-12), **SQLite** credential store (field-level AES-256-GCM
  at rest, master key from `MCPRELAY_MASTER_KEY` env), deployed as a **Docker
  container** behind a TLS-terminating reverse proxy with a persistent volume.
  **Phase 3 entry decisions (2026-08-10):** D-10 (SQLite + field-level
  AES-256-GCM + env master key), D-11 (connector-hosted `/oauth/authorize` +
  `/oauth/callback` browser flow), D-12 (remain on SDK v1.30.0; native auth
  helpers; no `openid-client`; no transport `authProvider` auto-path â€” explicit
  bearer + managed refresh), stateful/stateless check (stateless sufficient for
  Notion; D-08 unchanged), D-13 (downstream bearer `api_key`, scrypt-hashed,
  `MCPRELAY_CONNECTOR_API_KEY`). Phase 2 exit gate satisfied; Phase 3 entry
  prerequisites satisfied; **Phase 3 implementation in progress (G5 not yet
  passed).**
- **Roadmap is a strict gated contract:** a later phase MUST NOT begin until the
  previous phase's exit gate is satisfied and documented. "Code exists" is not
  completion.
- **Repo name:** `mcprelay` (GitHub: tamzrod/mcprelay). The project is called
  **"MCP Connector"** (the original README said "MCP Relay"; README has been
  reconciled to "MCP Connector"). Do not rename the repo without instruction.
- **Existing files at design start:** `LICENSE`, an incomplete `README.md`
  (now completed/reconciled). Everything in `docs/` is newly authored.

## Documentation set (the deliverable of this phase)

- `README.md` â€” concise overview + doc index.
- `docs/PROBLEM.md` â€” the OpenHands Cloud â†” authenticated-remote-MCP gap.
- `docs/ARCHITECTURE.md` â€” components, boundaries, alternatives.
- `docs/AUTHENTICATION.md` â€” OAuth/credential handling; no upstream creds in sandbox.
- `docs/MCP-FLOW.md` â€” downstream/upstream MCP communication.
- `docs/ROADMAP.md` â€” phased plan (Phase 0â€“6).
- `docs/MILESTONES.md` â€” measurable milestones + acceptance criteria (M3 = MVP).
- `docs/RISKS.md` â€” technical/security/arch/ops/process risks.
- `docs/DECISIONS.md` â€” architectural decision records + rationale.

## Key confirmed facts (from official docs â€” cite, don't re-derive)

- MCP remote transport = **Streamable HTTP** (POST + optional GET SSE); the
  2024-11-05 HTTP+SSE transport is deprecated. `stdio` is local-only.
- MCP authorization = **OAuth 2.1 + PKCE**, RFC 9470 (Protected Resource
  Metadata) â†’ RFC 8414 (Authorization Server Metadata) discovery, optional
  RFC 7591 Dynamic Client Registration. Bearer token on every request; 401 on
  expired/invalid.
- **Notion hosted MCP** (`https://mcp.notion.com/mcp`) is **OAuth-only**, requires
  a human browser consent, explicitly **not** headless/bearer-auth. Built on
  Cloudflare `workers-oauth-provider`. ~18 page-level tools (no block editing,
  no file uploads).
- **OpenHands** supports OAuth MCP via FastMCP (tokens cached at
  `~/.fastmcp/oauth-mcp-client-cache/`) but its docs say OAuth MCP "may not be
  suitable for fully automated/headless workflows." Remote MCP config supports
  an `api_key` field; does **not** support arbitrary custom headers.

## Core design invariants (do not violate)

1. The connector is a **terminating MCP proxy/gateway** (D-01): MCP server
   downstream, MCP client upstream.
2. **Upstream credentials never reach the downstream client/sandbox** (D-02).
3. **No domain/business logic** (Notion-specific or otherwise) in the connector
   (D-03/D-07) â€” forward JSON-RPC transparently.
4. **MVP** = OpenHands Cloud securely accesses Notion MCP through the connector
   with no Notion credential in the OpenHands sandbox. MVP technical path
   validated at **G7 (M5)**; MVP complete at **G8 (M6)** (the full 10-step
   reproducible documentation loop). No generalization before G8.
5. Data model accommodates multi-tenancy now; multi-tenancy is built later (D-04).
6. **Strict gating:** G1/G2/G3 (Phase 1) MUST pass before any connector code
   (Phase 2). No phase begins until the previous exit gate is satisfied.

## Deferred decisions (resolve before the indicated gate)

- G1/G2/G3 (Phase 1, M1) â€” validate OpenHands Cloud `api_key` consumption,
  Notion OAuth token lifecycle, Notion tool surface. **G1 = PASS,
  G2 = PASS, G3 = SUFFICIENT (2026-08-10)**; all done.
- D-09 language/runtime + deploy target â€” **DECIDED (2026-08-10)**:
  TypeScript/Node.js + `@modelcontextprotocol/sdk`; SQLite creds; Docker +
  reverse-proxy TLS. Phase 1 COMPLETE; Phase 2 unblocked.
- D-10 credential-store backend + master key â€” **DECIDED (2026-08-10, Phase 3
  entry)**: SQLite (`better-sqlite3`) + field-level AES-256-GCM; master key from
  `MCPRELAY_MASTER_KEY` env (32-byte base64); fail-fast if absent. See
  docs/DECISIONS.md Â§D-10.
- D-11 operator OAuth consent UX â€” **DECIDED (2026-08-10, Phase 3 entry)**:
  connector-hosted browser flow (`/oauth/authorize` + `/oauth/callback`). See
  docs/DECISIONS.md Â§D-11.
- D-12 MCP SDK version + OAuth path â€” **DECIDED (2026-08-10, Phase 3 entry)**:
  remain on `@modelcontextprotocol/sdk` v1.30.0; use native `./client/auth.js`
  helpers; NO `openid-client`; NO transport `authProvider` auto-path. See
  docs/DECISIONS.md Â§D-12.
- D-13 downstream client auth boundary â€” **DECIDED (2026-08-10, Phase 3
  entry)**: bearer `api_key` (G1-compatible); scrypt-hashed in store;
  `MCPRELAY_CONNECTOR_API_KEY`; 401 on invalid. See docs/DECISIONS.md Â§D-13.
- Stateful/stateless check (Phase 3 entry) â€” **DECIDED (2026-08-10)**:
  stateless Streamable HTTP sufficient for Notion hosted MCP; D-08 unchanged.

## OpenHands Cloud â€” how it picks up MCP servers (G1 findings)

Confirmed experimentally 2026-08-10. Relevant for the connector's downstream
interface and for setting up any validation conversation:

- Cloud conversations read MCP config from **stored user settings**
  (`agent_settings.mcp_config`), NOT from a per-conversation override. A
  `POST /api/v1/app-conversations` body may include `agent_settings.mcp_config`
  and returns HTTP 202, but it is **silently ignored** â€” the agent sees no MCP
  tools. Set the config **before** starting the conversation.
- Settings are updated via `POST /api/v1/settings` with an
  **`agent_settings_diff`** payload (deep-merged). The legacy `agent_settings`
  key is rejected with HTTP 422 ("Use *_diff nested settings payloads instead
  of legacy keys").
- Stored MCP config uses the SDK dict shape, e.g.
  `{"shttp": {"url": "...", "api_key": "...", "enabled": true}}`. The server
  normalizes `api_key` to `auth: {strategy: "api_key", value: "***"}` â€” a
  first-class auth strategy distinct from OAuth.
- OpenHands transmits `api_key` to the MCP server as
  `Authorization: Bearer <key>`. No custom headers are supported/needed.
- Remote (SHTTP) tools are exposed to the agent under a transport-prefixed
  name, e.g. `shttp_<tool>` (`shttp_g1_test`), not the raw upstream name.
- Agent-server events: per-conversation runtime host + `X-Session-API-Key`
  come from the app-conversation record (`conversation_url`, `session_api_key`).
  Event search `sort_order` accepts `TIMESTAMP` (asc) or `TIMESTAMP_DESC`, NOT
  `TIMESTAMP_ASC`.

## Notion hosted MCP â€” OAuth lifecycle (G2 findings)

Confirmed from official Notion docs (developers.notion.com/guides/mcp/build-mcp-client)
2026-08-10. Authoritative for the connector's upstream credential subsystem:

- **Auth model:** OAuth 2.0 Authorization Code + PKCE (S256) + Dynamic Client
  Registration (RFC 7591). Built on Cloudflare `workers-oauth-provider`.
  **OAuth-only, browser-consent-based â€” no upstream API key** for the hosted
  MCP (`https://mcp.notion.com/mcp`; SSE alt `/sse`).
- **Discovery:** MCP 401 `WWW-Authenticate` â†’ `/.well-known/oauth-protected-resource`
  (RFC 9728) â†’ `/.well-known/oauth-authorization-server` (RFC 8414) â†’
  `registration_endpoint` (DCR).
- **DCR credentials (`client_id`/`client_secret`) MUST be persisted and reused**
  â€” re-registering orphans prior grants. CIMD is a supported alternative.
- **Access token:** ~8h, but "subject to change" â€” **always drive off
  `expires_in`**, never hardcode. Refresh 5â€“10 min before expiry.
- **Refresh token:** issued on every token response; **rotates on every refresh**
  (new `refresh_token` returned, old retired). Expires at whichever comes first:
  **180-day absolute cap from first authorization (does NOT slide)** or **30
  consecutive days of inactivity**. Next refresh then returns `invalid_grant`.
- **`invalid_grant` is terminal:** clear stored tokens, re-authorize, do NOT
  retry-loop. Also returned on client-credential mismatch, explicit
  revocation/policy, and **concurrent refreshes of the same grant** (losers).
- **Persistence requirements:** DCR creds + current `access_token`/`expires_in`
  + **latest rotated** `refresh_token` + `bot_id` + `owner`/workspace. Update
  `(access_token, refresh_token)` **atomically** on each rotation. **Serialize
  refresh per grant** (mutex/distributed lock).
- **Restart:** credentials survive restart **iff** DCR creds + latest rotated
  refresh token were durably persisted. Crash mid-rotation that loses the new
  refresh token kills the connection (old one retired) â†’ re-authorize.
- **Periodic reconnection is expected** (180-day cap / 30-day idle), not
  exceptional â€” consent UX must be easy to reach (validates D-11).
- Live confirmation of rotation/`invalid_grant` scheduled for **G5 (Phase 3)**.

## Notion hosted MCP â€” tool surface (G3 findings)

Confirmed from official Notion docs (developers.notion.com/guides/mcp/mcp-supported-tools)
2026-08-10. The hosted MCP at `https://mcp.notion.com/mcp` exposes the tools
the documentation workflow needs:

- **Read docs:** `notion-search` (search workspace + connected sources) +
  `notion-fetch` (retrieve page/database/data-source content by URL/ID, returned
  as enhanced "Notion-flavored" Markdown; `id: self` returns workspace + user
  identity).
- **Create docs:** `notion-create-pages` (page(s) under a page/database parent,
  title properties + Markdown `content`; supports `template_id` and
  `allow_async: true` + `notion-get-async-task` for large content).
- **Update docs:** `notion-update-page` (update properties/content/icon/cover;
  markdown commands include `replace_content` / `replace_content_range`;
  supports `apply_template`).
- **Read comments:** `notion-get-comments` (lists all comments/discussions on a
  page â€” block-level, inline, resolved threads, full content).
- **Create comment (optional):** `notion-create-comment` (page/block/reply).

**Gaps that do NOT block the stated workflow:** block-level surgical edits
absent (page-level markdown update is sufficient for docs); files/webhooks
absent; data-source querying (`notion-query-data-sources`,
`notion-query-meeting-notes`) is plan-gated (Enterprise + Notion AI). If
block-precise editing becomes a hard requirement later, the fallback is the
ARCHITECTURE.md Â§4-C path (open-source `makenotion/notion-mcp-server` or Notion
REST block API) â€” not a G3 failure.

**Implication for the connector:** forward Notion's tool list transparently
(intersection with connector mediation policy, D-06); forward markdown
payloads transparently (no content-shape transformation, D-07); advertise only
what the upstream exposes at runtime (discovery-driven, not hardcoded â€” tool
surface is not static). Live end-to-end exercise through the connector is a
**G7 (Phase 5)** target.

## D-09 stack decision (Phase 1, M1)

**DECIDED (2026-08-10).** Phase 2 implements this stack. Full rationale in
docs/DECISIONS.md Â§D-09.

- **Language/runtime:** TypeScript on Node.js (long-running single process).
- **MCP SDK:** official `@modelcontextprotocol/sdk` â€” `@modelcontextprotocol/server`
  (Streamable HTTP server, toward OpenHands) + `@modelcontextprotocol/client`
  (Streamable HTTP client, toward Notion); runtime middleware
  (`@modelcontextprotocol/node` / express / fastify / hono) as needed.
- **OAuth client:** SDK first-party MCP OAuth client helpers
  (`StreamableHTTPClientTransport` `authProvider`, auto-refresh) + `openid-client`
  (or `oauth`) for PKCE (S256) + Dynamic Client Registration (RFC 7591) +
  refresh/rotation where the helper is insufficient.
- **Credential persistence:** SQLite (single file, ACID) on a persistent mounted
  volume, encrypted at rest (master key from secrets manager / env; master-key
  source = D-10). SQLite transactions = atomic `(access_token, refresh_token)`
  rotation (G2 requirement). In-process per-grant mutex serializes refresh
  (G2 invariant: never refresh the same grant concurrently). Node's
  single-threaded event loop makes single-process serialization straightforward.
- **Deployment:** single long-running service in a Docker container on a
  VPS/cloud droplet, behind a reverse proxy terminating TLS (Caddy auto-TLS or
  Nginx), persistent volume for the SQLite store, restart via Docker restart
  policy. Secrets via env (dev) / secrets manager (prod), never in VCS.
- **Rejected:** Go (official Go SDK marks client-side OAuth "experimental" â€”
  the project's hardest requirement; excellent concurrency/deploy but wrong risk
  profile). Python (strong, proven in G1 via authlib; close-second fallback if
  TypeScript SDK issues surface; needs single-worker discipline for refresh
  serialization).

**Phase 2 scope (not yet started):** minimal connector skeleton in TypeScript
with `@modelcontextprotocol/sdk` (server + client Streamable HTTP) + a **mock
upstream** + downstream bearer-`api_key` interface (D-05, confirmed by G1).
Real Notion OAuth/DCR/refresh + SQLite credential store land in **Phase 3** (G2,
D-10, D-11).

## Research discipline

- Distinguish: **confirmed fact** (cited) / **observation** / **hypothesis** /
  **design proposal** / **unresolved question**. The docs already do this; keep
  it when editing.
- Do not present assumptions as facts. Re-verify any MCP/Notion/OpenHands
  protocol assumption against official docs before relying on it in code.

## Conventions for this repo

- Documentation is plain Markdown; diagrams are ASCII in fenced code blocks.
- Citations use Markdown reference-style footnotes (`[^id]: <url>`).
- Do not create implementation/code files yet. When implementation begins,
  choose language/runtime per D-09 and add build/test instructions here.
- Separation of responsibilities: GitHub=source of truth, OpenHands=agent,
  Notion=docs/stakeholders, Connector=connectivity only.

### Build / test (Phase 2 implementation, per D-09)

- **Runtime:** TypeScript on Node.js (`>=20.9`); repo tested with Node 22.
- **Build:** `npm run build` (tsc, `strict: true`, output in `dist/`).
- **Run mock upstream:** `npm run mock-upstream` (default `127.0.0.1:8788/mcp`,
  tool `g1_test`).
- **Run connector:** `npm run connector`
  (`MCPRELAY_UPSTREAM_URL`, `MCPRELAY_PORT`, `MCPRELAY_HOST` env; defaults
  `http://127.0.0.1:8788/mcp`, `8789`, `127.0.0.1`).
- **Tests:** `npm test` â€” `node --test dist/test/integration.test.js` (3 cases:
  initialize+list, call-through, no-extra-tools). Run `npm run build` first.
- **Smoke:** `npm run smoke` â€” direct (clientâ†’mock) and relay (clientâ†’connectorâ†’mock).
- **MCP SDK:** official `@modelcontextprotocol/sdk` 1.30.0 (ESM). Server side:
  `Server` + `StreamableHTTPServerTransport`. Client side: `Client` +
  `StreamableHTTPClientTransport`. State only in the relay/upstream client;
  the downstream HTTP server creates a fresh `McpServer` per request (stateless,
  D-08).
- **Phase boundaries:** `src/{downstream,upstream,relay,test}` + `connector.ts`.
  Keep the relay generic (no upstream business logic).

### Build / test / auth conventions (Phase 3 implementation, per D-10..D-13)

- **New dependencies:** `better-sqlite3` (synchronous SQLite, ACID rotation).
  The SDK's OAuth helpers (`@modelcontextprotocol/sdk/client/auth.js`) + its
  transitive `pkce-challenge` already provide PKCE S256 / DCR / refresh â€”
  **no `openid-client`** (D-12).
- **Credential store (D-10):** `better-sqlite3` single file at
  `MCPRELAY_DB_PATH` (default `./data/connector.db`); secrets encrypted
  field-level with AES-256-GCM keyed by `MCPRELAY_MASTER_KEY` (32-byte base64;
  fail-fast if missing). Atomic `(access_token, refresh_token)` rotation in one
  transaction; per-grant mutex serializes refresh (G2).
- **Downstream auth (D-13):** every downstream request needs
  `Authorization: Bearer <key>`; the key is scrypt-hashed in the store,
  provisioned from `MCPRELAY_CONNECTOR_API_KEY`; 401 on invalid. Never log the
  key (fingerprint only).
- **Operator OAuth (D-11):** connector serves `GET /oauth/authorize` (PKCE S256
  + state â†’ redirect to Notion) and `GET /oauth/callback` (validate state+PKCE,
  exchange, persist encrypted). Re-auth = revisit `/oauth/authorize`.
- **Upstream OAuth (D-12):** use the SDK's `discoverOAuthServerInfo`,
  `registerClient`, `startAuthorization`, `exchangeAuthorization`,
  `refreshAuthorization` + `OAuthClientProvider` backed by the store. Attach
  `Authorization: Bearer <token>` to upstream requests explicitly (NOT the
  transport `authProvider` auto-path). Proactive refresh before `expires_in`; on
  401 one refresh+retry; on `invalid_grant` (`InvalidGrantError`) mark
  `requires_reauth` terminal (clear tokens, no retry loop).
- **Security invariants (Phase 3):** never store OAuth tokens in source; never
  commit secrets; never log access/refresh tokens or the downstream key; never
  return upstream credentials through MCP; use test credentials only in tests.

### Build / deploy conventions (Phase 4, per D-14)

- **Production image:** `Dockerfile` (multi-stage, `node:22-bookworm-slim`):
  `docker build -t mcprelay:phase4 .`. Build stage compiles TS +
  `better-sqlite3`; runtime stage is non-root (`connector`, uid 1001),
  `VOLUME /data`, `EXPOSE 8789`, entrypoint `node dist/connector.js`. Secrets
  are runtime-env only (never baked). `.dockerignore` excludes `node_modules`,
  `dist`, `data/`, `.env`, `.git`.
- **Deploy:** `docker run -d --name mcprelay -p 12000:8789 -v <host>:/data`
  with env `MCPRELAY_MASTER_KEY` (32-byte base64, fail-fast),
  `MCPRELAY_CONNECTOR_API_KEY`, `MCPRELAY_UPSTREAM_URL=https://mcp.notion.com/mcp`,
  `MCPRELAY_PUBLIC_BASE_URL=<public TLS URL>`, `MCPRELAY_DB_PATH=/data/connector.db`,
  `MCPRELAY_HOST=0.0.0.0`. The work-host TLS ingress maps a public HTTPS URL to
  container port 8789 (the TLS reverse-proxy path required by D-09/D-14).
- **Operator Notion consent (one-time):** visit
  `<PUBLIC_BASE_URL>/oauth/authorize` in a browser → log in to Notion → approve
  → connector exchanges + persists the encrypted grant. Until this is done the
  connector starts grant-less (serves `/oauth/authorize`; upstream connects
  lazily) and `tools/list`/`tools/call` return `"Not connected"`. **This human
  step is the G6 blocker (RISKS O7) — not a code defect.**
- **Security invariants (Phase 4):** generate secrets at runtime
  (`openssl rand -base64 32` / `openssl rand -hex 24`); store raw secret values
  only in a mode-600 file **outside** the repo; never bake secrets into the
  image; verify with `git grep` + log greps that no master key / API key /
  token appears in logs, MCP responses, the DB file, or git (see G6 evidence).
