# Architecture

> Status: **Design proposal.** Components below are the proposed shape of the
> MCP Connector. They have not been implemented. See [DECISIONS.md](DECISIONS.md)
> for the rationale behind each major choice and [RISKS.md](RISKS.md) for what
> could go wrong.

## 1. Core concept

The connector is a **bidirectional MCP proxy** (gateway). It is simultaneously:

- an **MCP server** toward the downstream client (initially OpenHands Cloud); and
- an **MCP client** toward upstream remote MCP servers (initially Notion).

It terminates the downstream MCP session, authenticates upstream, then forwards
JSON-RPC traffic transparently. It does **not** understand the upstream
application's domain — it forwards capabilities, requests, and responses.

```
   Downstream client                MCP Connector                  Upstream
 ┌──────────────────┐   MCP    ┌──────────────────────────────┐   MCP   ┌─────────────────┐
 │  OpenHands Cloud │ ◄──────► │  Downstream-facing MCP server │ ◄─────►│  Notion MCP      │
 │  (or any client) │          │  ───────────────────────────  │ +auth  │  (Streamable HTTP│
 └──────────────────┘          │  Upstream-facing MCP client   │        │   / OAuth)       │
                               │  Auth manager / credential st. │        └─────────────────┘
                               │  Router / session manager     │
                               │  Lifecycle / observability    │
                               └──────────────────────────────┘
```

## 2. Component breakdown

### 2.1 Downstream-facing MCP server

- Presents a Streamable HTTP MCP endpoint to clients (e.g. `POST /mcp`,
  optional `GET` SSE stream).
- Handles the MCP lifecycle toward the client: `initialize`, capability
  advertisement, `tools/list`, `tools/call` (and resources/prompts when the
  upstream supports them).
- Authenticates the *downstream* client using a connector-owned mechanism
  (proposal: a connector API key / bearer token). The downstream client never
  receives or transmits upstream (Notion) credentials.
- Forwards requests to the router.

### 2.2 Upstream-facing MCP client

- Acts as a standard MCP client toward each configured upstream remote MCP
  server using the Streamable HTTP transport.
- Performs the MCP `initialize` handshake upstream and caches the upstream
  capability advertisement (tools/resources/prompts).
- Attaches the appropriate upstream credentials (OAuth bearer token, or
  API-key/bearer) to every upstream request, as required by the MCP
  Authorization spec. [^mcp-auth]
- Handles transport-level concerns: `Mcp-Session-Id`, SSE resumption
  (`Last-Event-ID`), and backpressure.

### 2.3 Auth manager + credential store

- Owns the **upstream** authentication lifecycle:
  - OAuth 2.1 + PKCE flow execution against upstream (e.g. Notion), using
    RFC 9470 (Protected Resource Metadata) → RFC 8414 (Authorization Server
    Metadata) discovery.
  - Optional Dynamic Client Registration (RFC 7591) where the upstream
    supports it.
  - Persistent, **encrypted-at-rest** storage of access/refresh tokens and
    client credentials — keyed per upstream + per Notion-workspace/user.
  - Proactive token refresh before expiry; re-authentication on `invalid_grant`.
- Owns **downstream** authentication: issuing and validating connector API
  keys used by clients.
- **Never** exposes upstream credentials to the downstream client.

### 2.4 Router / session manager

- Maps a downstream session/request to the correct upstream connection.
  - MVP: a single configured upstream (Notion), so routing is 1:1.
  - Later: route by server name in the downstream tool namespace, by client
    identity, or by an explicit routing table.
- Maintains the mapping between downstream MCP sessions and upstream MCP
    sessions, including `Mcp-Session-Id` correlation.
- Handles multi-tenant concerns: which downstream principal maps to which
  upstream credential/token (see §5).

### 2.5 Lifecycle + observability

- Connection lifecycle: lazy upstream connect, keepalive, idle reclamation,
  reconnect with backoff, graceful shutdown.
- Structured logging and an **audit log** of tool calls (caller, upstream,
  tool, arguments hash, outcome, latency) — without logging secret material.
- Health endpoints for liveness/readiness; metrics for upstream auth state and
  request forwarding.

## 3. Boundaries

| Boundary | What crosses it | What must NOT cross it |
| --- | --- | --- |
| Downstream client ↔ Connector | MCP JSON-RPC over Streamable HTTP; connector API key | Upstream OAuth/API tokens; upstream app credentials |
| Connector ↔ Upstream MCP | MCP JSON-RPC over Streamable HTTP; upstream bearer/API key | Connector's downstream API keys; downstream client identity beyond what authorization requires |
| Connector ↔ Credential store | Encrypted token reads/writes; refresh ops | Plaintext secrets in logs, memory dumps, or client responses |

The connector is **domain-agnostic**. It forwards whatever capabilities the
upstream advertises. It must not implement Notion concepts (pages, databases,
comments) as first-class logic — those are just `tools/call` payloads it relays.

## 4. Architectural alternatives considered

### A. Pure pass-through reverse proxy (HTTP-level forwarding)

Forward the raw HTTP request body upstream, inject the bearer token, return the
response. Simplest possible design.

- **Pros:** Minimal logic; very transparent; trivially general.
- **Cons:** Cannot mediate the MCP `initialize`/capability handshake (downstream
  and upstream negotiate independently and may disagree on protocol version or
  capabilities); cannot present a stable, connector-authenticated endpoint that
  hides upstream OAuth; cannot translate between transports
  (e.g. stdio↔Streamable HTTP) if ever needed; cannot do per-tool authorization
  or audit at the MCP layer.
- **Verdict:** Rejected as the *primary* design, but retained as the inner
  forwarding mechanism for already-initialized tool calls (see §6).

### B. Downstream client does OAuth itself (no connector)

Let OpenHands complete Notion OAuth directly (it already has OAuth support via
FastMCP). This is the "do nothing" baseline.

- **Pros:** No new component.
- **Cons:** (a) Requires interactive OAuth from a headless cloud agent — the
  documented problem. (b) Places upstream OAuth tokens in the agent's
  execution environment, violating the credential-isolation requirement. (c)
  Couples every client to every upstream's auth scheme; does not generalize.
- **Verdict:** Rejected; this is exactly the gap the connector closes.

### C. Connector as a full MCP server that re-implements upstream tools

The connector implements Notion's tools itself (calling Notion's REST API
directly) rather than proxying the MCP server.

- **Pros:** Full control over surface, batching, caching, partial responses.
- **Cons:** Violates the core "no domain logic / transparent forwarding"
  principle; turns the connector into a Notion adapter; duplicative with the
  upstream MCP server; huge maintenance burden; not general.
- **Verdict:** Rejected for the connector. (A *separate* Notion-REST adapter
  could be a future upstream if the hosted MCP's surface is insufficient — but
  that would be a different component, not this connector.)

### D. Library/SDK embedded in the client (no standalone service)

Ship a library that the client imports to handle upstream auth and proxying.

- **Pros:** No deployment/ops surface; fewer moving parts.
- **Cons:** OpenHands Cloud cannot easily import an arbitrary library into its
  runtime; credentials would still live client-side; does not help non-OpenHands
  clients; defeats the "stable endpoint for clients with limited auth" goal.
- **Verdict:** Rejected as primary; the connector is a **service**. (Selected
  auth/proxy internals may later be factored into a reusable library.)

### E. Selected design: terminating MCP proxy/gateway

The connector terminates both MCP legs, mediates handshakes, owns auth, and
forwards JSON-RPC. (This is the design in §2.)

- **Pros:** Hides upstream OAuth behind a stable, simply-authenticated endpoint;
  keeps credentials out of the client sandbox; mediates capability/protocol
  negotiation; supports transport translation and per-tool audit/authorization;
  generalizes to multiple upstreams.
- **Cons:** More complex than a pass-through proxy; the connector becomes a
  stateful, security-critical component that must be operated.
- **Verdict:** **Selected.** The complexity is justified by the credential
  isolation and headless-auth requirements, which none of the simpler
  alternatives satisfy. See [DECISIONS.md](DECISIONS.md) D-01.

## 5. Multi-user / multi-tenant considerations

Notion OAuth authorizes a *user/workspace*. The connector must therefore map a
**downstream principal** to an **upstream credential**:

- MVP (single operator): one Notion OAuth token set, shared by all downstream
  callers; the connector authenticates downstream callers with a connector API
  key. Simple and sufficient for the initial self-referential use case.
- Later (multi-tenant): per-tenant upstream credentials, selected by the
  downstream client's identity or an explicit routing header. Requires
  per-tenant token storage and authorization boundaries. **Out of MVP scope**
  but the data model must not preclude it (see [DECISIONS.md](DECISIONS.md)
  D-04).

## 6. Forwarding strategy (inner mechanism)

For an already-initialized session, the connector forwards `tools/list` and
`tools/call` (and resources/prompts) by:

1. Receiving the downstream JSON-RPC request.
2. Resolving the target upstream connection and its current valid credential.
3. Re-issuing the JSON-RPC request upstream (same method/params) with the
   upstream bearer token attached.
4. Streaming/returning the upstream response to the downstream client.

The connector rewrites **only** what protocol bridging requires (e.g. session
IDs, capability negotiation, namespacing of tool names when multiple upstreams
are present). It does not interpret tool arguments or results.

## 7. Transport compatibility

- **Downstream:** Streamable HTTP (primary). Supporting `stdio` downstream is
  **not** required for the OpenHands Cloud use case (Cloud uses remote HTTP),
  but the design should not make it impossible.
- **Upstream:** Streamable HTTP (Notion's transport). The deprecated HTTP+SSE
  transport is supported only as a fallback for upstreams that have not migrated.
- **Capability/protocol-version negotiation:** the connector advertises
  downstream the intersection of what it supports and what upstreams expose, to
  avoid advertising capabilities an upstream cannot fulfill.

## 8. What the architecture deliberately does NOT include

- No Notion/REST business logic, no page/block modeling.
- No AI reasoning, planning, or prompt assembly.
- No project management, no stakeholder interpretation.
- No source-repository mutation (that stays in OpenHands/GitHub).
- No durable store of project data (Notion remains source of truth).

## 9. Open architectural questions

These are resolved (or deferred) in [DECISIONS.md](DECISIONS.md) and tracked in
[RISKS.md](RISKS.md). The most important:

- Language/runtime and deployment target (process vs. serverless).
- Credential-store backend and encryption approach.
- Whether the downstream endpoint requires auth at all for MVP, and what form.
- How to perform the initial Notion OAuth consent for a headless operator
  (operator-side flow vs. connector-hosted callback).
- How to namespace tools when multiple upstreams are introduced.

[^mcp-auth]: MCP spec — Authorization (2025-06-18): https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
