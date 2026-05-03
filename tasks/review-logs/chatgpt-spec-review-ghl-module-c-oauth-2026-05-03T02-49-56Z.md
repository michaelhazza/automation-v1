# ChatGPT Spec Review Session — ghl-module-c-oauth — 2026-05-03T02-49-56Z

## Session Info
- Spec: docs/ghl-module-c-oauth-spec.md
- Branch: ghl-agency-oauth
- PR: #254 — https://github.com/michaelhazza/automation-v1/pull/254
- Mode: manual
- Started: 2026-05-03T02:49:56Z

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
