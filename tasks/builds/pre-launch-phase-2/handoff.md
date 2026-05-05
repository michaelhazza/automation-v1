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
