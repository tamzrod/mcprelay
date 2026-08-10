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

- **Status:** Proposed — to be confirmed by G1/G2 evidence (Phase 1) or settled
  at the Phase 2 exit gate (G4).
- **Context:** SSE adds session/stickiness complexity.
- **Decision:** For the MVP, support request/response `tools/call` without
  requiring SSE streaming; support `GET` SSE (and resumption) as a Phase 8
  enhancement.
- **Rationale:** The initial use case (list/call Notion tools) does not require
  server-initiated streaming. Reduces state complexity for the MVP.
- **Open item:** Confirm Notion's tools work without relying on SSE-delivered
  notifications *(verify via G1/G2, then G4)*.

## D-09 — (Deferred) Implementation language/runtime and deployment target

- **Status:** Deferred — **must be decided during Phase 1 (M1)**, as it gates
  Phase 2 and depends on G1/G2 evidence.
- **Context:** Affects credential store, SSE, operator OAuth callback UX,
  hosting.
- **Options being considered (proposals, not decisions):**
  - Long-running service (container) — simplest SSE + callback hosting.
  - Serverless/edge — cheap scaling, but OAuth callback + persistent encrypted
    store + SSE are harder.
- **Decision criteria:** native/first-class MCP SDK quality for that language;
  SSE support; secrets-backend integration; operator-consent UX; deployability.
- **Constraint:** Whatever is chosen must support the security requirements in
  [AUTHENTICATION.md](AUTHENTICATION.md) §5 and the resilience in
  [RISKS.md](RISKS.md) O-series.

## D-10 — (Deferred) Credential-store backend and master-key source

- **Status:** Deferred — **must be decided at Phase 3 entry (M3)**, after G2
  evidence is available.
- **Options (proposals):** KMS-managed key; secrets-manager (e.g. Vault/cloud
  KMS); environment-injected key for dev.
- **Constraint:** Never store secrets in VCS; encrypt at rest; support rotation
  without downtime (RISKS S2, O5).

## D-11 — (Deferred) Operator OAuth consent UX

- **Status:** Deferred — **must be decided at Phase 3 entry (M3)**, after G2
  evidence and D-09.
- **Options (proposals):** connector-hosted web `/authorize` + callback page;
  out-of-band CLI that performs the flow and injects tokens.
- **Decision driver:** deployment target (D-09) and how headless the connector
  environment is; G2 token-lifecycle findings.

## Summary of decision status

| ID | Decision | Status |
| --- | --- | --- |
| D-01 | Terminating MCP proxy/gateway | Resolved |
| D-02 | Connector owns upstream auth; client never sees upstream creds | Resolved |
| D-03 | Notion first, but connector stays domain-agnostic | Resolved |
| D-04 | Multi-tenant data model now, multi-tenancy later | Resolved |
| D-05 | Downstream MVP auth = connector API key (bearer) | Resolved (pending G1 confirmation) |
| D-06 | Advertise mediated intersection of capabilities | Resolved |
| D-07 | Transparent JSON-RPC forwarding | Resolved |
| D-08 | MVP may be stateless; SSE is additive | Proposed (confirm via G1/G2, G4) |
| D-09 | Language/runtime + deployment target | Deferred — decide at M1 (Phase 1) |
| D-10 | Credential-store backend + master key | Deferred — decide at M3 (Phase 3) |
| D-11 | Operator OAuth consent UX | Deferred — decide at M3 (Phase 3) |

## Gate-status record

Gate outcomes are recorded here as they are produced during validation. Until a
gate has a recorded outcome, it is **BLOCKED — VALIDATION REQUIRED** and the
downstream phases it guards must not begin (see [ROADMAP.md](ROADMAP.md)).

| Gate | After phase | Guards | Outcome | Evidence |
| --- | --- | --- | --- | --- |
| G1 — OpenHands Cloud compatibility | Phase 1 (M1) | Phase 2 onward | BLOCKED — VALIDATION REQUIRED | — |
| G2 — Notion OAuth behavior | Phase 1 (M1) | Phase 3 onward | BLOCKED — VALIDATION REQUIRED | — |
| G3 — Notion MCP tool surface sufficient | Phase 1 (M1) | Phase 5 onward | BLOCKED — VALIDATION REQUIRED | — |
| G4 — Minimal connector forwards MCP | Phase 2 (M2) | Phase 3 onward | Not started | — |
| G5 — Auth boundary holds | Phase 3 (M3) | Phase 4 onward | Not started | — |
| G6 — OpenHands connects via connector, isolation holds | Phase 4 (M4) | Phase 5 onward | Not started | — |
| G7 — Complete technical path validated | Phase 5 (M5) | Phase 6 onward | Not started | — |
| G8 — MVP complete (10-step, reproducible) | Phase 6 (M6) | Phase 7 onward | Not started | — |
| G9 — Generalization evidenced | Phase 7 (M7) | Phase 8 onward | Not started | — |
| G10 — Hardening verified | Phase 8 (M8) | Release | Not started | — |

## Open questions that must be answered before implementation

(See [MILESTONES.md](MILESTONES.md) §"Most important unresolved questions" for
the gate-mapped list.)

1. **G1 (M1):** Can OpenHands Cloud consume a bearer `api_key` remote MCP
   endpoint with no custom headers and no interactive OAuth? — BLOCKED.
2. **G2 (M1):** Notion refresh-token lifetime/revocation semantics? — BLOCKED.
3. **G3 (M1):** Does Notion's hosted MCP tool surface cover read + update/create
   + comment read for the documentation workflow? — BLOCKED.
4. **D-09 (M1):** Language/runtime and deployment target.
5. **D-10 (M3):** Credential-store backend and master-key source.
6. **D-11 (M3):** Operator OAuth consent UX.
