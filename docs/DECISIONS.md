# Architectural Decisions

> Status: **Decision records.** Each entry records a decision, its rationale,
> and its status. Some are **resolved**; some are **proposed** pending
> implementation-time confirmation; some are **deferred**. Claim types follow the
> research discipline: confirmed facts are cited; proposals and open questions
> are labeled.

## D-01 — Connector is a terminating MCP proxy/gateway (not a pass-through proxy, not a client-side library, not a domain re-implementation)

- **Status:** Resolved (design).
- **Context:** Alternatives considered in [ARCHITECTURE.md](ARCHITECTURE.md) §4:
  (A) HTTP pass-through proxy; (B) client does OAuth itself; (C) connector
  re-implements upstream tools via REST; (D) client-embedded library; (E)
  terminating MCP proxy/gateway.
- **Decision:** Adopt **(E) terminating MCP proxy/gateway**. The connector
  terminates both MCP legs, mediates `initialize`/capability negotiation, owns
  upstream auth, and forwards JSON-RPC transparently.
- **Rationale:** Only (E) simultaneously (a) hides interactive upstream OAuth
  behind a stable, simply-authenticated endpoint usable by a headless cloud
  agent; (b) keeps upstream credentials out of the client sandbox; (c) mediates
  protocol/capability negotiation correctly; (d) generalizes to multiple
  upstreams without domain logic. The simpler alternatives each fail at least
  one of the project's hard requirements.
- **Trade-offs:** More state and complexity than a pass-through proxy; the
  connector becomes a security-critical, operable service. Accepted because the
  credential-isolation and headless-auth requirements mandate it.

## D-02 — Upstream auth is owned entirely by the connector; downstream client never sees upstream credentials

- **Status:** Resolved (design).
- **Context:** The core motivation is keeping Notion OAuth tokens out of the
  OpenHands sandbox.
- **Decision:** Upstream credentials live only in the connector's encrypted
  store and are attached upstream-side. The downstream client authenticates to
  the connector with a connector-issued key only.
- **Rationale:** This is the defining invariant of the project; everything else
  follows from it. Confirmed: Notion is OAuth-only and not headless-friendly;
  OpenHands caches OAuth tokens client-side, which we want to avoid.
  ([PROBLEM.md](PROBLEM.md))
- **Consequences:** The connector is a trust boundary and a high-value target
  (see [RISKS.md](RISKS.md) S1–S7).

## D-03 — Notion is the first upstream and the initial validation target, but the connector is Notion-agnostic

- **Status:** Resolved (design).
- **Context:** The brief requires Notion as the primary use case but a
  general-purpose architecture.
- **Decision:** Build the Notion path first (Phase 2–4) but forbid
  Notion-specific tool/business logic in the connector. Generalize to a second
  upstream with a different auth scheme in Phase 5.
- **Rationale:** Validates the hardest case (interactive OAuth + headless
  client) early while keeping the architecture general. Any Notion-specific need
  (e.g. REST fallback for block editing) would be a *separate* upstream
  adapter, not connector logic (see [ARCHITECTURE.md](ARCHITECTURE.md) §4-C).

## D-04 — Data model accommodates multi-tenancy from the start; multi-tenancy is implemented later

- **Status:** Resolved (design).
- **Decision:** Credentials and routing are keyed by `(downstream principal →
  upstream credential)`. MVP uses a single shared connector key and a single
  Notion credential, but the model is `(key → credential)`, not hardcoded.
- **Rationale:** Avoids a rewrite when multi-tenant support arrives (Phase 5/6),
  without paying its complexity now. Isolation tests come in Phase 6.

## D-05 — Downstream auth for MVP is a connector API key (bearer), not OAuth

- **Status:** Resolved (design).
- **Context:** OpenHands MCP config supports an `api_key` field for remote
  servers and is documented as not ideal for interactive OAuth in headless
  flows. ([AUTHENTICATION.md](AUTHENTICATION.md) §4)
- **Decision:** Authenticate downstream callers with a connector-issued bearer
  API key. Defer per-client keys and downstream OAuth to Phase 6.
- **Rationale:** Non-interactive (the point of the connector), compatible with
  OpenHands's documented config, and simple enough for the MVP.
- **Open item:** Confirm OpenHands Cloud specifically accepts a bearer
  `api_key` with no custom headers *(verify at M3)*.

## D-06 — Capability advertisement is the mediated intersection of connector + upstream

- **Status:** Resolved (design).
- **Decision:** Downstream `*/list` returns what upstream advertises, filtered
  to what the connector can mediate, namespaced only when multiple upstreams
  are configured.
- **Rationale:** Avoids advertising capabilities an upstream cannot fulfill and
  keeps single-upstream tool names pass-through (no client breakage). See
  [MCP-FLOW.md](MCP-FLOW.md) §5, §9.

## D-07 — Forwarding is transparent at the JSON-RPC level; the connector rewrites only what protocol bridging requires

- **Status:** Resolved (design).
- **Decision:** Method names, params, and result shapes pass through
  unchanged (modulo namespacing). Only session IDs, capability negotiation, and
  the upstream bearer token (added upstream-side) are mediated.
- **Rationale:** Preserves the "no domain logic" principle and keeps the
  connector generic.

## D-08 — MVP may run stateless (no SSE) where MCP allows; SSE streaming is additive

- **Status:** **Confirmed (2026-08-10, G4; re-confirmed 2026-08-10, Phase 3
  stateful/stateless check).** Stateless Streamable HTTP works for both legs.
- **Context:** SSE adds session/stickiness complexity.
- **Decision:** For the MVP, support request/response `tools/call` without
  requiring SSE streaming; support `GET` SSE (and resumption) as a Phase 8
  enhancement.
- **Rationale:** The initial use case (list/call Notion tools) does not require
  server-initiated streaming. Reduces state complexity for the MVP.
- **Phase 3 re-confirmation (stateful/stateless check):** Before committing the
  real Notion upstream design, the question "does Notion's hosted MCP require
  stateful Streamable HTTP / SSE notifications / long-lived upstream sessions?"
  was checked against official Notion docs ([^notion-build-client]) and the MCP
  Streamable HTTP spec:
  - Notion's hosted MCP supports Streamable HTTP (recommended) **and** an SSE
    fallback; both carry the same MCP protocol + OAuth. Notion's own TypeScript
    client example connects with `StreamableHTTPClientTransport` +
    `client.connect()` and performs request/response `tools/call`; it does not
    require the client to maintain a session for tool calls.
  - MCP Streamable HTTP sessions are **optional** (a stateless server sets
    `sessionIdGenerator: undefined`); `GET` SSE for server-initiated messages is
    **optional**. The documentation-workflow operations (`notion-search`,
    `notion-fetch`, `notion-create-pages`, `notion-update-page`,
    `notion-get-comments`) are all synchronous request/response `tools/call`.
  - No evidence that Notion sends server-initiated notifications the connector
    must consume, or requires a long-lived upstream session beyond the
    request/response tool calls.
  - **Conclusion:** stateless Streamable HTTP is **sufficient** for the Notion
    upstream. No change to D-08; the downstream interface is not redesigned.
- **Implementation note (Phase 3):** the upstream `StreamableHTTPClientTransport`
  is used **without** the SDK's `authProvider` auto-path. The connector attaches
  `Authorization: Bearer <token>` explicitly (refreshed token) and manages
  refresh/serialization/`invalid_grant` itself (see D-12). This keeps the
  error/serialization semantics under the connector's control rather than the
  SDK's throw-`UnauthorizedError`-and-redirect semantic, which does not fit the
  headless-forwarding model.

## D-09 — Implementation language/runtime and deployment target

- **Status:** **DECIDED (2026-08-10).** Selected during Phase 1 (M1) after G1/G2/G3
  passed. Unblocks Phase 2.
- **Selected stack:**
  - **Language/runtime:** **TypeScript on Node.js** (long-running single process).
  - **MCP SDK:** official **`@modelcontextprotocol/sdk`** — `@modelcontextprotocol/server`
    (Streamable HTTP server transport toward OpenHands) **and**
    `@modelcontextprotocol/client` (Streamable HTTP client transport toward Notion),
    plus runtime middleware (`@modelcontextprotocol/node` / express / fastify / hono
    as needed).
  - **OAuth client:** the SDK's **first-party MCP OAuth client helpers** in
    `@modelcontextprotocol/sdk/client/auth.js` (`auth`, `registerClient`,
    `startAuthorization`, `exchangeAuthorization`, `refreshAuthorization`,
    `discoverOAuthServerInfo`) cover the full G2 OAuth requirement set (Auth Code
    + PKCE S256 + DCR + refresh + rotation + `invalid_grant`). **Per D-12
    (re-evaluated at Phase 3 entry), `openid-client` is NOT added** — the SDK's
    helpers are sufficient, so no supplemental OAuth library is needed. The
    transport's `authProvider` auto-path is **not** used for the upstream leg;
    the connector attaches `Authorization: Bearer <token>` explicitly and
    manages refresh/serialization/`invalid_grant` itself (D-08 implementation
    note, D-12).
  - **Credential persistence:** **SQLite** (single file, ACID) on a persistent
    mounted volume, **encrypted at rest** with a master key from a secrets manager
    (prod) / environment injection (dev). SQLite transactions provide the
    **atomic** `(access_token, refresh_token)` write G2 requires; in-process
    **per-grant mutex** serializes refresh. (Master-key source is D-10.)
  - **Deployment target:** **single long-running service in a Docker container** on
    a VPS/cloud droplet, behind a **reverse proxy terminating TLS** (Caddy for
    auto-TLS, or Nginx), with a **persistent volume** for the SQLite credential
    store. **Restart via Docker restart policy** (or a process supervisor). Secrets
    injected via environment (dev) / secrets manager (prod) — never in VCS.
- **Rationale:**
  1. The connector's single hardest, most uncertain requirement is acting as an
     **OAuth 2.0 client** (Auth Code + PKCE + DCR + refresh-token rotation) toward
     Notion (per G2). The **TypeScript SDK is the reference MCP SDK** and has
     **first-party OAuth client helpers** (`authProvider` auto-refresh) purpose-built
     for exactly this. Notion's own "Build an MCP client for Notion" guide is written
     in TypeScript. This minimizes risk on the project's load-bearing requirement.
  2. The SDK is a **monorepo covering both server and client** with Streamable HTTP
     transports and runtime middleware (express/fastify/hono/node) — ideal for a relay
     that is simultaneously an MCP server (to OpenHands) and an MCP client (to Notion).
  3. Node's **single-threaded event-loop** model makes in-process **per-grant refresh
     serialization** straightforward for a single-process gateway (the concurrency
     invariant G2 requires: never refresh the same grant concurrently).
  4. SQLite gives ACID atomic rotation and restart survival with minimal operational
     surface, matching Notion's "use a database for storing tokens" guidance and the
     AUTH §5 / RISKS O-series requirements.
  5. The long-running container model is the simplest path for SSE + OAuth callback
     hosting (the D-09 option ARCHITECTURE.md favored), and is reachable by OpenHands
     Cloud over the Internet behind a TLS-terminating reverse proxy.
- **Rejected alternatives:**
  - **Go (`modelcontextprotocol/go-sdk`):** Excellent concurrency (`singleflight` for
    serialized refresh) and the best deploy story (static binary, tiny image). **Rejected
    because the official Go SDK marks client-side OAuth as "experimental support"** —
    the connector's hardest, load-bearing requirement. Too high a risk for this project.
    (Go SDK also reached stable Streamable HTTP latest of the three.)
  - **Python (`modelcontextprotocol/python-sdk` v2):** Strong — proven end-to-end with
    the MCP SDK in the G1 validation, and `authlib`/`requests-oauthlib` give mature
    OAuth2 + PKCE + DCR (Notion's docs explicitly recommend this path). **Rejected as a
    close second** in favor of TypeScript's first-party MCP OAuth helpers, richer
    runtime middleware, and reference-SDK maturity. Python remains a documented fallback
    if TypeScript SDK issues surface. (Python also needs single-worker deployment
    discipline to preserve refresh serialization.)
- **Constraint check:** Preserves the existing architecture — transparent MCP relay
  (D-06/D-07 forwarding), upstream-credential isolation (D-02, AUTH §5), long-running
  service for SSE + callback hosting, encrypted-at-rest credential store with rotation
  support (RISKS S2/O5). Adds **no** multi-user support and **no** extra upstream
  services. Generalization to multiple upstreams remains architectural (D-06/D-07) and
  is not expanded by this decision.
- **Implications for Phase 2:** Phase 2 implements the minimal connector skeleton in
  TypeScript with `@modelcontextprotocol/sdk` (server + client Streamable HTTP), a mock
  upstream, and the downstream bearer-`api_key` interface (D-05, confirmed by G1). The
  real upstream OAuth/DCR/refresh and SQLite credential store land in **Phase 3** (per
  G2/D-10/D-11). D-09 fixes only the stack; it does not implement it.

## D-10 — Credential-store backend and master-key source (Phase 3 entry)

- **Status:** **DECIDED (2026-08-10)** — Phase 3 entry (M3). Resolves the
  deferred D-10 using G2 evidence (token-lifecycle requirements).
- **Decision:**
  - **Backend:** **SQLite** (single file, via `better-sqlite3` — synchronous,
    ACID). Confirmed by D-09. Synchronous transactions make the G2 atomic
    `(access_token, refresh_token)` rotation trivially correct and race-free.
  - **Location / persistent volume:** a single file whose path is configurable
    via `MCPRELAY_DB_PATH` (dev default `./data/connector.db`; in Docker, a
    persistent mounted volume, e.g. `/data/connector.db`). The file must be on a
    persistent volume so credentials survive restart.
  - **Encryption-at-rest mechanism:** **field-level AES-256-GCM** (Node
    `crypto`). Each secret value (`access_token`, `refresh_token`,
    `client_secret`) is encrypted with the master key + a per-value random 12-byte
    IV; the ciphertext + IV + 16-byte auth tag are stored together. Non-secret
    metadata (`client_id`, `bot_id`, `owner`, `expires_at`, `created_at`,
    `updated_at`, status) is stored in plaintext so it can be queried without
    decryption. Field-level (not full-DB SQLCipher) is chosen for: simpler build
    (no native SQLCipher binding / separate full-DB key), ability to query
    metadata, and key-scoped-to-secrets-only.
  - **Master-key source:** **environment-injected secret**
    `MCPRELAY_MASTER_KEY` — a 32-byte (256-bit) random value, base64-encoded
    (generated once by the operator, e.g. `openssl rand -base64 32`). Dev: env.
    Prod (single Docker service on VPS): env injected at container start from the
    operator's secrets mechanism (Docker secret / VPS secrets manager / env not
    in VCS). This is the **simplest** approach that satisfies "encrypt at rest,
    key survives restart, never in VCS" for the single-Docker-service MVP.
  - **Master key survives restart:** the key lives in the environment (injected
    at each container start); the encrypted SQLite file lives on the persistent
    volume. Both persist across restart. **The connector never writes the master
    key to disk.**
  - **Credential rotation without data loss:** field-level encryption makes
    re-encryption straightforward. A rotation operation reads all rows, decrypts
    with the old key, re-encrypts with the new key, in a single transaction. This
    is **documented as a procedure** for the MVP; full automated rotation tooling
    is Phase 8 hardening (RISKS O5). The design does not preclude it.
  - **Master key unavailable:** the connector **fails fast** at startup with a
    clear error if `MCPRELAY_MASTER_KEY` is missing/empty/wrong-length. It must
    **never** start in a degraded/unencrypted mode.
  - **Backup/recovery:** the encrypted SQLite file **and** the master key are
    **both** required to recover credentials. Back up the volume (the encrypted
    file backs up safely). Back up the master key **separately** (secrets
    manager). Losing either is, by design, data loss — that is the security
    property (an attacker with the file alone gets ciphertext only).
  - **Refresh serialization:** an in-process per-grant mutex serializes refresh
    (G2 invariant: never refresh the same grant concurrently). Node's
    single-threaded event loop makes single-process serialization
    straightforward (D-09).
- **Rejected alternatives:**
  - **Full-DB SQLCipher:** requires a native binding + a separate full-DB key
    model; heavier for the MVP and complicates metadata queries. Field-level
    AES-256-GCM is sufficient and simpler.
  - **KMS / Vault-managed master key:** adds an external dependency and
    operational complexity unjustified for a single-Docker-service MVP. Defer to
    Phase 8 hardening (RISKS O5). The env-injected key does not preclude a KMS
    source later (the source of `MCPRELAY_MASTER_KEY` can be a KMS in prod).
  - **Plaintext store:** rejected outright — violates RISKS S2 and the project's
    core security invariants.
- **Constraint check:** Never store secrets in VCS ✓; encrypt at rest ✓; atomic
  rotation ✓ (SQLite transaction); serialized refresh ✓ (per-grant mutex);
  rotation without data loss ✓ (re-encryption procedure documented); fail-fast
  on missing key ✓ (RISKS S2, O5).

## D-11 — Operator OAuth consent UX (Phase 3 entry)

- **Status:** **DECIDED (2026-08-10)** — Phase 3 entry (M3). Resolves the
  deferred D-11 using G2 evidence + D-09 deployment target.
- **Decision:** **Connector-hosted browser flow.** The connector itself serves:
  - `GET /oauth/authorize` — generates PKCE verifier/challenge (S256) + `state`,
    persists them short-lived, and redirects the operator's browser to Notion's
    authorization endpoint.
  - `GET /oauth/callback` — Notion redirects here with `code` + `state`; the
    connector validates `state` + PKCE, exchanges the code for tokens, and
    **persists the DCR credentials + tokens encrypted at rest** (D-10).
  - The operator authorizes by **visiting the connector's `/oauth/authorize` URL
    in a browser** (one human action, once). Re-authorization (the expected
    180-day/30-day periodic reconnect per G2) is the same action again — easy to
    reach, satisfying the G2 "consent UX must be easy to reach" requirement.
- **Rationale:**
  - The connector is a **long-running Docker service behind a TLS-terminating
    reverse proxy** (D-09) — it has a stable, reachable URL, so it can host the
    callback. Notion's OAuth is **browser-consent-based** (G2); the operator is a
    human with a browser. Hosting the flow on the connector is the natural fit.
  - Tokens **never leave the connector**: the callback is handled server-side;
    the connector exchanges the code and stores the result. No token
    copy-paste, no token transiting the operator's machine beyond the OAuth
    exchange itself.
  - The `state` parameter binds the callback to the initiated flow (CSRF
    protection, RISKS S7); the `redirect_uri` is allowlisted to the connector's
    own `/oauth/callback` path (open-redirect protection, RISKS S7).
- **Rejected alternative — out-of-band CLI:** a local CLI that performs the flow
  with a `localhost` callback then injects tokens into the connector store. More
  moving parts (a separate CLI + a token-injection path), tokens transit the
  operator's machine, and manual injection risks. Worse fit for a deployed
  service. Rejected for the MVP.
- **Constraint check:** browser-consent satisfied (G2) ✓; tokens stay
  connector-side (D-02) ✓; re-auth reachable (G2 periodic reconnect) ✓; CSRF /
  open-redirect mitigated (RISKS S7) ✓.

## D-12 — MCP SDK package/version and OAuth implementation path (Phase 3 entry)

- **Status:** **DECIDED (2026-08-10)** — Phase 3 entry (M3). Re-evaluates the
  Phase-2 SDK decision against the actual G2 OAuth requirements before any auth
  code is written.
- **Decision:**
  1. **Remain on the combined `@modelcontextprotocol/sdk` v1.30.0.** Do not move
     to the split v2 packages.
  2. **Use the SDK's native OAuth client helpers** in
     `@modelcontextprotocol/sdk/client/auth.js` — `auth`, `registerClient`,
     `startAuthorization`, `exchangeAuthorization`, `refreshAuthorization`,
     `discoverOAuthServerInfo` — backed by an `OAuthClientProvider`
     implementation that persists to the encrypted SQLite store (D-10).
  3. **Do NOT add `openid-client` (or any supplemental OAuth library).** The SDK
     helpers are sufficient (evidenced below). This also drops the D-09
     "supplement with openid-client" proposal.
  4. **Do NOT use the transport's `authProvider` auto-path for the upstream
     leg.** The connector attaches `Authorization: Bearer <token>` explicitly
     via `requestInit` (refreshed token) and manages refresh / serialization /
     `invalid_grant` itself. (Rationale below.)
- **Evidence (inspected in `node_modules/@modelcontextprotocol/sdk` v1.30.0):**
  - `./client/auth.js` ships a **complete** first-party OAuth client:
    - `discoverOAuthServerInfo()` — RFC 9728 (Protected Resource Metadata) →
      RFC 8414 (Authorization Server Metadata) discovery (the G2 discovery
      chain).
    - `registerClient()` — RFC 7591 Dynamic Client Registration (G2 DCR).
    - `startAuthorization()` — generates a PKCE **S256** challenge (via
      `pkce-challenge` 5.0.1: SHA-256 + base64url) and sets
      `code_challenge_method=S256`; constructs the authorization URL (G2 PKCE).
    - `exchangeAuthorization()` — authorization code → tokens (G2 exchange).
    - `refreshAuthorization()` — refresh-token grant; **preserves the original
      `refresh_token` if a new one is not returned** (handles Notion's rotation:
      a returned new token overrides; absence keeps the old) (G2 rotation).
    - `auth(provider, …)` — orchestrates the full flow.
    - `OAuthClientProvider` interface — pluggable persistence
      (`tokens()`, `saveTokens()`, `clientInformation()`,
      `saveClientInformation()`, `codeVerifier()`, `saveCodeVerifier()`,
      `saveDiscoveryState()`, `invalidateCredentials()`) — backed by the
      encrypted store (D-10) for restart survival.
  - `./server/auth/errors.js` ships `InvalidGrantError`
    (`errorCode === "invalid_grant"`) and the full OAuth error hierarchy — the
    connector detects the terminal `invalid_grant` condition directly (G2).
  - These cover **every** G2 requirement: Auth Code ✓, PKCE S256 ✓, DCR ✓,
    access-token expiry (proactive refresh via `refreshAuthorization`) ✓,
    rotating refresh tokens ✓, refresh-token persistence (provider → store) ✓,
    refresh failure / `invalid_grant` (`InvalidGrantError`) ✓, restart survival
    (provider backed by durable encrypted store) ✓.
- **Why not the transport `authProvider` auto-path:** the SDK's
  `StreamableHTTPClientTransport({ authProvider })` auto-refreshs on 401 and, on
  refresh failure / no token, calls `redirectToAuthorization` and throws
  `UnauthorizedError` — a semantic that expects a human to complete a browser
  flow. That does **not** fit the connector's headless-forwarding model: a
  downstream tool call must either succeed (after a refresh) or return a
  structured `reauth-required` MCP error, not throw-and-wait-for-browser. By
  attaching the bearer token explicitly and managing refresh itself, the
  connector keeps full control of the G2 invariants (atomic rotation
  persistence, per-grant serialization, terminal `invalid_grant` → reauth state)
  and of the error surface toward the downstream client. The SDK's
  **functions** (proven PKCE/DCR/refresh crypto correctness) are still used.
- **Why not v2 split packages:** v1.30.0 combined package already provides the
  full OAuth surface above. Upgrading to a fresh major mid-auth adds migration
  risk with no benefit. Not taken.
- **Constraint check:** No change to architecture (D-01..D-08). The stateless
  path (D-08) is preserved; the upstream leg attaches a bearer header per
  request. `openid-client` is not added (fewer dependencies, single source of
  MCP-OAuth truth).

## D-13 — Downstream client authentication boundary (Phase 3 entry)

- **Status:** **DECIDED (2026-08-10)** — Phase 3 entry (M3). Defines the
  production downstream auth boundary validated by G1 (bearer `api_key`, no
  custom headers). Refines D-05 to an implementation definition.
- **Decision:**
  - **Mechanism:** every downstream MCP request to the connector must carry
    `Authorization: Bearer <connector-api-key>`. This is exactly the mechanism G1
    confirmed OpenHands Cloud uses (it transmits `api_key` as
    `Authorization: Bearer <key>`).
  - **Where stored:** the connector API key is stored as a **scrypt hash** in the
    SQLite store (never plaintext). scrypt (salt + N/r/p parameters) resists
    brute force and is constant-time to verify.
  - **How provisioned:** via `MCPRELAY_CONNECTOR_API_KEY` env var. On startup, if
    no key is present in the store, the connector ingests the env value, hashes
    it (scrypt), and stores the hash. If a key is already stored, the env value
    (if provided) is compared against the stored hash and a mismatch is a
    configuration error (prevents silent key drift). MVP: single shared key.
  - **How rotated:** set a new `MCPRELAY_CONNECTOR_API_KEY`, restart the
    connector → it re-hashes and stores the new key (the old hash is replaced).
    Documented procedure for the MVP; a rotation CLI is Phase 8.
  - **How validated:** for each downstream request, the connector extracts the
    bearer token from `Authorization`, runs scrypt verify against the stored
    hash. Missing/invalid → **HTTP 401** with a `WWW-Authenticate`-style
    challenge, no token echoed. Valid → request proceeds.
  - **When invalid:** 401, generic error, no secret material in the response or
    logs. The downstream client (OpenHands Cloud) sees a standard 401.
  - **Kept out of logs:** the key is **never** logged. Log only a non-reversible
    key fingerprint (e.g. first 4 chars + length, as G1's test server did:
    `Bearer g***P(len=32)`). Redaction is enforced in the logging path.
- **Rationale:** scrypt-hashed storage means a DB-file leak (D-10) does not
  reveal the downstream key. Constant-time scrypt verify prevents timing
  attacks. The bearer mechanism is the one G1 proved compatible with OpenHands
  Cloud — no custom headers, no interactive OAuth downstream (D-05).
- **Constraint check:** compatible with OpenHands Cloud (G1) ✓; key never
  plaintext at rest ✓; constant-time verify ✓; no secret in logs/responses ✓;
  rotation without data loss ✓ (env + restart). Per-client keys deferred to
  Phase 8 (RISKS S3).

## D-14 — Phase 4 deployment topology (production Docker image + TLS ingress)

- **Status:** **DECIDED (2026-08-10)** — Phase 4 (G6). Refines D-09's
  "Docker + reverse-proxy TLS" deployment target to the concrete, validated
  topology. No architectural change; records what was built and exercised.
- **Decision:**
  - **Image:** multi-stage `Dockerfile` (`node:22-bookworm-slim`): build stage
    compiles TypeScript (strict) + `better-sqlite3` native bindings; runtime
    stage ships only `dist/` + production deps, runs as non-root `connector`
    (uid 1001), `VOLUME /data`, `EXPOSE 8789`, entrypoint `node dist/connector.js`.
    Secrets are never baked into the image (runtime env only).
  - **TLS reverse proxy:** the connector listens on `0.0.0.0:8789` behind a
    TLS-terminating work-host ingress (`https://work-…prod-runtime.all-hands.dev`
    → container port 8789). `MCPRELAY_PUBLIC_BASE_URL` is set to the public TLS
    URL so the OAuth `redirect_uri` (`…/oauth/callback`) is reachable by Notion.
  - **Persistent storage:** a Docker volume mounts `/data/connector.db` (SQLite,
    WAL) so the encrypted credential store (D-10) survives container restart.
  - **Secrets:** `MCPRELAY_MASTER_KEY` (32-byte base64, `openssl rand -base64
    32`) and `MCPRELAY_CONNECTOR_API_KEY` are provided via env at runtime; the
    raw values live only in a mode-600 file **outside** the repo (never in VCS).
  - **Upstream:** `MCPRELAY_UPSTREAM_URL=https://mcp.notion.com/mcp` (real
    Notion hosted MCP).
- **Rationale:** matches D-09 exactly; validated live at G6 (image builds,
  deploys, persists, enforces auth, serves real Notion OAuth through TLS). The
  non-root user and unbaked-secrets posture satisfy the Phase 4 security
  invariants.
- **G6 note (not a decision defect):** completing the Notion OAuth grant
  requires a human Notion account holder's browser consent (G2, O7). This is an
  operational dependency on the operator, not a deployment-design issue; the
  deployed connector already serves the consent flow. See [evidence/G6.md](evidence/G6.md).

## Summary of decision status

| ID | Decision | Status |
| --- | --- | --- |
| D-01 | Terminating MCP proxy/gateway | Resolved |
| D-02 | Connector owns upstream auth; client never sees upstream creds | Resolved |
| D-03 | Notion first, but connector stays domain-agnostic | Resolved |
| D-04 | Multi-tenant data model now, multi-tenancy later | Resolved |
| D-05 | Downstream MVP auth = connector API key (bearer) | Resolved (confirmed by G1; refined by D-13) |
| D-06 | Advertise mediated intersection of capabilities | Resolved |
| D-07 | Transparent JSON-RPC forwarding | Resolved |
| D-08 | MVP may be stateless; SSE is additive | **Confirmed (2026-08-10, G4; re-confirmed Phase 3 stateful/stateless check)** — stateless Streamable HTTP sufficient for the Notion upstream |
| D-09 | Language/runtime + deployment target | **DECIDED (2026-08-10)** — TypeScript/Node.js + `@modelcontextprotocol/sdk`; SQLite creds; Docker + reverse-proxy TLS. (openid-client dropped per D-12) |
| D-10 | Credential-store backend + master key | **DECIDED (2026-08-10, Phase 3 entry)** — SQLite + field-level AES-256-GCM; master key from `MCPRELAY_MASTER_KEY` env; fail-fast if absent |
| D-11 | Operator OAuth consent UX | **DECIDED (2026-08-10, Phase 3 entry)** — connector-hosted browser flow (`/oauth/authorize` + `/oauth/callback`) |
| D-12 | MCP SDK package/version + OAuth path | **DECIDED (2026-08-10, Phase 3 entry)** — remain on combined `@modelcontextprotocol/sdk` v1.30.0; use native `./client/auth.js` helpers; no `openid-client`; no transport `authProvider` auto-path |
| D-13 | Downstream client auth boundary | **DECIDED (2026-08-10, Phase 3 entry)** — bearer `api_key`; scrypt-hashed in store; provisioned via `MCPRELAY_CONNECTOR_API_KEY`; 401 on invalid |
| D-14 | Phase 4 deployment topology | **DECIDED (2026-08-10, Phase 4)** — multi-stage Docker image (non-root); TLS work-host ingress; persistent `/data` volume; runtime-env secrets (never baked/VCS); real Notion upstream |

## Gate-status record

Gate outcomes are recorded here as they are produced during validation. Until a
gate has a recorded outcome, it is **BLOCKED — VALIDATION REQUIRED** and the
downstream phases it guards must not begin (see [ROADMAP.md](ROADMAP.md)).

| Gate | After phase | Guards | Outcome | Evidence |
| --- | --- | --- | --- | --- |
| G1 — OpenHands Cloud compatibility | Phase 1 (M1) | Phase 2 onward | PASS (2026-08-10) | [docs/evidence/G1.md](evidence/G1.md) |
| G2 — Notion OAuth behavior | Phase 1 (M1) | Phase 3 onward | PASS (2026-08-10) | [docs/evidence/G2.md](evidence/G2.md) |
| G3 — Notion MCP tool surface sufficient | Phase 1 (M1) | Phase 5 onward | SUFFICIENT (2026-08-10) | [docs/evidence/G3.md](evidence/G3.md) |
| G4 — Minimal connector forwards MCP | Phase 2 (M2) | Phase 3 onward | PASS (2026-08-10) | [docs/evidence/G4.md](evidence/G4.md) |
| G5 — Auth boundary holds | Phase 3 (M3) | Phase 4 onward | PASS (2026-08-10) | [docs/evidence/G5.md](evidence/G5.md) |
| G6 — OpenHands connects via connector, isolation holds | Phase 4 (M4) | Phase 5 onward | PARTIAL — BLOCKED at Notion human-consent gate (2026-08-10); 10/16 criteria PASS, 5 blocked on operator consent, 1 partial | [docs/evidence/G6.md](evidence/G6.md) |
| G7 — Complete technical path validated | Phase 5 (M5) | Phase 6 onward | Not started | — |
| G8 — MVP complete (10-step, reproducible) | Phase 6 (M6) | Phase 7 onward | Not started | — |
| G9 — Generalization evidenced | Phase 7 (M7) | Phase 8 onward | Not started | — |
| G10 — Hardening verified | Phase 8 (M8) | Release | Not started | — |

## Open questions that must be answered before implementation

(See [MILESTONES.md](MILESTONES.md) §"Most important unresolved questions" for
the gate-mapped list.)

1. **G1 (M1):** Can OpenHands Cloud consume a bearer `api_key` remote MCP
   endpoint with no custom headers and no interactive OAuth? — **PASS
   (2026-08-10).** Confirmed experimentally; see [docs/evidence/G1.md](evidence/G1.md).
2. **G2 (M1):** Notion refresh-token lifetime/revocation semantics? — **PASS
   (2026-08-10).** OAuth 2.0 Auth Code + PKCE + DCR; access token ~8h (use
   `expires_in`); refresh token rotates on every refresh, 180-day absolute
   non-sliding cap or 30-day inactivity; `invalid_grant` terminal; connector
   must persist DCR creds + latest rotated refresh token atomically and
   serialize refresh per grant. See [docs/evidence/G2.md](evidence/G2.md).
3. **G3 (M1):** Does Notion's hosted MCP tool surface cover read + update/create
   + comment read for the documentation workflow? — **SUFFICIENT
   (2026-08-10).** Tools confirmed from official docs: read → `notion-search` +
   `notion-fetch`; create → `notion-create-pages`; update → `notion-update-page`;
   read comments → `notion-get-comments`. See [docs/evidence/G3.md](evidence/G3.md).
4. **D-09 (M1):** Language/runtime and deployment target — **DECIDED
   (2026-08-10):** TypeScript on Node.js with `@modelcontextprotocol/sdk`
   (server + client, Streamable HTTP), first-party MCP OAuth client helpers +
   `openid-client` for upstream PKCE/DCR/refresh, **SQLite** credential store
   (encrypted at rest), deployed as a **Docker container** behind a
   TLS-terminating reverse proxy with a persistent volume. Go rejected
   (client OAuth experimental in the official Go SDK); Python a close-second
   fallback. See [DECISIONS.md §D-09](DECISIONS.md#d-09--implementation-languageruntime-and-deployment-target).
5. **D-10 (M3):** Credential-store backend and master-key source — **DECIDED
   (2026-08-10):** SQLite (better-sqlite3) on a persistent volume
   (`MCPRELAY_DB_PATH`); field-level AES-256-GCM encryption for secrets; master
   key from `MCPRELAY_MASTER_KEY` env (32-byte base64); fail-fast if absent;
   rotation via re-encryption (documented). See
   [DECISIONS.md §D-10](DECISIONS.md#d-10--credential-store-backend-and-master-key-source-phase-3-entry).
6. **D-11 (M3):** Operator OAuth consent UX — **DECIDED (2026-08-10):**
   connector-hosted browser flow — `GET /oauth/authorize` (PKCE S256 + state,
   redirect to Notion) + `GET /oauth/callback` (validate, exchange, persist).
   Re-auth = revisit `/oauth/authorize`. See
   [DECISIONS.md §D-11](DECISIONS.md#d-11--operator-oauth-consent-ux-phase-3-entry).
7. **D-12 (M3):** MCP SDK package/version + OAuth implementation path —
   **DECIDED (2026-08-10):** remain on combined `@modelcontextprotocol/sdk`
   v1.30.0; use its native `./client/auth.js` OAuth helpers (discovery/DCR/PKCE
   S256/exchange/refresh/rotation + `InvalidGrantError`); no `openid-client`; no
   transport `authProvider` auto-path (explicit bearer + managed refresh). See
   [DECISIONS.md §D-12](DECISIONS.md#d-12--mcp-sdk-packageversion-and-oauth-implementation-path-phase-3-entry).
8. **D-13 (M3):** Downstream client auth boundary — **DECIDED (2026-08-10):**
   bearer `api_key` (G1-compatible); scrypt-hashed in the store; provisioned via
   `MCPRELAY_CONNECTOR_API_KEY`; 401 + `WWW-Authenticate` on invalid; key never
   logged (fingerprint only). See
   [DECISIONS.md §D-13](DECISIONS.md#d-13--downstream-client-authentication-boundary-phase-3-entry).
9. **Stateful/stateless check (Phase 3 entry):** **DECIDED (2026-08-10)** —
   stateless Streamable HTTP is sufficient for Notion's hosted MCP (all
   documentation-workflow tools are request/response `tools/call`; SSE
   notifications / long-lived upstream sessions not required). D-08 unchanged. See
   [DECISIONS.md §D-08](DECISIONS.md#d-08--mvp-may-run-stateless-no-sse-where-mcp-allows-sse-streaming-is-additive).
