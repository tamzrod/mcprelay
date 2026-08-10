# MCP Relay

A general-purpose MCP relay/gateway for connecting MCP clients to authenticated
remote MCP servers.

The initial use case is connecting OpenHands Cloud to remote MCP servers that
require authentication mechanisms not conveniently supported by the client,
such as OAuth.

## Motivation

OpenHands Cloud can configure remote MCP servers, but some remote MCP servers
require an authentication flow that is not directly usable through the current
client configuration.

For example, Notion provides a hosted MCP server:

    https://mcp.notion.com/mcp

which uses OAuth authentication.

Rather than exposing upstream credentials to the OpenHands sandbox, MCP Relay
acts as an intermediary:

    OpenHands Cloud
          │
          │ MCP
          ▼
    ┌───────────────┐
    │   MCP Relay   │
    │               │
    │ authentication│
    │ session/state │
    │ routing       │
    └───────┬───────┘
            │
            │ MCP
            ▼
       Remote MCP
       Server

The relay is intentionally general-purpose. Notion is a use case, not the
definition of the relay.

## Goals

- Connect MCP clients to remote MCP servers.
- Support authenticated remote MCP servers.
- Keep upstream credentials outside the MCP client sandbox.
- Support OAuth-based authentication.
- Maintain authenticated upstream sessions/tokens where required.
- Forward MCP requests and responses without requiring knowledge of the
  upstream application's domain.
- Allow multiple upstream MCP servers.
- Provide a stable MCP endpoint to clients that have limited MCP connectivity
  or authentication capabilities.
- Make authentication and routing independent from the development repository.

## Non-Goals

MCP Relay is not intended to:

- replace MCP servers;
- implement Notion-specific business logic;
- become a general-purpose project management system;
- interpret stakeholder requirements;
- modify repositories on its own;
- become the source of truth for project data.

The relay provides connectivity.

The MCP client/agent remains responsible for deciding what the tools mean and
how they should be used.

## Architecture

```text
                         MCP Relay
                            │
             ┌──────────────┼──────────────┐
             │              │              │
             ▼              ▼              ▼
          Notion          GitHub        Other MCP
            MCP             MCP          Servers
             │              │              │
          OAuth          OAuth/API       Auth
