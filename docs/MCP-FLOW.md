# MCP Flow

> Status: **Design proposal.** This describes the downstream and upstream MCP
> communication the connector mediates. Protocol facts are cited; the
> connector-side sequencing is a proposal.

## 1. Transports in play

- **Downstream (client → connector):** Streamable HTTP. Single endpoint
  (`POST /mcp`, optional `GET` SSE stream). [^mcp-transports]
- **Upstream (connector → Notion):** Streamable HTTP (Notion supports
  Streamable HTTP + SSE). [^notion-blog]
- The deprecated HTTP+SSE transport (2024-11-05) is supported upstream only as a
  fallback for servers that have not migrated. [^mcp-transports]
- `stdio` is not used remotely; it is local-subprocess only. [^mcp-transports]

## 2. Message basis

MCP messages are JSON-RPC 2.0 over the chosen transport. Servers do not
initiate JSON-RPC requests; clients do not send JSON-RPC responses. [^mcp-transports]
The connector therefore:
- acts as **server** on the downstream leg (it receives requests, sends
  responses/notifications);
- acts as **client** on the upstream leg (it sends requests, receives
  responses/notifications).

## 3. Downstream flow (client → connector)

### 3.1 Connection + initialize

1. Client opens the connector's MCP endpoint (Streamable HTTP).
2. Client sends `initialize` with its protocol version, client info, and
   capabilities.
3. Connector responds with its server info, negotiated protocol version, and
   the capabilities it advertises (derived from upstream — see §5).
4. Client sends `notifications/initialized`.
5. The connector may issue a `Mcp-Session-Id` which the client echoes on
   subsequent requests. [^mcp-transports]

### 3.2 Downstream authentication

- The client presents a connector API key as a bearer header on every request
  (see [AUTHENTICATION.md](AUTHENTICATION.md) §4). The connector validates it
  before processing any MCP request.

### 3.3 Discovery / listing

- `tools/list` → connector returns the (possibly namespaced) tool list it
  obtained upstream.
- `resources/list`, `prompts/list` → forwarded if the upstream advertises them.

### 3.4 Invocation

- `tools/call` (with `name` + `arguments`) → connector routes to the matching
  upstream, forwards as an upstream `tools/call`, and returns the result.
- Notifications/subscriptions and server→client notifications (e.g. resource
  updates) are relayed over the SSE stream where supported.

## 4. Upstream flow (connector → Notion)

### 4.1 Upstream initialize (connector-as-client)

1. Connector (as MCP client) connects to Notion's MCP endpoint.
2. Connector performs MCP `initialize` upstream, negotiating protocol version
   and learning Notion's advertised capabilities (tools/resources/prompts).
3. Notion requires OAuth: the connector attaches `Authorization: Bearer
   <access_token>` on every upstream request. [^mcp-auth]
4. Connector caches the upstream capability advertisement to serve downstream
   `*/list` calls without repeatedly probing upstream.

### 4.2 Upstream auth bootstrapping (once, by an operator)

- The connector performs RFC 9470 → RFC 8414 discovery against Notion. [^notion-build-client]
- An operator completes the OAuth 2.1 + PKCE consent in a browser against the
  connector's OAuth client; the connector handles the callback and stores
  tokens (see [AUTHENTICATION.md](AUTHENTICATION.md) §2).

### 4.3 Forwarding a tool call

```
client                    connector (server)        connector (client)         Notion
  │                            │                          │                       │
  │── initialize ─────────────►│                          │                       │
  │◄── serverInfo/caps ────────│                          │ (lazy upstream init)  │
  │── initialized ────────────►│                          │                       │
  │── tools/list ─────────────►│ (cached from upstream)  │                       │
  │◄── tools ─────────────────│                          │                       │
  │── tools/call(name,args) ──►│                          │                       │
  │                            │── tools/call(name,args) ────────────────────────►│ (+bearer)
  │                            │                          │◄── result/error ───────│
  │◄── result/error ───────────│                          │                       │
```

## 5. Capability negotiation

- The connector advertises downstream the **intersection** of (a) what it can
  mediate and (b) what the upstream advertises — to avoid promising a
  capability the upstream cannot fulfill.
- If multiple upstreams exist (Phase 5+), tool names are **namespaced** (e.g.
  `notion.search`, `github.create_issue`) so the downstream client sees a
  single, unambiguous tool surface.
- Protocol-version mismatch: the connector negotiates the highest mutually
  supported version on each leg independently and, if versions differ, behaves
  conservatively (advertise the lower common feature set; never expose
  upstream-only fields the downstream version cannot represent).

## 6. Session and state management

- **Downstream session:** identified by connector-issued `Mcp-Session-Id`.
- **Upstream session:** identified by Notion-issued `Mcp-Session-Id`.
- The router maintains a **correlation** between downstream session and
  upstream session(s). A downstream session does not necessarily map 1:1 to an
  upstream session (e.g. one upstream connection may serve multiple downstream
  callers in the single-user MVP).
- **SSE resumption:** if the downstream SSE stream drops, the client may resume
  with `Last-Event-Id`; the connector replays/reconnects as appropriate. [^mcp-transports]
- **Stateless fallback:** a stateless connector mode (no SSE, one request =
  one upstream call) is acceptable for the MVP to reduce state complexity,
  provided tool calls still work. SSE streaming is additive, not required, for
  the initial use case.

## 7. Routing (single upstream in MVP; general later)

- MVP routing rule: all `tools/call`/`*/list` go to the single configured
  upstream (Notion). No routing decision needed beyond credential selection.
- General routing rule (Phase 5+): parse the tool namespace prefix to select
  the upstream connection; fall back to the default upstream if unmapped.
- Authorization check precedes routing: confirm the downstream key is allowed to
  use the selected upstream (see [AUTHENTICATION.md](AUTHENTICATION.md) §6).

## 8. Failure handling in the flow

- **Upstream 401:** refresh token, retry once; on continued failure return a
  structured MCP error to the client (no token in the error). [^mcp-auth]
- **Upstream transport error:** retry with backoff; if persistent, return a
  transport-level error to the client.
- **Downstream client disconnect during an in-flight upstream call:** cancel
  the upstream request where possible; do not leak the upstream session.
- **Capability/list drift:** if upstream capabilities change, invalidate the
  cached advertisement (on reconnect or a TTL) so `*/list` stays accurate.

## 9. Transparency guarantees and limits

- **Transparent:** method names, parameters, and result shapes pass through
  unchanged (modulo namespacing for multi-upstream). The connector does not
  interpret tool semantics.
- **Not transparent (intentional):** the upstream OAuth bearer token is added
  upstream-side and stripped from any error returned downstream; capability
  advertisement is the meditated intersection; session IDs are re-issued per
  leg. These are required for credential isolation and protocol correctness.

## References

[^mcp-transports]: MCP spec — Transports (2025-06-18): https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
[^mcp-auth]: MCP spec — Authorization (2025-06-18): https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
[^notion-blog]: Notion — Hosted MCP server (Streamable HTTP + SSE, OAuth): https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look
[^notion-build-client]: Notion — Build an MCP client (discovery, PKCE, token lifecycle): https://developers.notion.com/guides/mcp/build-mcp-client
