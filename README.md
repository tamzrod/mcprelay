# MCP Connector

A general-purpose MCP connectivity layer that bridges MCP clients to
authenticated remote MCP servers. The connector acts simultaneously as an
**MCP server** toward the downstream client and an **MCP client** toward
upstream remote MCP servers, managing authentication, credentials, routing,
and connection lifecycle in between.

The initial use case is connecting **OpenHands Cloud** to **Notion's hosted MCP
server** (`https://mcp.notion.com/mcp`), which uses an interactive OAuth flow
that is not convenient for a headless cloud agent.

```
    OpenHands Cloud
          │
          │ MCP
          ▼
    ┌───────────────────┐
    │   MCP Connector   │
    │                   │
    │  authentication   │
    │  credential store  │
    │  session / state  │
    │  routing          │
    └────────┬──────────┘
             │
             │ MCP + authentication
             ▼
        Remote MCP
        Server (e.g. Notion)
```

The connector is intentionally general-purpose. Notion is a use case, not the
definition of the connector. The architecture must remain general enough to
support other authenticated remote MCP servers later.

## Status

Phase 0 (architecture baseline) is **complete**. The project is now at
**Phase 1 — External Assumption Validation**, which is **BLOCKED — VALIDATION
REQUIRED** on three gates (G1: OpenHands Cloud compatibility, G2: Notion OAuth
behavior, G3: Notion MCP tool surface). **No implementation exists yet**, and
none may begin until those gates pass. The development sequence is a strict
gated contract: no phase begins until the previous phase's exit gate is
satisfied and documented.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the gated phase sequence and
[`docs/MILESTONES.md`](docs/MILESTONES.md) for the acceptance criteria behind
each gate.

## Documentation

| Document | Purpose |
| --- | --- |
| [docs/PROBLEM.md](docs/PROBLEM.md) | The OpenHands Cloud ↔ authenticated remote MCP integration problem |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Proposed components, boundaries, and alternatives |
| [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) | OAuth and credential handling, keeping upstream creds out of the sandbox |
| [docs/MCP-FLOW.md](docs/MCP-FLOW.md) | Downstream and upstream MCP communication |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Staged development plan |
| [docs/MILESTONES.md](docs/MILESTONES.md) | Measurable milestones and acceptance criteria |
| [docs/RISKS.md](docs/RISKS.md) | Technical, security, architectural, and operational risks |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architectural decisions and their rationale |

## Goals

- Connect MCP clients to remote MCP servers.
- Support authenticated remote MCP servers (OAuth and API-key/bearer).
- Keep upstream credentials outside the MCP client sandbox.
- Forward MCP requests and responses transparently, without implementing
  upstream application business logic.
- Allow multiple upstream MCP servers.
- Provide a stable, simple-to-consume MCP endpoint to clients with limited
  connectivity or authentication capabilities.

## Non-Goals

The connector is **not** intended to:

- replace MCP servers;
- implement Notion-specific (or any domain-specific) business logic;
- become a general-purpose project-management system;
- interpret stakeholder requirements;
- modify source repositories on its own;
- become the source of truth for project data.

The connector provides **connectivity**. The MCP client/agent remains
responsible for deciding what tools mean and how to use them.

## Design Principle: Separation of Responsibilities

| Layer | Responsibility |
| --- | --- |
| GitHub | Implementation source of truth |
| OpenHands | Development agent — reasoning and execution |
| Notion | Development documentation and stakeholder communication |
| MCP Connector | Connectivity, authentication, routing, secure MCP bridging |

The connector must not become a project-management or AI-reasoning layer unless
a demonstrated architectural requirement forces it.

## Architecture Overview

The connector sits between a downstream MCP client (initially OpenHands Cloud)
and one or more upstream remote MCP servers (initially Notion). It terminates the
downstream MCP session, performs upstream authentication, and forwards MCP
JSON-RPC traffic transparently.

```
                         MCP Connector
                              │
               ┌──────────────┼──────────────┐
               │              │              │
               ▼              ▼              ▼
            Notion         GitHub        Other MCP
              MCP            MCP          Servers
               │              │              │
            OAuth        OAuth / API       Auth
```

The full component breakdown, boundaries, and the alternatives considered are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

See [LICENSE](LICENSE).
