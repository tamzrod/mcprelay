# Milestones and Acceptance Criteria

> Status: **Gated milestones.** Milestones are the measurable, evidence-based
> checkpoints behind the gates in [ROADMAP.md](ROADMAP.md). A milestone is
> complete only when its acceptance criteria have been **demonstrated and
> documented** — "code exists" is not completion. Criteria marked
> *(verify)* depend on facts confirmed during an earlier gate; if the gate is
> still **BLOCKED**, the criterion cannot yet be satisfied.

## MVP definition (strict)

> **MVP:** OpenHands Cloud can securely access Notion MCP through the MCP
> Connector using the connector's authentication boundary, **without exposing
> Notion credentials to the OpenHands sandbox.**

The MVP demonstrates the complete technical path:

```
OpenHands Cloud → MCP Connector → authenticated Notion MCP → Notion
```

and validates at least the required MCP operations for the intended
documentation workflow (read, update, read comments).

The MVP is **not** "support arbitrary authenticated MCP servers." No GitHub,
Jira, Linear, Google Drive, multi-user tenancy, or other upstream services are
in the MVP. Those are Phase 7+, gated on MVP evidence.

### MVP completion boundary

- **MVP technical path validated** → M5 (G7).
- **MVP complete (full 10-step end-to-end success criterion, reproducible)** →
  M6 (G8). The MVP is not declared complete until G8 passes.

## End-to-End Success Criterion (the MVP demonstration)

All ten steps must pass. If any critical step fails, the MVP is NOT complete.

1. Operator authorizes the connector to access Notion.
2. Connector securely stores the required upstream credentials.
3. OpenHands Cloud connects to the connector.
4. OpenHands authenticates using the connector's client-facing mechanism.
5. OpenHands discovers the available Notion MCP capabilities.
6. OpenHands reads the Software Development documentation.
7. OpenHands updates development documentation.
8. OpenHands reads stakeholder feedback/comments where supported.
9. No Notion OAuth credentials are present in the OpenHands sandbox.
10. The complete flow is documented and reproducible.

---

## M0 — Architecture baseline accepted (Phase 0)

- **Maps to:** Phase 0. Gate: Phase 0 exit.
- **Definition of done:** The gated design baseline exists and is internally
  consistent.
- **Acceptance criteria:**
  - AC-M0-1: `README.md`, `AGENTS.md`, and `docs/{PROBLEM,ARCHITECTURE,
    AUTHENTICATION,MCP-FLOW,ROADMAP,MILESTONES,RISKS,DECISIONS}.md` exist.
  - AC-M0-2: All protocol-specific claims are cited to official sources.
  - AC-M0-3: Confirmed facts / observations / hypotheses / proposals / open
    questions are labeled throughout.
  - AC-M0-4: The MVP is explicitly defined and mapped to gates (G7/G8).
  - AC-M0-5: The six unresolved questions are mapped to G1–G3 or D-09/D-10/D-11.
- **Exit gate:** Design reviewed; questions triaged.
- **Status:** **COMPLETE.**

## M1 — External assumptions validated (Phase 1)

- **Maps to:** Phase 1. Gates: G1, G2, G3; plus D-09 decided.
- **Definition of done:** The three load-bearing external assumptions are
  confirmed by evidence (not assumption), and the language/runtime is chosen.
- **Acceptance criteria:**
  - AC-M1-1 (G1): Documented evidence that OpenHands Cloud can consume a
    bearer-`api_key` remote MCP endpoint with no custom headers and no
    interactive OAuth. **PASS** required. ***PASS (2026-08-10)*** — see
    [evidence/G1.md](evidence/G1.md)
  - AC-M1-2 (G2): Documented evidence of Notion access-token TTL, refresh-token
    presence/lifetime, and revocation/`invalid_grant` behavior. **PASS**
    required. ***PASS (2026-08-10)*** — see [evidence/G2.md](evidence/G2.md)
  - AC-M1-3 (G3): Documented evidence that Notion's hosted MCP exposes tools
    for page read, page update/create, and comment read. **SUFFICIENT**
    required. ***SUFFICIENT (2026-08-10)*** — see [evidence/G3.md](evidence/G3.md)
  - AC-M1-4: D-09 (language/runtime + deployment target) recorded with rationale.
    ***DECIDED (2026-08-10)*** — TypeScript/Node.js + `@modelcontextprotocol/sdk`;
    SQLite creds; Docker + reverse-proxy TLS. See
    [DECISIONS.md §D-09](DECISIONS.md#d-09--implementation-languageruntime-and-deployment-target).
- **Exit gate:** G1=PASS **and** G2=PASS **and** G3=SUFFICIENT **and** D-09
  decided.
- **Failure actions:** G1 FAIL → reassess D-05; G2 unestablished → reassess
  D-10/D-11; G3 INSUFFICIENT → reassess use case (ARCHITECTURE §4-C).
- **Status:** **COMPLETE.** G1=PASS, G2=PASS, G3=SUFFICIENT (all 2026-08-10),
  and D-09=DECIDED (2026-08-10). Phase 1 exit gate satisfied; Phase 2 unblocked.

## M2 — Minimal connector forwards MCP (Phase 2)

- **Maps to:** Phase 2. Gate: G4.
- **Definition of done:** The bidirectional proxy shape works against a mock
  upstream, no real auth.
- **Acceptance criteria:**
  - AC-M2-1: An MCP client `initialize`s, lists tools, and calls one through
    the connector, receiving the mock upstream's result (transparent forwarding).
  - AC-M2-2: `Mcp-Session-Id` issued/correlated on both legs.
  - AC-M2-3: No upstream-specific business logic in the connector (review-verified).
- **Exit gate (G4):** Minimal connector forwards MCP capabilities and tool
  calls against a mock upstream.
- **Status:** Not started (blocked on M1).

## M3 — Authentication and credential boundary holds (Phase 3)

- **Maps to:** Phase 3. Gate: G5.
- **Definition of done:** Connector authenticates to Notion via OAuth once
  (operator), stores credentials encrypted, refreshes, and survives restart.
- **Acceptance criteria:**
  - AC-M3-1: Operator completes Notion OAuth 2.1 + PKCE once; tokens stored
    encrypted at rest.
  - AC-M3-2: No plaintext secret in logs/config/test artifacts (grep assertion).
  - AC-M3-3: `tools/list` through the connector returns Notion's tools.
  - AC-M3-4: After access-token expiry, refresh succeeds and a tool call works
    without operator action.
  - AC-M3-5: After process restart, an authenticated upstream MCP connection is
    re-established from stored credentials (no re-consent).
  - AC-M3-6: After token revocation, a clear "reauth-required" state is
    returned (no hang, no infinite retry).
  - AC-M3-7: No Notion OAuth token in any downstream-facing response.
- **Exit gate (G5):** OAuth completes; credentials persisted securely; refresh
  demonstrated; authenticated upstream connection re-established after restart.
- **Status:** Not started (blocked on M2).

## M4 — OpenHands Cloud integration (Phase 4)

- **Maps to:** Phase 4. Gate: G6.
- **Definition of done:** OpenHands Cloud consumes the connector via the
  connector's client-facing auth and discovers Notion capabilities, with
  credential isolation verified.
- **Acceptance criteria:**
  - AC-M4-1: OpenHands Cloud connects with connector URL + bearer `api_key`,
    no custom headers, no interactive OAuth. *(verify against G1 PASS)*
  - AC-M4-2: OpenHands lists Notion tools via the connector.
  - AC-M4-3: One read tool call succeeds through the connector.
  - AC-M4-4: One write tool call succeeds through the connector (visible in Notion).
  - AC-M4-5: Audit-log entry per call with no secret material.
  - AC-M4-6: Inspection of the OpenHands runtime shows no Notion OAuth/API token.
- **Exit gate (G6):** OpenHands Cloud connects, authenticates via the
  connector's mechanism, discovers Notion capabilities, and no upstream
  credential is in the OpenHands sandbox.
- **Status:** Not started (blocked on M3).

## M5 — Notion end-to-end technical path validated (Phase 5)

- **Maps to:** Phase 5. Gate: G7. → **MVP technical path validated.**
- **Definition of done:** The complete technical path works against real Notion
  for read + write + comment operations, with isolation verified.
- **Acceptance criteria:**
  - AC-M5-1: A read operation succeeds through the full path (real Notion data).
  - AC-M5-2: A write operation succeeds and is visible in Notion.
  - AC-M5-3: A comment-read operation succeeds (per G3 surface).
  - AC-M5-4: No Notion credential in the OpenHands sandbox or connector logs
    (inspection + grep).
  - AC-M5-5: The run is reproducible from a documented procedure.
- **Exit gate (G7):** Complete technical path validated end-to-end with read +
  write + comment operations; credential isolation verified.
- **Status:** Not started (blocked on M4).

## M6 — Development feedback loop / MVP complete (Phase 6)

- **Maps to:** Phase 6. Gate: G8. → **MVP COMPLETE.**
- **Definition of done:** The self-referential development loop is demonstrated
  and reproducible; all ten end-to-end success-criterion steps pass.
- **Acceptance criteria (= the 10-step end-to-end success criterion):**
  - AC-M6-1: Operator authorizes the connector to access Notion.
  - AC-M6-2: Connector securely stores the required upstream credentials.
  - AC-M6-3: OpenHands Cloud connects to the connector.
  - AC-M6-4: OpenHands authenticates using the connector's client-facing mechanism.
  - AC-M6-5: OpenHands discovers the available Notion MCP capabilities.
  - AC-M6-6: OpenHands reads the Software Development documentation.
  - AC-M6-7: OpenHands updates development documentation.
  - AC-M6-8: OpenHands reads stakeholder feedback/comments where supported.
  - AC-M6-9: No Notion OAuth credentials are present in the OpenHands sandbox.
  - AC-M6-10: The complete flow is documented and reproducible.
- **Exit gate (G8 — MVP COMPLETE):** All ten steps pass and the loop is
  reproducible. If any critical step fails, the MVP is NOT complete.
- **Status:** Not started (blocked on M5).

## M7 — Generalization (Phase 7)

- **Maps to:** Phase 7. Gate: G9. (Only after MVP complete at M6.)
- **Definition of done:** A second upstream of each auth scheme works behind one
  endpoint without regressing the Notion path.
- **Acceptance criteria:**
  - AC-M7-1: Downstream sees namespaced tools from two upstreams and can call
    either through one endpoint + one auth key.
  - AC-M7-2: Adding an API-key upstream requires no OAuth code path.
  - AC-M7-3: The Notion path still satisfies G6/G7 (no regression).
  - AC-M7-4: Generalization is justified by MVP evidence (recorded in DECISIONS.md).
- **Exit gate (G9):** Evidenced generalization; second upstream of each auth
  type works; no Notion regression.
- **Status:** Not started (blocked on M6; generalization must not begin before
  MVP).

## M8 — Hardening / Release (Phase 8)

- **Maps to:** Phase 8. Gate: G10.
- **Definition of done:** Connector is secure and reliable for sustained use.
- **Acceptance criteria:**
  - AC-M8-1: No upstream credential reachable from downstream client or logs
    (automated test).
  - AC-M8-2: SLOs defined and met under load. Initial proposed targets (subject
    to revision):
    - Availability (connector endpoint) ≥ 99.5%.
    - Forwarding median latency overhead ≤ 100ms (p95 ≤ 250ms) beyond upstream.
    - Auth-refresh success rate ≥ 99%; auto-recovery from expiry ≥ 99%.
  - AC-M8-3: Resilience verified — upstream outage (errors, not hangs), token
    revocation (clear reauth path), SSE drops (resumption/reconnect).
  - AC-M8-4: Reproducible CI/CD deployment with rollback; secrets from a
    secrets backend (never env files in VCS).
  - AC-M8-5: Append-only audit log with defined retention.
- **Exit gate (G10):** Security review passes; SLOs met; resilience verified;
  deployment reproducible.
- **Status:** Not started (blocked on M7).

---

## Cross-cutting conventions

- "Verified" criteria are demonstrated by an automated test or a captured
  artifact, never by assertion.
- Any criterion depending on an external behavior we have only *inferred* (not
  confirmed from official docs) is marked *(verify)* and traces to a gate
  (G1/G2/G3). It cannot be satisfied while that gate is BLOCKED.
- Each milestone's exit gate requires any open questions it surfaces to be
  recorded in [DECISIONS.md](DECISIONS.md) or [RISKS.md](RISKS.md).

## Most important unresolved questions (must answer before the indicated gate)

1. **G1 (M1):** Can OpenHands Cloud consume a bearer `api_key` remote MCP
   endpoint with no custom headers and no interactive OAuth? — **PASS
   (2026-08-10).** See [evidence/G1.md](evidence/G1.md).
2. **G2 (M1):** Notion refresh-token lifetime/revocation semantics? — **PASS
   (2026-08-10).** See [evidence/G2.md](evidence/G2.md).
3. **G3 (M1):** Does Notion's hosted MCP tool surface cover read + update/create
   + comment read for the documentation workflow? — **SUFFICIENT
   (2026-08-10).** See [evidence/G3.md](evidence/G3.md).
4. **D-09 (M1):** Language/runtime + deployment target — **DECIDED
   (2026-08-10):** TypeScript/Node.js + `@modelcontextprotocol/sdk`, SQLite
   creds, Docker + reverse-proxy TLS. See
   [DECISIONS.md §D-09](DECISIONS.md#d-09--implementation-languageruntime-and-deployment-target).
5. **D-10 (M3):** Credential-store backend + master-key source.
6. **D-11 (M3):** Operator OAuth consent UX.
