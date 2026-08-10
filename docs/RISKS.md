# Risks

> Status: **Assessment.** Risks are categorized and rated for likelihood (L) and
> impact (I) on a 1–3 scale (1 low, 3 high). Mitigations are proposals. Items
> marked *(verify)* need confirmation during implementation. See
> [DECISIONS.md](DECISIONS.md) for how chosen design reduces specific risks.

## Technical risks

| ID | Risk | L | I | Mitigation |
| --- | --- | --- | --- | --- |
| T1 | OpenHands Cloud cannot consume the connector endpoint as expected (e.g. `api_key`-only, no custom headers, no interactive OAuth). *(verify)* | 2 | 3 | **Phase 1 gate G1** — confirm before any code; if FAILS, reassess D-05 downstream interface. Do not implement on an unverified basis. |
| T2 | Notion's hosted MCP surface is too narrow for the documentation loop (no block-level editing, no file uploads; comment tools may be limited). | 2 | 2 | **Phase 1 gate G3** — confirm read/update/comment surface before Phase 5; if INSUFFICIENT, reassess use case (ARCHITECTURE §4-C). |
| T3 | Notion refresh tokens are short-lived or get revoked, forcing frequent operator re-consent. *(verify)* | 2 | 3 | **Phase 1 gate G2** — establish token lifecycle before building the credential subsystem (Phase 3); design reauth-required state + low-friction re-consent. |
| T4 | MCP protocol-version drift between downstream and upstream legs (client expects newer/older features than upstream offers). | 2 | 2 | Mediate capabilities conservatively (advertise intersection); pin/negotiate protocol version per leg independently. |
| T5 | Capability advertisement caching becomes stale after upstream changes (tools added/removed). | 2 | 2 | TTL or reconnect-driven invalidation of cached `*/list`; re-fetch on session re-init. |
| T6 | SSE streaming semantics differ enough across upstreams/clients to cause stuck or dropped streams. | 2 | 2 | Make SSE optional for MVP (stateless request/response path); add resumption (`Last-Event-Id`) in Phase 8. |

## Security risks

| ID | Risk | L | I | Mitigation |
| --- | --- | --- | --- | --- |
| S1 | Upstream OAuth tokens leak into logs, error messages, or downstream responses. | 2 | 3 | Redact all tokens in logging; structured redaction tests (grep assertions at M2/M6); errors never include bearer tokens. |
| S2 | Upstream credentials leak because the credential store is misconfigured or unencrypted at rest. | 1 | 3 | Encryption at rest mandatory from M2; master key from secrets backend (never in VCS); access limited to auth manager. |
| S3 | Downstream connector API key is over-privileged or shared broadly, allowing unauthorized upstream use. | 2 | 2 | Single shared key for MVP only; per-client keys in Phase 6; key rotation support; audit log of usage. |
| S4 | A compromised/malicious upstream response is relayed downstream (e.g. prompts injection via tool results). | 2 | 2 | The connector forwards MCP faithfully (by design) — document that content safety is the client's responsibility; do not sanitize tool results in ways that break transparency. |
| S5 | The connector's own OAuth client credentials are exposed (client secret in code/config). | 1 | 3 | Store client secret in the secrets backend; PKCE reduces reliance on a static secret for public-client flows; never commit. **D-10:** DCR `client_id`/`client_secret` persisted encrypted (field-level AES-256-GCM) in the SQLite store. |
| S6 | Multi-tenant credential cross-talk (one tenant's key reaches another's upstream token). | 1 | 3 | Not in MVP; design the `(key → credential)` mapping to enforce isolation from the start (D-04); add isolation tests in Phase 6. |
| S7 | Open redirect / CSRF in the connector-hosted OAuth callback. | 1 | 3 | Validate `redirect_uri` against an allowlist; use `state` parameter; bind callback to the operator session. **D-11:** callback allowlisted to the connector's own `/oauth/callback`; `state` + PKCE bind the callback to the initiated flow. |
| S8 | Master key is lost (operator loses `MCPRELAY_MASTER_KEY`) → encrypted credentials are unrecoverable. | 1 | 3 | **D-10:** master key backed up **separately** from the encrypted SQLite file (secrets manager); document that losing the key = data loss by design; fail-fast on missing key. Rotation/re-encryption procedure documented. |
| S9 | Concurrent refresh of the same Notion grant causes `invalid_grant` (losers retired). | 2 | 3 | **D-10/D-12:** per-grant in-process mutex serializes refresh (G2 invariant); refresh manager holds the mutex across the network refresh + atomic persistence. Tested at G5. |
| S10 | Refresh-token rotation lost mid-write (crash between receiving new token and persisting) → old token retired, new not stored. | 1 | 3 | **D-10:** `(access_token, refresh_token)` written **atomically** in a single SQLite transaction (synchronous better-sqlite3); crash-during-write still leaves a consistent prior-or-new state. G2 restart-survival test at G5. |

## Architectural risks

| ID | Risk | L | I | Mitigation |
| --- | --- | --- | --- | --- |
| A1 | The connector accrues domain-specific logic over time, becoming a Notion adapter (scope creep). | 2 | 2 | Enforce "no domain logic" in review; keep forwarding transparent; route Notion-specific needs to a separate adapter component if ever needed. |
| A2 | Stateful session management adds operational complexity (memory growth, sticky sessions). | 2 | 2 | Prefer stateless request/response for MVP; isolate statefulness to where MCP requires it; reclaim idle sessions. |
| A3 | Multi-upstream namespacing breaks clients that assume un-namespaced tool names. | 2 | 2 | Namespacing only when >1 upstream is configured; single-upstream mode passes names through unchanged. |
| A4 | Premature generalization (building multi-tenant/multi-upstream before the MVP is validated). | 2 | 2 | Roadmap defers generality to Phase 5; data model accommodates it without implementing it early. |
| A5 | Over-coupling to a specific MCP SDK limits transport/protocol evolution. | 2 | 2 | Isolate SDK usage behind an internal transport interface; allow swapping client/server transport impl. |

## Operational risks

| ID | Risk | L | I | Mitigation |
| --- | --- | --- | --- | --- |
| O1 | Upstream Notion outage/rate-limiting causes the connector to hang or flood. | 2 | 2 | Timeouts, backoff, jittered retries, circuit breaking; surface structured errors; never retry 401 beyond one refresh-retry. |
| O2 | Operator re-consent required at an inconvenient time with no graceful degradation. | 2 | 2 | Clear `reauth-required` state + alerting; runbook for re-consent. |
| O3 | No visibility into auth/forwarding failures (silent breakage). | 2 | 3 | Structured logs + metrics + audit log from M3; alerting in Phase 6. |
| O4 | Deployment/rollback is manual and error-prone, risking credential exposure during deploys. | 2 | 3 | CI/CD with secrets from a backend (never env files in VCS); rollback path tested. |
| O5 | Secret rotation (master key, Notion OAuth, downstream keys) causes downtime or data loss. | 1 | 3 | Design rotation support (D-* in DECISIONS); test rotation in Phase 6. |
| O6 | Dependency on Notion's hosted MCP SLA/availability with no fallback. | 2 | 2 | Out of MVP scope; document as a known dependency; future option is an alternative Notion upstream. |

## Process / scope risks

| ID | Risk | L | I | Mitigation |
| --- | --- | --- | --- | --- |
| P1 | Treating observations/hypotheses as confirmed facts during implementation. | 2 | 2 | This doc set labels claim types; re-verify any protocol assumption against official docs before coding on it. |
| P2 | Building the connector into a project-management or AI-reasoning layer. | 1 | 2 | Non-Goals enforced in review; architectural boundaries in ARCHITECTURE.md §8. |
| P3 | The self-referential use case (Phase 6 / M6) creates circular dependencies between docs and tooling. | 1 | 2 | Keep the connector domain-agnostic; Notion content is data, not connector logic. |

## Risk register ownership

- Each risk is owned by the gate/phase it most affects (see
  [ROADMAP.md](ROADMAP.md)). Technical risks T1/T2/T3 are owned by the **Phase 1
  validation gates G1/G2/G3** and block implementation until resolved.
- Security risks (S*) are owned throughout but specifically validated at M3
  (G5), M4 (G6), and M8 (G10).
- Risks marked *(verify)* feed directly into the gate-mapped open questions in
  [MILESTONES.md](MILESTONES.md) §"Most important unresolved questions" and the
  gate-status record in [DECISIONS.md](DECISIONS.md).
