# ChatGPT Spec Review Session — ghl-module-c-oauth — 2026-05-03T02-49-56Z

## Session Info
- Spec: docs/ghl-module-c-oauth-spec.md
- Branch: ghl-agency-oauth
- PR: #254 — https://github.com/michaelhazza/automation-v1/pull/254
- Mode: manual
- Started: 2026-05-03T02:49:56Z
- **Verdict:** APPROVED (2 rounds)

---

## Round 1 — 2026-05-03T02:49:56Z

### ChatGPT Feedback (raw)

Executive summary: this is a strong, implementation-ready spec with clear sequencing, idempotency, and good handling of GHL quirks. The biggest risks are around race conditions (callback vs webhook), token lifecycle edge cases, and cross-tenant constraints. Nothing fundamentally blocks build, but there are a handful of gaps worth tightening before you finalise.

What's solid (keep as-is): Clear token model separation (agency vs location). Idempotency strategy is strong. Race handling between OAuth callback and INSTALL webhook. Phased build plan is realistic.

Gaps / tweaks (high value fixes before build):
1. Missing explicit org resolution at OAuth callback — state payload must include orgId + nonce (CSRF). OAuth callback must not proceed without a validated orgId from state.
2. Global unique index may cause operational friction — keep index but add override path or at minimum document how to resolve 409 conflicts operationally.
3. Webhook dedupe ordering needs hard invariant — "confirm during implementation" is too loose. Dedupe key must only be written after all side effects succeed; any failure must leave dedupe key absent.
4. Location token refresh path slightly under-specified — what if refresh succeeds but returns different scope? Always persist returned scope; optionally assert ⊆ agency scope.
5. No back-pressure control on mass enrolment — for 200–500 location agencies, autoStartOwedOnboardingWorkflows() fires in burst. Must enqueue via queue with concurrency limit.
6. Missing retry classification for external calls — add table: 401→refresh once→retry; 429→backoff 3x; 5xx→backoff 3x; 4xx non-401→fail fast.
7. OAuth initiation endpoint not fully defined — exact response shape + state storage mechanism missing.
8. No explicit handling of partial uninstall failure — if revoke + disconnect succeed but token soft-delete fails, tokens remain active. Make cleanup idempotent/retryable.
9. Adapter contract assumption should be enforced — add invariant: no adapter method may call location-scoped endpoint with agency token; enforce via wrapper or lint rule.
10. Logging / observability is implied but not defined — add minimal logging contract: { orgId, companyId, locationId?, event, result, error? }.

### Triage

| ID | Finding | Triage | Severity | Recommendation | Final Decision | Rationale |
|----|---------|--------|----------|----------------|----------------|-----------|
| F1 | OAuth state must carry orgId + CSRF nonce | technical | critical | apply | user (apply) | Critical severity escalation; user approved as recommended — callback invariant added to Phase 2 |
| F2 | Global index 409 conflict ops documentation | technical | medium | apply | auto (apply) | Internal ops procedure; no user-visible change; clean gap to fill |
| F3 | Webhook dedupe ordering hard invariant | technical | high | apply | user (apply) | High severity escalation; user approved as recommended — hard invariant replaces soft "confirm during implementation" note in §5.4 |
| F4 | Location token refresh: persist returned scope | technical | low | apply (partial) | auto (apply) | Internal token management; "persist returned scope" is correct; assertion is deferred |
| F5 | Mass enrolment back-pressure / queue invariant | technical | high | apply | user (apply) | High severity escalation; user approved as recommended — pg-boss queue invariant added to Phase 3 |
| F6 | Retry classification table | technical | medium | apply | auto (apply) | Consolidates scattered retry logic; no user-visible change |
| F7 | OAuth initiation endpoint response shape + state TTL | technical | medium | apply | auto (apply) | Internal contract gap; adds precision to Phase 2 |
| F8 | Partial uninstall failure: idempotent cleanup | technical | medium | apply (partial) | auto (apply) | Valid resilience gap; background job suggestion deferred as YAGNI |
| F9 | Adapter contract enforcement invariant | technical | medium | apply | auto (apply) | Adds invariant statement; implementation chooses enforcement mechanism |
| F10 | Logging contract | technical | low | apply | auto (apply) | Adds minimal structure; no user-visible change |

### Applied (auto-applied technical + user-approved)
- [auto] F2: Added 409 conflict ops resolution note to Phase 2
- [auto] F4: "persist returned scope" added to location token refresh update columns in §5.2
- [auto] F6: Added §5.8 global retry classification table
- [auto] F7: Added oauth-url response shape `{ url }`, state payload `{ orgId, nonce }`, state TTL = 10 min to Phase 2
- [auto] F8: Partial-failure resilience note added to §5.4 UNINSTALL — orphan tokens are inactive; handler is replay-safe
- [auto] F9: Adapter enforcement invariant added to Phase 4 task item
- [auto] F10: Added §5.9 structured logging contract with mandatory event list
- [user] F1: Callback invariant added to Phase 2 — orgId extracted from validated state; HTTP 400 on missing/expired/absent orgId; state is sole authoritative identity
- [user] F3: Hard invariant replaces soft note in §5.4 — dedupe row MUST NOT be written before side effects commit
- [user] F5: pg-boss queue invariant added to Phase 3 — autoStartOwedOnboardingWorkflows must enqueue via pg-boss, never inline

Top themes: OAuth callback security hardening, webhook correctness, enrolment safety at scale.

---

## Round 2 — 2026-05-03T03:10:00Z

### ChatGPT Feedback (raw)

Round 2: approve with 3 small tweaks before finalise. The Round 1 fixes landed cleanly and the spec is now build-ready.

Final tweaks:
1. State store in-memory caveat — add: in-memory OAuth state is acceptable only for single-instance/dev. If deployed behind multiple app instances before this ships, state must move to DB/Redis or sticky sessions are required.
2. Callback enrolment failure outcome — Phase 3 says callback logs + notifies + redirects with "we will retry shortly". Add that the agency connection remains active even if enrolment fails, so webhook/manual recovery can continue without re-consent.
3. LocationTokenResponse validation — add hard validation that returned companyId equals the agency connection companyId, and returned locationId equals the requested location. Mismatch should be typed LOCATION_TOKEN_MISMATCH and must not persist the token.

Recommendation: apply those 3 micro-fixes, then finalise. No further review round needed unless implementation changes materially.

### Triage

| ID | Finding | Triage | Severity | Recommendation | Final Decision | Rationale |
|----|---------|--------|----------|----------------|----------------|-----------|
| F11 | In-memory state store multi-instance caveat | technical | medium | apply | auto (apply) | Deployment correctness note; no user-visible change |
| F12 | Agency connection stays active on enrolment failure | technical | medium | apply | auto (apply) | Clarifies recovery contract; no user-visible workflow change |
| F13 | LocationTokenResponse hard validation (companyId + locationId) | technical | high | user (apply) | user (apply) | High severity escalation; pre-approved by user instruction "apply those 3 micro-fixes" |

### Applied
- [auto] F11: Deployment caveat added to Phase 2 state store description — in-memory only valid for single-instance; multi-instance requires shared store or sticky sessions
- [auto] F12: Agency connection stays active note added to Phase 3 callback-path error handling
- [user] F13: Hard validation added to §5.7 LocationTokenResponse — companyId + locationId must match; mismatch → LOCATION_TOKEN_MISMATCH; do not persist

Top themes: deployment safety, recovery contract clarity, token-routing correctness.

---

## Final Summary

**Verdict:** APPROVED (2 rounds)

### Consistency check
All 13 decisions across 2 rounds were `apply`. No finding was applied in one round and rejected in another. Clean.

### Implementation readiness checklist
- All inputs defined: PASS — AgencyTokenResponse, LocationTokenResponse, Location contracts in §5.7; state payload, callback inputs defined in Phase 2
- All outputs defined: PASS — upsert return semantics, HTTP status codes, typed errors all defined per phase
- Failure modes covered: PASS — 401/429/5xx retry table (§5.8), partial-uninstall resilience, enrolment failure path, LOCATION_TOKEN_MISMATCH, race window handling all specified
- Ordering guarantees explicit: PASS — dedupe hard invariant (§5.4), pg-boss queue invariant (Phase 3), phased build sequence (0–6) all explicit
- No unresolved forward references: PASS — all §5.x and Phase N cross-references verified against current spec headings

- Rounds: 2
- Auto-accepted (technical): 9 applied | 0 rejected | 0 deferred
- User-decided: 4 applied (F1, F3, F5, F13) | 0 rejected | 0 deferred
- Index write failures: 0
- Deferred to tasks/todo.md § Spec Review deferred items / ghl-module-c-oauth: none
- KNOWLEDGE.md updated: yes (3 entries — dual-table token architecture, orgId-in-state invariant, dedupe ordering invariant)
- architecture.md updated: no — checked ghlAgencyOauthService, locationTokenService, connector_location_tokens, ghl-module-c-oauth; no existing entries for these new-build artefacts; architecture.md will be updated when the feature is built
- capabilities.md updated: no — checked companies.readonly, agency.*oauth, location.*token; no stale references; spec's done definition requires capabilities.md update after Stage 6b passes (not at spec-review time)
- integration-reference.md updated: yes (GHL required_scopes — added conversations.write, companies.readonly, payments/orders.readonly; scope_behavior — added Module C agency-level token model note)
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: n/a — no build-discipline or convention changes introduced
- spec-context.md updated: no — checked ghl, connector_location_tokens, ghlAgency, locationToken; zero matches; framing assumptions unchanged (pre_production: yes, stage: rapid_evolution remain correct)
- frontend-design-principles.md updated: n/a — backend-only spec, no UI patterns introduced
- PR: #254 — https://github.com/michaelhazza/automation-v1/pull/254
