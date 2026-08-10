# Roadmap

> Status: **Strict gated development contract.** The project progresses through
> evidence-based gates. A later phase **MUST NOT begin** until the exit gate of
> the previous phase has been satisfied and documented. "Code exists" is not
> completion; a phase is complete only when its acceptance criteria have been
> *demonstrated* and *documented*. See [MILESTONES.md](MILESTONES.md) for the
> measurable criteria behind each gate, [DECISIONS.md](DECISIONS.md) for
> decisions recorded at gates, and [RISKS.md](RISKS.md) for risks surfaced
> during validation.

## Progression principle

```
Research → Validation → Prototype → Authentication → Client Integration
        → End-to-End Validation → Generalization → Hardening
```

Nothing is implemented on an unverified external assumption. The three
external assumptions (OpenHands Cloud compatibility, Notion OAuth behavior,
Notion tool-surface sufficiency) are **blocking gates in Phase 1** that must
pass *before* any connector code is written (Phase 2).

## Phase / MVP map

- **MVP technical path validated:** Phase 5 exit gate (G7).
- **MVP complete (full end-to-end success criterion, reproducible):** Phase 6
  exit gate (G8).
- **Generalization (Phase 7) and Hardening (Phase 8) are explicitly *after* the
  MVP** and are driven by MVP evidence, not assumptions.

## Gates at a glance

| Gate | After phase | Blocks until satisfied | Current status |
| --- | --- | --- | --- |
| G1 — OpenHands Cloud compatibility confirmed | Phase 1 | Phase 2 onward | **PASS (2026-08-10)** — see [evidence/G1.md](evidence/G1.md) |
| G2 — Notion OAuth behavior confirmed | Phase 1 | Phase 3 onward | **PASS (2026-08-10)** — see [evidence/G2.md](evidence/G2.md) |
| G3 — Notion MCP tool surface confirmed sufficient | Phase 1 | Phase 5 onward | **SUFFICIENT (2026-08-10)** — see [evidence/G3.md](evidence/G3.md) |
| G4 — Minimal connector forwards MCP (mock upstream) | Phase 2 | Phase 3 onward | Not started |
| G5 — Auth boundary holds (OAuth + secure store + refresh + restart) | Phase 3 | Phase 4 onward | Not started |
| G6 — OpenHands Cloud connects via connector, no upstream creds in sandbox | Phase 4 | Phase 5 onward | Not started |
| G7 — Complete technical path OpenHands→Connector→Notion validated | Phase 5 | Phase 6 onward | Not started |
| G8 — MVP complete: full 10-step end-to-end demonstration, reproducible | Phase 6 | Phase 7 onward | Not started |
| G9 — Generalization driven by MVP evidence; second upstream works | Phase 7 | Phase 8 onward | Not started |
| G10 — Security / SLO / resilience / deployment hardening verified | Phase 8 | Release | Not started |

---

## PHASE 0 — Repository and Architecture Baseline

- **Objective:** Establish a grounded, fact-checked design baseline and the
  gated development contract before any validation or code.
- **Scope (allowed):** Finalize `README.md` and the `docs/` set; label confirmed
  facts / observations / hypotheses / proposals / open questions; record
  architecture, auth, flow, decisions, risks, roadmap, milestones.
- **Out of scope:** Any connector implementation; any external-assumption
  validation (that is Phase 1); choosing a final language/runtime (deferred to a
  Phase 1 decision, D-09).
- **Inputs:** Access to MCP, OpenHands, and Notion official documentation.
- **Activities:** Architecture design; alternatives analysis; risk
  identification; defining the MVP and the gated phase sequence.
- **Deliverables:** `README.md`, `AGENTS.md`, and `docs/{PROBLEM,ARCHITECTURE,
  AUTHENTICATION,MCP-FLOW,ROADMAP,MILESTONES,RISKS,DECISIONS}.md`.
- **Acceptance criteria:**
  - AC-P0-1: The full `docs/` set exists and is internally consistent.
  - AC-P0-2: Every protocol-specific claim is cited to an official source.
  - AC-P0-3: Confirmed facts vs hypotheses vs proposals vs open questions are
    labeled throughout.
  - AC-P0-4: The MVP is explicitly defined; the gated phase sequence is explicit.
  - AC-P0-5: The six existing unresolved questions are mapped to specific
    Phase 1 gates (G1–G3) or Phase 2/3 decisions (D-09/D-10/D-11).
- **Exit gate:** Design reviewed; the six unresolved questions are triaged into
  "must validate at G1–G3" vs "must decide before Phase 2/3".
- **Failure condition:** Re-open the design; do not proceed to Phase 1 until
  the baseline is consistent and cited.
- **Decision required:** None new (D-01..D-08 already resolved; D-09..D-11
  deferred to Phase 1/2/3).

> **PHASE 0 STATUS: COMPLETE.** This document set is the Phase 0 deliverable.
> The project is now in Phase 1 (External Assumption Validation). G1 = PASS;
> G2 and G3 remain to be validated.

---

## PHASE 1 — External Assumption Validation

- **Objective:** Convert the three load-bearing external assumptions into
  **evidence** before any connector code is written. This phase produces no
  production code.
- **Scope (allowed):** Read official docs; run controlled experiments against
  OpenHands Cloud and Notion's hosted MCP that do *not* involve the connector;
  capture verbatim evidence; record outcomes in DECISIONS.md/RISKS.md.
- **Out of scope:** Writing the connector; choosing credential-store backend
  (D-10) and consent UX (D-11) — those depend on G1/G2 outcomes and are decided
  at the start of Phase 3; implementing the downstream interface.
- **Inputs:** Phase 0 design; access to an OpenHands Cloud workspace; a Notion
  workspace and a Notion OAuth client.
- **Activities:**
  - **G1:** Determine whether OpenHands Cloud can consume a remote MCP endpoint
    authenticated with a **bearer `api_key`**, with **no custom headers** and
    **no interactive OAuth**. (Confirms/refutes hypotheses H-P1/H-P3 from
    PROBLEM.md.)
  - **G2:** Establish Notion OAuth **token lifecycle**: access-token TTL,
    whether a refresh token is issued, its lifetime, revocation behavior, and
    the `invalid_grant` path. (Confirms/refutes assumptions behind D-10/D-11.)
  - **G3:** Confirm Notion's hosted MCP **tool surface** covers the
    documentation workflow: at minimum page-level **read**, page-level
    **update/create**, and **reading comments**. (Confirms/refutes the Phase 6
    documentation-loop viability.)
  - Also resolve **D-09 (language/runtime + deployment target)** here, because
    it gates Phase 2 and depends on G1/G2 findings (e.g. SSE, callback hosting).
- **Deliverables:** A validation record per gate (G1/G2/G3) with verbatim
  evidence and a pass/fail; an updated D-09 decision.
- **Acceptance criteria:**
  - AC-P1-1 (G1): Documented evidence shows OpenHands Cloud either does or does
    not consume the proposed bearer-`api_key` endpoint without custom headers /
    interactive OAuth. Outcome recorded as PASS or FAIL.
  - AC-P1-2 (G2): Documented evidence of Notion access-token TTL, refresh-token
    presence/lifetime, and revocation/`invalid_grant` behavior. Outcome recorded.
  - AC-P1-3 (G3): Documented evidence of which Notion hosted-MCP tools exist
    for read, update/create, and comments. Outcome recorded as SUFFICIENT or
    INSUFFICIENT.
  - AC-P1-4: D-09 (language/runtime + deploy target) is recorded with rationale.
- **Exit gate:** G1 = PASS **and** G2 = PASS **and** G3 = SUFFICIENT **and**
  D-09 decided. All four must hold.
- **Failure condition:**
  - If G1 FAILS → STOP. Reassess the downstream interface (D-05) before Phase 2;
    do not implement the downstream connector interface on an unverified basis.
  - If G2 cannot be established → STOP. Do not build the credential subsystem
    (Phase 3) around assumptions; reassess consent/refresh design (D-10/D-11).
  - If G3 = INSUFFICIENT → STOP. Reassess the architecture/use case (the
    documentation loop may need a different upstream or a separate Notion REST
    adapter — see ARCHITECTURE.md §4-C); do not proceed on a surface that cannot
    support the workflow.
- **Decision required:** D-09 (must). D-10/D-11 inputs gathered (decided at
  Phase 3 entry).

> **PHASE 1 STATUS: COMPLETE.** G1 = PASS, G2 = PASS, G3 = SUFFICIENT (all
> 2026-08-10), and D-09 = DECIDED (2026-08-10): TypeScript/Node.js +
> `@modelcontextprotocol/sdk`, SQLite credential store, Docker + reverse-proxy
> TLS. All Phase 1 exit-gate requirements are satisfied. Phase 2 is unblocked.

---

## PHASE 2 — Minimal Technical Prototype

- **Objective:** Prove the bidirectional MCP proxy/gateway shape end-to-end
  against a **mock upstream**, with no real authentication.
- **Scope (allowed):** Downstream-facing Streamable HTTP MCP server
  (`initialize`, `tools/list`, `tools/call`); upstream-facing MCP client to a
  **local/mock upstream** with a few tools; transparent forwarding; basic
  structured logging; `Mcp-Session-Id` correlation per leg.
- **Out of scope:** Real Notion OAuth (Phase 3); any credential store; any
  downstream auth beyond a placeholder; OpenHands Cloud (Phase 4);
  multi-upstream (Phase 7).
- **Inputs:** Phase 1 passed (G1–G3, D-09). Chosen stack (D-09):
  **TypeScript/Node.js + `@modelcontextprotocol/sdk`** (server + client,
  Streamable HTTP); SQLite credential store; Docker deployment. Phase 2 uses a
  **mock upstream** (no real Notion OAuth yet — that is Phase 3).
- **Activities:** Implement the two MCP legs and the forwarding core against a
  mock upstream; write a smoke test.
- **Deliverables:** Runnable connector + mock upstream + smoke test.
- **Acceptance criteria:**
  - AC-P2-1: An MCP client `initialize`s against the connector, lists tools,
    and calls one — receiving the mock upstream's result, forwarded
    transparently.
  - AC-P2-2: `Mcp-Session-Id` is issued/correlated on both legs.
  - AC-P2-3: No upstream-specific business logic exists in the connector
    (verified by review: it forwards whatever tools the mock exposes).
- **Exit gate (G4):** Minimal connector successfully forwards MCP capabilities
  and tool calls against a mock upstream. Only after G4 may auth work proceed.
- **Failure condition:** Revisit the forwarding/transport design (D-08); do not
  proceed to authentication on a broken proxy core.
- **Decision required:** D-08 confirmation (stateless vs SSE for MVP) if not
  already settled by G1/G2 evidence.

---

## PHASE 3 — Authentication and Credential Boundary

- **Objective:** Make the connector authenticate to Notion's real hosted MCP
  via OAuth, with credentials held **only** on the connector side, isolated from
  any downstream client.
- **Scope (allowed):** RFC 9470 → RFC 8414 discovery; OAuth 2.1 + PKCE with a
  connector-hosted operator consent flow (D-11); encrypted credential store
  (D-10); proactive refresh; 401-refresh-retry once; `invalid_grant` →
  reauth-required state; upstream `initialize` to Notion; cache tool surface.
- **Out of scope:** Downstream-facing auth for OpenHands (Phase 4); the
  end-to-end loop (Phase 5/6); multi-upstream (Phase 7).
- **Inputs:** Phase 2 (G4); G2 evidence (token lifecycle); D-10 and D-11
  decisions; a Notion workspace + OAuth client.
- **Activities:** Implement the auth manager + credential store; perform one
  operator OAuth consent; verify refresh and restart behavior.
- **Deliverables:** Connector that authenticates to Notion once (operator) and
  forwards Notion's tool list, with credentials encrypted at rest.
- **Acceptance criteria:**
  - AC-P3-1: Operator completes Notion OAuth 2.1 + PKCE once; access/refresh
    tokens stored encrypted at rest.
  - AC-P3-2: No plaintext secret appears in logs, config, or test artifacts
    (verified by grep assertion).
  - AC-P3-3: `tools/list` through the connector returns Notion's tools.
  - AC-P3-4: After access-token expiry, the connector refreshes and a
    subsequent tool call succeeds without operator action.
  - AC-P3-5: After the connector process restarts, it re-establishes an
    authenticated upstream MCP connection using stored credentials (no re-consent).
  - AC-P3-6: After token revocation, the connector returns a clear
    "reauth-required" state (no silent hang, no infinite retry).
  - AC-P3-7: No Notion OAuth token is present in any downstream-facing response.
- **Exit gate (G5):** OAuth authorization completes successfully, the resulting
  credentials are persisted securely, token refresh is demonstrated, and the
  connector can establish an authenticated upstream MCP connection after restart.
- **Failure condition:** If token lifecycle contradicts the design (e.g.
  refresh impossible), STOP and reassess D-10/D-11; do not ship an auth boundary
  that cannot persist credentials safely.
- **Decision required:** D-10 (credential-store backend + master key), D-11
  (operator consent UX) — both must be decided at Phase 3 entry.

---

## PHASE 4 — OpenHands Cloud Integration

- **Objective:** OpenHands Cloud consumes the connector as a remote MCP server
  using the connector's client-facing authentication, and discovers Notion
  capabilities through it.
- **Scope (allowed):** Downstream auth = connector-issued bearer API key
  (D-05), confirmed compatible by G1; connector endpoint reachable by OpenHands
  Cloud; forward `tools/list` and `tools/call` to Notion; basic audit log
  (caller id, upstream, tool, outcome, latency).
- **Out of scope:** The full documentation loop (Phase 6); generalization
  (Phase 7); multi-tenant keys (Phase 8).
- **Inputs:** Phase 3 (G5); G1 PASS (OpenHands Cloud compatibility); an
  OpenHands Cloud workspace.
- **Activities:** Implement downstream auth + endpoint; configure OpenHands
  Cloud; verify discovery and a single read + single write call through the
  connector; verify credential isolation by inspecting the OpenHands runtime.
- **Deliverables:** Deployed connector; OpenHands Cloud MCP config; operator
  runbook (OAuth consent + key issuance).
- **Acceptance criteria:**
  - AC-P4-1: OpenHands Cloud, configured with connector URL + bearer `api_key`
    (no custom headers, no interactive OAuth), connects successfully.
  - AC-P4-2: OpenHands Cloud lists Notion tools via the connector.
  - AC-P4-3: OpenHands Cloud performs one read tool call through the connector
    and receives Notion data.
  - AC-P4-4: OpenHands Cloud performs one write tool call through the connector
    and the change is visible in Notion.
  - AC-P4-5: An audit-log entry exists for each call with no secret material.
  - AC-P4-6: Inspection of the OpenHands runtime shows no Notion OAuth/API
    token (credential isolation verified).
- **Exit gate (G6):** OpenHands Cloud connects, authenticates via the
  connector's client-facing mechanism, discovers Notion capabilities, and no
  upstream credential is present in the OpenHands sandbox.
- **Failure condition:** If OpenHands Cloud cannot consume the endpoint despite
  G1, STOP and reassess D-05/downstream interface; do not generalize a broken
  integration.
- **Decision required:** None new.

---

## PHASE 5 — Notion End-to-End Validation

- **Objective:** Validate the **complete technical path**
  `OpenHands Cloud → MCP Connector → authenticated Notion MCP → Notion` against
  real Notion, including the required documentation-workflow operations.
- **Scope (allowed):** Exercise read, update/create, and comment-read operations
  against the real Notion workspace through the connector; verify credential
  isolation end-to-end; record a reproducible run.
- **Out of scope:** The self-referential development *loop* as a repeated
  workflow (Phase 6); generalization (Phase 7).
- **Inputs:** Phase 4 (G6); G3 SUFFICIENT (tool surface confirmed).
- **Activities:** Run the required operation types through the connector;
  verify isolation; capture artifacts.
- **Deliverables:** A validated, reproducible end-to-end technical run.
- **Acceptance criteria:**
  - AC-P5-1: A read operation (e.g. search/fetch a page) succeeds through the
    full path and returns real Notion data.
  - AC-P5-2: A write operation (e.g. create/update a page) succeeds and is
    visible in Notion.
  - AC-P5-3: A comment-read operation succeeds (per G3 surface).
  - AC-P5-4: No Notion credential appears in the OpenHands sandbox or in
    connector logs (verified by inspection + grep).
  - AC-P5-5: The run is reproducible from a documented procedure.
- **Exit gate (G7):** The complete technical path is validated end-to-end with
  read + write + comment operations, and credential isolation is verified.
- **Failure condition:** If any operation type fails, STOP; if the failure is a
  surface gap, re-open G3/ARCHITECTURE §4-C; do not declare the MVP technical
  path complete.
- **Decision required:** None new.

> At G7 the **MVP technical path** is proven. The **MVP is complete** only at
> G8 (Phase 6), which adds the documented, reproducible development loop.

---

## PHASE 6 — Development Feedback Loop

- **Objective:** Demonstrate the self-referential development workflow as a
  reproducible loop, completing the MVP end-to-end success criterion.
- **Scope (allowed):** Establish the Notion "Software Development" area for MCP
  Connector content; run the loop
  `Development → Documentation → Stakeholder Review → Feedback → OpenHands →
  Further Development`; document and reproduce it.
- **Out of scope:** Generalization (Phase 7); hardening (Phase 8).
- **Inputs:** Phase 5 (G7); a Notion Software Development area seeded with MCP
  Connector content.
- **Activities:** Have OpenHands read dev docs, update docs, and read
  stakeholder comments through the connector; capture the full loop.
- **Deliverables:** A documented, reproducible end-to-end demonstration of the
  loop (the MVP artifact).
- **Acceptance criteria (the MVP end-to-end success criterion — all must pass):**
  - AC-P6-1: Operator authorizes the connector to access Notion.
  - AC-P6-2: Connector securely stores the required upstream credentials.
  - AC-P6-3: OpenHands Cloud connects to the connector.
  - AC-P6-4: OpenHands authenticates using the connector's client-facing
    mechanism.
  - AC-P6-5: OpenHands discovers the available Notion MCP capabilities.
  - AC-P6-6: OpenHands reads the Software Development documentation.
  - AC-P6-7: OpenHands updates development documentation.
  - AC-P6-8: OpenHands reads stakeholder feedback/comments where supported.
  - AC-P6-9: No Notion OAuth credentials are present in the OpenHands sandbox.
  - AC-P6-10: The complete flow is documented and reproducible.
- **Exit gate (G8 — MVP COMPLETE):** All ten end-to-end success-criterion steps
  pass and the loop is reproducible. If any critical step fails, the MVP is NOT
  complete.
- **Failure condition:** Re-open the failing phase; do not begin generalization
  on an incomplete MVP.
- **Decision required:** None new.

---

## PHASE 7 — Generalization

- **Objective:** Extend the connector to additional upstreams and auth schemes,
  **driven by MVP evidence**, without breaking the Notion path.
- **Scope (allowed):** Multi-upstream routing; namespaced tool names;
  config-driven upstream registration (URL, auth scheme, credential ref); a
  second upstream with a **different** auth scheme (one OAuth-based, one
  API-key-based); per-upstream lifecycle/health.
- **Out of scope:** Multi-tenant SaaS; multi-user isolation depth (Phase 8).
- **Inputs:** Phase 6 (G8) — MVP complete.
- **Activities:** Add a second upstream of each auth type behind the same
  downstream endpoint; verify the Notion path is unaffected.
- **Deliverables:** Connector config schema for multiple upstreams; a working
  second upstream (OAuth) and a working second upstream (API-key).
- **Acceptance criteria:**
  - AC-P7-1: A downstream caller sees tools from two upstreams, namespaced, and
    can call either through one endpoint and one auth key.
  - AC-P7-2: Adding an API-key upstream requires no OAuth code path.
  - AC-P7-3: The Notion path still satisfies G6/G7 (no regression).
  - AC-P7-4: Generalization is justified by MVP evidence, not assumption
    (recorded in DECISIONS.md).
- **Exit gate (G9):** Generalization is evidenced and a second upstream of
  each auth scheme works without regressing the Notion MVP.
- **Failure condition:** If generalization requires domain logic, STOP and
  reassess D-07 (transparency); do not turn the connector into adapters.
- **Decision required:** Routing/config format; capability-intersection
  policy across heterogeneous upstreams.

---

## PHASE 8 — Hardening / Release

- **Objective:** Make the connector secure and reliable enough to rely on.
- **Scope (allowed):** Threat-model pass + pen-test of the auth boundary;
  secret-redaction audits; multi-tenant credentials and per-client downstream
  keys if justified; resilience (reconnect/backoff, SSE resumption, graceful
  shutdown, upstream rate-limit handling, jittered retries, circuit breaking);
  observability (metrics, dashboards, alerting); reproducible deployment with
  secrets from a backend (CI/CD, rollback); append-only audit log with retention.
- **Out of scope:** Features not justified by MVP/generalization evidence.
- **Inputs:** Phases 5–7 functional.
- **Activities:** Security review; load/chaos testing; deploy hardening.
- **Deliverables:** Security review record; SRE runbooks; production
  deployment; SLO definitions and measurements.
- **Acceptance criteria:**
  - AC-P8-1: No upstream credential is reachable from the downstream client or
    logs (automated test).
  - AC-P8-2: SLOs defined and met under load (targets in
    [MILESTONES.md](MILESTONES.md)).
  - AC-P8-3: Resilience verified: upstream outage → structured errors (not
    hangs); token revocation → clear reauth path; SSE drops → resumption/reconnect.
  - AC-P8-4: Deployment is reproducible via CI/CD with rollback; secrets from a
    secrets backend (never env files in VCS).
  - AC-P8-5: Audit log is append-only with defined retention.
- **Exit gate (G10):** Security review passes, SLOs met, resilience verified,
  deployment reproducible.
- **Failure condition:** Block release; address failures; do not lower the
  security bar to ship.
- **Decision required:** SLO targets; secrets-backend integration;
  multi-tenant isolation depth.

---

## Scope control — explicitly NOT in the initial roadmap

Excluded unless and until justified by evidence in a later phase:

- Multi-tenant SaaS and enterprise identity management.
- Arbitrary protocol translation beyond MCP Streamable HTTP bridging.
- AI reasoning, planning, or prompt assembly inside the connector.
- Application-specific Notion logic (page/block modeling) in the connector.
- Project-management functionality; automatic interpretation of stakeholder
  requirements.
- A large-scale observability platform; unnecessary UI.
- Additional upstreams (GitHub, Jira, Linear, Google Drive, etc.) before
  Phase 7 — **not** in the MVP.

## Stopping conditions (summary)

- G1 FAILS → do not implement the downstream interface on an unverified basis.
- G2 unestablished → do not build the credential subsystem on assumptions.
- G3 INSUFFICIENT → reassess architecture/use case before proceeding.
- G4 FAILS → do not build auth on a broken proxy core.
- G5 FAILS → do not ship an auth boundary that cannot persist credentials safely.
- G6 FAILS → do not generalize a broken client integration.
- G7 FAILS → MVP technical path not complete; re-open the failing operation.
- G8 FAILS (any of 10 steps) → MVP is NOT complete; no generalization.
- G9 FAILS → do not release adapters masquerading as a general connector.
- G10 FAILS → no release.

## References

[^notion-build-client]: Notion — Build an MCP client (discovery, PKCE, token lifecycle): https://developers.notion.com/guides/mcp/build-mcp-client
[^oh-mcp-settings]: OpenHands — MCP settings (api_key support, OAuth headless caveat): https://docs.openhands.dev/openhands/usage/settings/mcp-settings
