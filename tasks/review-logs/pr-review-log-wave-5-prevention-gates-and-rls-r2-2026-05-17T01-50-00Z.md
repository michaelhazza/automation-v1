# PR Review Log — wave-5-prevention-gates-and-rls (R2)

**Files reviewed:** `server/services/computeBudgetService.ts` (lines 385–413), `server/services/llmUsageService.ts` (lines 640–710), `server/lib/adminDbConnection.ts`, `server/services/authService.ts` (lines 280–296), `scripts/.gate-baselines/with-org-tx-or-scoped-db.txt`, `scripts/guard-baselines.json`, `scripts/verify-with-org-tx-or-scoped-db.sh`, `scripts/verify-skill-registry-alignment.sh`, `scripts/lib/skill-registry-alignment-pure.mjs`, `scripts/__tests__/skill-registry-alignment-pure.test.ts`, `scripts/run-all-gates.sh`, `scripts/lib/guard-utils.sh`, `knip.json`, `tasks/builds/wave-5-prevention-gates-and-rls/tier-categorisation.md`, `tasks/builds/wave-5-prevention-gates-and-rls/progress.md`, `tasks/todo.md` (§ Wave 5 knip candidate triage)
**Timestamp (UTC):** 2026-05-17T01:50:00Z
**Round:** 2 (post-fix-loop)
**Latest commit:** `8b1011ff`

Blocking: 0 / Should-fix: 3 / Consider: 1
**Verdict:** APPROVED (3 should-fix doc-sync gaps; non-gating)

---

## 🔴 Blocking

None. The R1 blocking finding (missing rationale on `computeBudgetService.ts:395,408` guard-ignore directives) is resolved. No fresh blocking issues. PP-SK1 not being wired into `run-all-gates.sh` is correct per spec — chunk 3 explicitly defers wiring until Session K's W4AA-DEBT-1 lands. Baseline ratchet (P2 → 0) is enforceable.

## 🟡 Should-fix

[🟡 R2-SF1] `scripts/verify-with-org-tx-or-scoped-db.sh:143-147` — stale baseline comment claims `count = 2,153` and describes the per-file baseline as "documents the migration debt for Tracks A / A2 / A3 follow-up". After the R2 re-seed both values are wrong. Replace with updated text describing baseline = 0.

[🟡 R2-SF2] `server/lib/adminDbConnection.ts:44` — JSDoc on `AdminConnectionOptions.reason` still says `/** Optional free-form reason logged to audit_events. */`, but the helper logs to stderr only. Update to: `/** Optional free-form reason emitted in the stderr admin-bypass log line. */`.

[🟡 R2-SF3] `server/lib/adminDbConnection.ts:46-49` (and 19 call sites) — `skipAudit` field name is misleading. Rename to `skipBypassLog` OR update JSDoc to: `/** Skip the stderr admin-bypass log line. Used by auditService itself and by high-volume webhook lookup paths to suppress log noise. Default false. */`.

## 💭 Consider

[💭 R2-C1] `tasks/todo.md:1859` — preamble says "These 134 files" but list is 138 candidate files. Reconcile counts.

---

Blocking: 0 / Should-fix: 3 / Consider: 1
**Verdict:** APPROVED (3 should-fix doc-sync gaps; non-gating)
