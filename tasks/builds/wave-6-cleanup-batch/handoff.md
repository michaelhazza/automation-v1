# wave-6-cleanup-batch — handoff

**Build slug:** `wave-6-cleanup-batch`
**Branch:** `claude/wave-6-cleanup-batch`
**Task class:** Standard (light-pipeline — no spec, no plan, single coordinated PR)
**PR:** [#346](https://github.com/michaelhazza/automation-v1/pull/346)

---

## Phase 1 (SPEC) — n/a

This is a Standard-class light-pipeline build. No spec authored. The
operator's intake doubled as the brief — recorded at
`tasks/builds/wave-6-cleanup-batch/launch-prompt.md`.

## Phase 2 (BUILD) — complete

**Plan path:** n/a (single PR, scope locked in launch-prompt.md)
**Branch HEAD at handoff:** `715e77d1`
**Branch commits since main:**
- `5cddc767` — initial cleanup batch (~33 items folded)
- `4e552afb` — pr-reviewer R1 fixes (B1 + S1 + S3)
- `e4f0a556` — dual-reviewer Codex fix (OSI-DEF-7 UUID safeParse + 400)
- `81790166` — dual-review log update
- `715e77d1` — pr-reviewer R2 fix (RR-S1 regression test)

**Scope (from `5cddc767` commit body):**

CODE (12 items): W5K-ADV-1 definePruneJob allowlist; W5K-ADV-2 persistRun
orgId predicate; OSI-DEF-2 encryptToken mock path; OSI-DEF-7 agentId UUID
validation; LAEL-P2-L2 SELECT FOR UPDATE in updateSummary; LAEL-P2-L3
migration 0368 entity_type CHECK; OSI-DEF-5 migrations 0325/0326 down
guards; OSI-DEF-9 migration 0369 usability_state CHECK; 8 React
default-export drops; SKILL-MERGE-TEST-1 classifyConsolidationOutcome pure
helper + Vitest; SKILL-MERGE-RATIONALE-1 null-mergeRationale short-circuit;
SKILL-MERGE-BUDGET-1 budget doc comment; pr-reviewer should-fix #1 orgId
on listAllowedSubscriptionsForAgent.

DOCS (2 items): AE4 worker-restart recovery in architecture.md; H3
hasSummary doc.

MECHANICAL (1 batch): OSI-DEF-4 type="button" sweep across 12 govern files
(36 buttons; 3 type="submit" preserved).

STALE-STATUS FLIPS (18 items + 9 duplicates closed) in tasks/todo.md.

**G1 attempts:** n/a (no chunked build)
**G2 attempts:** n/a (covered by per-commit lint + typecheck)

### Branch-level review pass

**spec-conformance verdict:** SKIPPED — task is not spec-driven (per GRADED policy)

**adversarial-reviewer verdict:** HOLES_FOUND (1 likely-hole + 2 worth-confirming)
- Log: `tasks/review-logs/adversarial-review-log-wave-6-cleanup-batch-2026-05-17T11-10-07Z.md`
- Likely-hole closed in commit `4e552afb` (B1 listForSubaccount orgId predicate)
- 2 worth-confirming routed to backlog as W6Q-ADV-WC1 (make-default outer tx) and the extraWhere `/i` over-permissiveness (no exploitation possible; absorbed into the existing W5K-ADV-1 fix)

**pr-reviewer R1 verdict:** CHANGES_REQUESTED (1 blocking + 4 should-fix + 3 consider)
- Log: `tasks/review-logs/pr-review-log-wave-6-cleanup-batch-2026-05-17T11-10-07Z.md`
- B1 + S1 + S3 fixed inline in commit `4e552afb`
- S2 + S4 + N1 + N2 + N3 routed to backlog as W6Q-S2/S4/N1/N2/N3

**reality-checker verdict:** SKIPPED — task class Standard (per GRADED policy)

**dual-reviewer verdict:** APPROVED (1 [ACCEPT] fix + 1 surfaced-but-not-patched)
- Log: `tasks/review-logs/dual-review-log-wave-6-cleanup-batch-2026-05-17T11-34-26Z.md`
- Iterations: 2 of 3 (terminated early on iter-2 "no actionable bugs")
- Accepted fix in commit `e4f0a556`: `server/routes/operatorSessionConnections.ts:495` — `z.string().uuid().parse()` → `safeParse()` + duck-shape 400 throw. The original OSI-DEF-7 validation would have surfaced a bare ZodError to asyncHandler's normaliser (which routes to 500 + incident), defeating the entire intent of the validation. Now lands correctly as a 400.
- Surfaced-not-patched: ~28 sibling call sites with same `.parse()` anti-pattern (W6Q-RR-N2 backlog).

**pr-reviewer R2 re-review verdict:** APPROVED (0 blocking + 1 should-fix + 2 consider)
- Log: `tasks/review-logs/pr-review-log-wave-6-cleanup-batch-2026-05-17T11-55-00Z.md`
- RR-S1 fixed in commit `715e77d1`: new regression test `operatorSessionConnectionsAgentIdPure.test.ts` (4 pure tests) pins the safeParse + 400 contract against silent reversion to `.parse()`.
- RR-N1 (errorCode not in APP_ERROR_CODES) + RR-N2 (~28 sibling call sites) routed to backlog.

**Fix-loop iterations:** 2 (pr-reviewer R1 fixes → dual-reviewer fix → pr-reviewer R2 fix)

**REVIEW_GAP entries:**

```
REVIEW_GAP: spec-conformance | task-class: Standard | reason: light-pipeline build with no spec (per GRADED policy: spec-conformance is "mandatory if spec-driven") | operator-override: no | remediation: accept
```

**Doc-sync gate:** deferred to Phase 3 full sweep (per finalisation-coordinator playbook §6 — the Phase 3 sweep is the system of record).

**Open issues for finalisation:**
- 7 backlogged review findings in `tasks/todo.md § "Deferred from wave-6-cleanup-batch pr-reviewer / adversarial-reviewer (2026-05-17)"` (W6Q-S2, W6Q-S4, W6Q-N1, W6Q-N2, W6Q-N3, W6Q-ADV-WC1, W6Q-RR-N1, W6Q-RR-N2)
- chatgpt-pr-review (Phase 3 §5) is the primary second-opinion pass — no spec-conformance was run, so any unforeseen contract drift relies on that loop
