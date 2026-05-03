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
| F1 | OAuth state must carry orgId + CSRF nonce | technical | critical | apply | **ESCALATED — awaiting user** | Critical severity escalation carveout; missing orgId in callback breaks the whole install flow |
| F2 | Global index 409 conflict ops documentation | technical | medium | apply | auto (apply) | Internal ops procedure; no user-visible change; clean gap to fill |
| F3 | Webhook dedupe ordering hard invariant | technical | high | apply | **ESCALATED — awaiting user** | High severity escalation carveout; silent dedupe on partial failure is a data correctness risk |
| F4 | Location token refresh: persist returned scope | technical | low | apply (partial) | auto (apply) | Internal token management; "persist returned scope" is correct; assertion is deferred |
| F5 | Mass enrolment back-pressure / queue invariant | technical | high | apply | **ESCALATED — awaiting user** | High severity escalation carveout; burst enrolment of 500 locations could flood the queue |
| F6 | Retry classification table | technical | medium | apply | auto (apply) | Consolidates scattered retry logic; no user-visible change |
| F7 | OAuth initiation endpoint response shape + state TTL | technical | medium | apply | auto (apply) | Internal contract gap; adds precision to Phase 2 |
| F8 | Partial uninstall failure: idempotent cleanup | technical | medium | apply (partial) | auto (apply) | Valid resilience gap; background job suggestion deferred as YAGNI |
| F9 | Adapter contract enforcement invariant | technical | medium | apply | auto (apply) | Adds invariant statement; implementation chooses enforcement mechanism |
| F10 | Logging contract | technical | low | apply | auto (apply) | Adds minimal structure; no user-visible change |

### Applied (auto-applied technical)
- [auto] F2: Added 409 conflict ops resolution note to §5 / Phase 2
- [auto] F4: Explicit "persist returned scope" on location token refresh in §5.2
- [auto] F6: Added retry classification table to §5
- [auto] F7: Added oauth-url response shape + state TTL contract to Phase 2
- [auto] F8: Tightened UNINSTALL partial-failure idempotency note in §5.4
- [auto] F9: Added adapter enforcement invariant to §5.2 / Phase 4
- [auto] F10: Added structured logging contract section

---
