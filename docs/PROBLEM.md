# Problem Statement

## What problem does the MCP Connector solve?

MCP clients — and **OpenHands Cloud** in particular — can be configured to use
remote MCP servers, but some remote MCP servers require an authentication flow
that is **not conveniently usable** from a headless, cloud-hosted agent. The
MCP Connector exists to bridge that gap by performing upstream authentication
in a controlled intermediary, so the agent never has to handle upstream
credentials or interactive consent.

The motivating case is **Notion's hosted MCP server** (`https://mcp.notion.com/mcp`),
which is OAuth-only and requires a human-in-the-loop consent.

## The integration gap

### Confirmed facts

These are established from the relevant official documentation.

- **MCP transports (spec 2025-06-18).** Remote MCP servers use the Streamable
  HTTP transport (a single endpoint serving `POST` for client→server messages
  and an optional `GET` SSE stream for server→client messages). The older
  HTTP+SSE transport (2024-11-05) is deprecated. `stdio` is for local
  subprocesses only. [^mcp-transports]

- **MCP authorization is OAuth 2.1.** The MCP Authorization spec requires
  OAuth 2.1 with PKCE; recommends Dynamic Client Registration (RFC 7591); and
  *requires* OAuth 2.0 Protected Resource Metadata (RFC 9728) for discovery and
  Authorization Server Metadata (RFC 8414). Access tokens are sent as
  `Authorization: Bearer` on **every** request; expired/invalid tokens get a
  401. [^mcp-auth]

- **Notion's hosted MCP is OAuth-only and interactive.** Notion explicitly
  states: *"Notion MCP requires user-based OAuth authentication and does not
  support bearer token authentication… a user must complete the OAuth flow to
  authorize access, which may not be suitable for fully automated workflows or
  cloud-based coding agents that run without human interaction."* [^notion-mcp]
  It is built on Cloudflare's `workers-oauth-provider`, supports Streamable
  HTTP + SSE, and uses the RFC 9470 → RFC 8414 discovery flow. [^notion-build-client]

- **OpenHands supports OAuth MCP servers, but interactively.** OpenHands uses
  FastMCP to handle OAuth. Its own documentation states: *"OAuth MCP servers
  require user interaction for the initial authentication. This means they may
  not be suitable for fully automated/headless workflows. For automation,
  consider using API key-based authentication where available."* [^oh-mcp-settings]
  Tokens are cached locally at
  `~/.fastmcp/oauth-mcp-client-cache/`. [^oh-sdk-mcp]

### Observations

- OpenHands Cloud is a **cloud-hosted, headless agent runtime**. Its docs frame
  interactive OAuth as *potentially unsuitable* for headless workflows — which
  is precisely the environment OpenHands Cloud runs in. This is the core tension
  the connector addresses.

- Even where an OpenHands agent *can* complete OAuth (e.g. local runtime with a
  browser), the resulting **upstream OAuth tokens are stored inside the agent's
  execution environment** (the FastMCP cache). For a cloud agent, that means
  upstream credentials live in the sandbox/runtime that runs the agent's code —
  the very exposure the project brief asks to avoid.

- Notion's hosted MCP is page-level only (no block-level editing, no file
  uploads) and surfaces ~18 tools (search, page CRUD, database creation,
  comments, user management). [^notion-mcp] This bounds what the initial use
  case can actually do.

### Hypotheses (to be validated before/early in implementation)

- H-P1: OpenHands Cloud, as deployed, **cannot reliably complete** the Notion
  interactive OAuth flow without operator intervention, because the runtime is
  headless and has no user browser to click through consent.
- H-P2: Even if OpenHands Cloud could complete OAuth, doing so would place
  Notion OAuth tokens inside the agent's execution environment, which the
  project requires to avoid.
- H-P3: A stable, simply-authenticated MCP endpoint (one the connector
  provides) is materially easier to consume from OpenHands Cloud than an
  OAuth-protected remote MCP server, because it removes the interactive step
  entirely.

## Why a connector (and not "just configure it")?

The connector concentrates three concerns into one controlled place:

1. **Upstream authentication lifecycle** — the connector performs the Notion
   OAuth dance once (a human completes consent against the connector's own
   OAuth client/callback), persists and refreshes the resulting tokens, and
  re-authenticates when a token is revoked (`invalid_grant`).
2. **Credential isolation** — upstream OAuth tokens live in the connector's
  secure storage, never in the OpenHands sandbox. OpenHands only ever sees the
  connector's own downstream-facing credential (or no credential at all).
3. **Transparent forwarding** — the connector advertises and forwards the
  upstream MCP capability surface (tools/resources/prompts) without
  implementing Notion-specific business logic.

## Why this is a *general* problem, not just "Notion"

Notion is the initial and primary use case, but the gap is structural: **any
OAuth-only or complex-auth remote MCP server** is awkward for a headless agent.
GitHub, Linear, Slack, and other MCP servers present the same shape of problem
to varying degrees. Designing the connector as a general connectivity layer
(not a Notion adapter) is what makes the investment durable.

## The initial end-to-end validation target

The first meaningful validation is a self-referential documentation loop:

1. OpenHands Cloud connects to the MCP Connector.
2. The connector authenticates with Notion's remote MCP service (OAuth, done
   once by an operator against the connector).
3. OpenHands receives the available Notion MCP capabilities (tools) from the
   connector.
4. OpenHands **reads** the Software Development documentation from Notion.
5. OpenHands **updates** development documentation in Notion.
6. OpenHands **reads** stakeholder comments from Notion.
7. The development workflow becomes:

   ```
   Development → Documentation → Stakeholder Review → Feedback
     → OpenHands → Further Development
   ```

The MCP Connector itself is one of the software projects documented in the
Notion Software Development area, making this use case self-referential and a
strong end-to-end demonstration.

## Out of scope for the problem statement

- The connector does **not** try to make Notion's hosted MCP do things it
  cannot do (block-level editing, file uploads, headless bearer auth). It
  forwards whatever surface the upstream exposes.
- The connector does **not** replace Notion's MCP server; it bridges to it.
- The connector does **not** own project data — Notion remains the source of
  truth for documentation, GitHub for implementation.

## References

[^mcp-transports]: MCP spec — Transports (2025-06-18): https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
[^mcp-auth]: MCP spec — Authorization (2025-06-18): https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
[^notion-mcp]: Notion — Connect to Notion MCP: https://developers.notion.com/guides/mcp/get-started-with-mcp
[^notion-build-client]: Notion — Build an MCP client for Notion (OAuth + PKCE, RFC 9470/8414 discovery): https://developers.notion.com/guides/mcp/build-mcp-client
[^oh-mcp-settings]: OpenHands — MCP settings (OAuth via FastMCP, headless caveat): https://docs.openhands.dev/openhands/usage/settings/mcp-settings
[^oh-sdk-mcp]: OpenHands SDK — MCP guide (token cache at `~/.fastmcp/oauth-mcp-client-cache/`): https://docs.openhands.dev/sdk/guides/mcp
