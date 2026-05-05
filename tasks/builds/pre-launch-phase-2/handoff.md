# Handoff — pre-launch-phase-2 — Phase 3 only

**Build slug:** `pre-launch-phase-2`
**Branch (implementation):** `claude/pre-launch-phase-2`
**PR:** [#264](https://github.com/michaelhazza/automation-v1/pull/264)
**Scope class:** Significant
**Spec:** `docs/pre-launch-hardening-mini-spec.md`
**Plan:** `tasks/builds/pre-launch-phase-2/plan.md`

---

## Build narrative

Ad-hoc P1 hardening branch — not a spec-driven feature build through the formal three-coordinator pipeline. Implementation driven directly from `docs/pre-launch-hardening-mini-spec.md` Chunks 4, 5, 6 (Maintenance Job RLS Contract, Execution-Path Correctness, Gate Hygiene Cleanup). All 53 P1 items across 7 plan chunks built and committed in the main session.

Mini-spec Chunks 1, 2, 3 are OUT_OF_SCOPE for this branch — owned by separate phases / specs.

**Items closed by this branch (P1 surface, mini-spec Chunks 4–6):**
- Chunk 4 (mini-spec Chunk 4): Maintenance job RLS contract — `ruleAutoDeprecateJob`, `fastPathDecisionsPruneJob`, `fastPathRecalibrateJob` all mirror admin/org tx contract with pure-function tests
- Chunk 5 (mini-spec Chunk 5): Execution-path correctness — C4b invalidation re-check, W1-43 single-webhook defence, W1-44 required_connections resolution, W1-38 error vocabulary closure, HERMES-S1 errorMessage threading, H3-PARTIAL-COUPLING decoupling
- Chunk 6a / 6b: C4a-6-RETSHAPE grandfather doc; C4b/W1-43/W1-44 pure extractions; email tile (C-P0-5), onboard navigation (D9), revoke confirm-name (D14), thread-context version pinning (C-P0-4)
- Chunk 7 (mini-spec Chunk 6): Gate hygiene cleanup — `actionCallAllowlist.ts` (P3-H4), `measureInterventionOutcomeJob` canonicalAccounts via service (P3-H5), `referenceDocumentService` no direct adapter (P3-H6), PrincipalContext propagation (P3-H7/S-2), skill visibility drift fix (P3-M10), YAML frontmatter on workflow skills (P3-M11), explicit yaml import (P3-M12), canonical dictionary entries (P3-M14), capabilities editorial rule (P3-M16), explicit package.json deps (P3-L1), skill MD definitions (S2-SKILL-MD), rule-conflict parser tests (S3-CONFLICT-TESTS), saveSkillVersion pure unit test (S5-PURE-TEST), security runbook, `actionCallAllowlist`, RLS import-type filter in gate, audit-stream split gate, coverage baseline placeholder

---

## Branch-level review pass

| Reviewer | Verdict | Notes |
|----------|---------|-------|
| `spec-conformance` | CONFORMANT_AFTER_FIXES | 27/30 pass; 1 mechanical fix (fixture lint annotation); 3 directional gaps deferred to `tasks/todo.md` (REQ #4 pure vs integration, REQ #15 envelope gate scope, REQ #29 CI baseline placeholder). Log: `tasks/review-logs/spec-conformance-log-pre-launch-phase-2-2026-05-05T04-56-49Z.md` |
| `pr-reviewer` | CHANGES_REQUESTED → resolved | B1, B2, B3 blocking + S1, S2, S4, S7 strong recommendations fixed in commit `ff37d968` |
| `dual-reviewer` | REVIEW_GAP: Codex CLI unavailable | Not run — ad-hoc build in main session, no Codex CLI available |
| `adversarial-reviewer` | HOLES_FOUND → 1 confirmed fixed | Log: `tasks/review-logs/adversarial-review-log-pre-launch-phase-2-2026-05-05T07-11-14Z.md`. AR-2.1 (signup JWT clock-skew revocation) fixed in-session. 2 likely-holes (AR-3.1 advisory lock scope, AR-5.1 IP-keyed rate limiter) + 4 worth-confirming (AR-1.1, AR-2.2, AR-4.1, AR-6.1) routed to `tasks/todo.md`. |

**adversarial-reviewer verdict:** HOLES_FOUND — 1 confirmed (AR-2.1 fixed); 2 likely-holes + 4 worth-confirming routed to `tasks/todo.md`.

**spec_deviations:** None locked. Three directional gaps deferred to `tasks/todo.md` — non-blocking for merge, all three represent scope decisions (operator-locked pure-test divergence, envelope gate scope TBD, CI baseline placeholder).

Final HEAD before finalisation: `b1a7d89d` — pushed to remote.

---

## Phase 3 (FINALISATION) — complete

**PR number:** #264
**chatgpt-pr-review log:** `tasks/review-logs/chatgpt-pr-review-pre-launch-phase-2-2026-05-05T08-52-25Z.md`
**spec_deviations reviewed:** yes — three directional gaps (REQ #4 pure-vs-integration, REQ #15 envelope-gate scope, REQ #29 CI-baseline placeholder) carried into Round 1 framing context. ChatGPT did not flag any of them; they remain deferred in `tasks/todo.md` as scope decisions, not findings.

**ChatGPT rounds:** 3 (Round 1: 4 ACCEPT / 4 DEFER / 1 NO-ACTION; Round 2: 1 ACCEPT / 3 DEFER / 2 VERIFY-clean / 1 NO-ACTION; Round 3: 0 ACCEPT / 3 DEFER / 3 NO-ACTION). Round 3 verdict: "You are genuinely done."

**Doc-sync sweep verdicts:**

| Doc | Verdict |
|---|---|
| `architecture.md` | yes — added §Layer 4 "Security audit stream (auth / oauth / abuse)" describing `audit_events` vs `security_audit_events` split, sentinel-org row, boot-time invariant. |
| `docs/capabilities.md` | no — no customer-visible capabilities added; this branch is hardening, observability, and pre-launch invariants. Grep terms checked: `securityAuditService`, `client-errors`, `silentCatchHelper`, `actionCallAllowlist`, `inboundRateLimiter`, `connectionTokenValidation`, `errorEnvelope` — zero hits. |
| `docs/integration-reference.md` | no — no integration behaviour shipped (GHL pagination is deferred CHATGPT-R1-8; OAuth TTL telemetry is deferred CHATGPT-R1-7). Grep terms checked: `securityAuditService`, `oauth.*state.*ttl`, `GHL.*auto.*enrol` — zero hits. |
| `CLAUDE.md` | no — no fleet, gate, or convention changes in this branch. Grep terms checked: `securityAuditService`, `client-errors`, `silentCatchHelper`, `actionCallAllowlist` — zero hits. |
| `DEVELOPMENT_GUIDELINES.md` | yes — appended §8.28 "JWT `iat` invalidation comparisons align both sides to whole seconds" and §8.29 "Per-route body-size caps install BEFORE the global JSON parser"; updated last-updated header. §8.27 (leftJoin / `isActive` ON-vs-WHERE) was added in Phase 2 already. |
| `CONTRIBUTING.md` | no — no lint-suppression policy change. Grep terms checked: `securityAuditService`, `isActive`, `assertActive`, `errorEnvelope` — zero hits. |
| `docs/frontend-design-principles.md` | no — no UI pattern, hard rule, or worked example introduced. Only client change is `silentCatchHelper.ts` always-emit (helper internals, not a UI pattern). |
| `KNOWLEDGE.md` | yes — six new entries appended (sentinel-row boot validation; JWT iat second-precision; per-route body-size cap ordering; `logAndSwallow` visibility-in-prod; leftJoin + `isActive` ON-clause placement; two-layer rate-limit key normalisation defence-in-depth). All marked with finalisation-coordinator provenance. |
| `references/test-gate-policy.md` | n/a — testing-gate posture unchanged. Grep terms checked: `verify-audit-stream-split`, `securityAuditService`, `client-errors` — zero hits. |
| `references/spec-review-directional-signals.md` | n/a — spec-reviewer signal-list unchanged this build. |
| `docs/decisions/` | n/a — no durable architectural choice locked this round; Round 3 closed out as "you are genuinely done." Sentinel-row pattern, JWT iat alignment, and body-size ordering are operational rules, not architectural choices. |
| `docs/context-packs/` | n/a — no anchor changes in `architecture.md` that affect existing pack slices. The new §Layer 4 sits inside the existing `## Row-Level Security` section already loaded by the `review` and `debug` packs. |
| `.claude/FRAMEWORK_VERSION` | n/a — repo-specific changes; framework-level files untouched in this branch. |
| `docs/spec-context.md` | n/a — Phase 3 finalisation, not a spec-review session. |

**KNOWLEDGE.md entries added:** 6
**tasks/todo.md items removed/closed:** 4 closed-out annotations on existing audit / pre-testing items (#27 security audit trail, ErrorBoundary noted item, OAuth state TTL noted item, JWT password-change-invalidation noted item) + 3 new defer entries (CHATGPT-R3-1, R3-2, R3-6).

**ready-to-merge label applied at:** 2026-05-05T09:56:17Z
