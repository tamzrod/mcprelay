# AGENTS.md — MCP Connector repository memory

Repository-specific knowledge for the MCP Connector project. Loaded
automatically each session.

## Project state

- **Phase:** Phase 0 (architecture baseline) COMPLETE. Now in **Phase 1 —
  External Assumption Validation**. **G1 = PASS (2026-08-10)** (OpenHands Cloud
  consumes a bearer `api_key` SHTTP MCP endpoint with no OAuth and no custom
  headers; see docs/evidence/G1.md). G2 (Notion OAuth behavior) and G3 (Notion
  MCP tool surface) remain **BLOCKED — VALIDATION REQUIRED**, and D-09
  (language/runtime + deploy target) is undecided. **No implementation exists**
  and none may begin until G2/G3 pass and D-09 is decided (see docs/ROADMAP.md).
- **Roadmap is a strict gated contract:** a later phase MUST NOT begin until the
  previous phase's exit gate is satisfied and documented. "Code exists" is not
  completion.
- **Repo name:** `mcprelay` (GitHub: tamzrod/mcprelay). The project is called
  **"MCP Connector"** (the original README said "MCP Relay"; README has been
  reconciled to "MCP Connector"). Do not rename the repo without instruction.
- **Existing files at design start:** `LICENSE`, an incomplete `README.md`
  (now completed/reconciled). Everything in `docs/` is newly authored.

## Documentation set (the deliverable of this phase)

- `README.md` — concise overview + doc index.
- `docs/PROBLEM.md` — the OpenHands Cloud ↔ authenticated-remote-MCP gap.
- `docs/ARCHITECTURE.md` — components, boundaries, alternatives.
- `docs/AUTHENTICATION.md` — OAuth/credential handling; no upstream creds in sandbox.
- `docs/MCP-FLOW.md` — downstream/upstream MCP communication.
- `docs/ROADMAP.md` — phased plan (Phase 0–6).
- `docs/MILESTONES.md` — measurable milestones + acceptance criteria (M3 = MVP).
- `docs/RISKS.md` — technical/security/arch/ops/process risks.
- `docs/DECISIONS.md` — architectural decision records + rationale.

## Key confirmed facts (from official docs — cite, don't re-derive)

- MCP remote transport = **Streamable HTTP** (POST + optional GET SSE); the
  2024-11-05 HTTP+SSE transport is deprecated. `stdio` is local-only.
- MCP authorization = **OAuth 2.1 + PKCE**, RFC 9470 (Protected Resource
  Metadata) → RFC 8414 (Authorization Server Metadata) discovery, optional
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
   (D-03/D-07) — forward JSON-RPC transparently.
4. **MVP** = OpenHands Cloud securely accesses Notion MCP through the connector
   with no Notion credential in the OpenHands sandbox. MVP technical path
   validated at **G7 (M5)**; MVP complete at **G8 (M6)** (the full 10-step
   reproducible documentation loop). No generalization before G8.
5. Data model accommodates multi-tenancy now; multi-tenancy is built later (D-04).
6. **Strict gating:** G1/G2/G3 (Phase 1) MUST pass before any connector code
   (Phase 2). No phase begins until the previous exit gate is satisfied.

## Deferred decisions (resolve before the indicated gate)

- G1/G2/G3 (Phase 1, M1) — validate OpenHands Cloud `api_key` consumption,
  Notion OAuth token lifecycle, Notion tool surface. **G1 = PASS
  (2026-08-10)**; G2/G3 BLOCKED.
- D-09 language/runtime + deploy target — at M1 (Phase 1).
- D-10 credential-store backend + master key — at M3 (Phase 3).
- D-11 operator OAuth consent UX — at M3 (Phase 3).

## OpenHands Cloud — how it picks up MCP servers (G1 findings)

Confirmed experimentally 2026-08-10. Relevant for the connector's downstream
interface and for setting up any validation conversation:

- Cloud conversations read MCP config from **stored user settings**
  (`agent_settings.mcp_config`), NOT from a per-conversation override. A
  `POST /api/v1/app-conversations` body may include `agent_settings.mcp_config`
  and returns HTTP 202, but it is **silently ignored** — the agent sees no MCP
  tools. Set the config **before** starting the conversation.
- Settings are updated via `POST /api/v1/settings` with an
  **`agent_settings_diff`** payload (deep-merged). The legacy `agent_settings`
  key is rejected with HTTP 422 ("Use *_diff nested settings payloads instead
  of legacy keys").
- Stored MCP config uses the SDK dict shape, e.g.
  `{"shttp": {"url": "...", "api_key": "...", "enabled": true}}`. The server
  normalizes `api_key` to `auth: {strategy: "api_key", value: "***"}` — a
  first-class auth strategy distinct from OAuth.
- OpenHands transmits `api_key` to the MCP server as
  `Authorization: Bearer <key>`. No custom headers are supported/needed.
- Remote (SHTTP) tools are exposed to the agent under a transport-prefixed
  name, e.g. `shttp_<tool>` (`shttp_g1_test`), not the raw upstream name.
- Agent-server events: per-conversation runtime host + `X-Session-API-Key`
  come from the app-conversation record (`conversation_url`, `session_api_key`).
  Event search `sort_order` accepts `TIMESTAMP` (asc) or `TIMESTAMP_DESC`, NOT
  `TIMESTAMP_ASC`.

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
