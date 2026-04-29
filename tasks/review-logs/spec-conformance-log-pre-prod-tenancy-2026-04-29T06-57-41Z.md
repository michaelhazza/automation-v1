# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md`
**Spec round at check:** Round 7 (locked) — commit `a9135930` (per progress.md citation)
**Branch:** `pre-prod-tenancy`
**Base:** `main` (merge-base before sister-branch merge `599e73db`)
**Scope:** All 3 phases of pre-prod-tenancy spec — caller confirmed completed implementation. PR #234 sister-branch work (rate-limit-buckets, scope-resolution, sessionMessage) explicitly excluded — already conformance-checked and merged into main.
**Changed-code set:** 21 files attributable to pre-prod-tenancy commits (excluding sister-branch merge).
**Run at:** 2026-04-29T06:57:41Z

---

## Summary

- Requirements extracted:     25 subcomponents (one per spec subsection)
- PASS:                       22
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 3
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT (3 directional gaps — see deferred items in `tasks/todo.md` § "Deferred from spec-conformance review — pre-prod-tenancy (2026-04-29)")

> Two of the three findings (CONFORM-1, CONFORM-2) require architectural / human judgment to resolve. The third (CONFORM-3) is a documentation reconciliation. All three were classified DIRECTIONAL because none meet the "100% sure mechanical" bar — CONFORM-1 surfaces a spec internal contradiction the implementer cannot unilaterally resolve; CONFORM-2 affects RLS policy semantics for mixed-mode tables in a way the spec did not anticipate; CONFORM-3 has multiple reconciliation paths with different tradeoffs.

---

## Requirements extracted (full checklist)

| # | Subcomponent | Spec section | Verdict |
|---|---|---|---|
| 1 | Gate-harness wiring (`verify-rls-protected-tables.sh` in `run-all-gates.sh`) | §2.5, §3.5 step 1 | PASS |
| 2 | 4 stale registry entries dropped (`document_bundle_members`, `reference_document_versions`, `task_activities`, `task_deliverables`) | §3.4.2, §3.5 step 2 | PASS |
| 3 | Manifest entries for `register` + `register-with-new-policy` tables | §3.5 step 3 | PASS (with sub-finding CONFORM-1) |
| 4 | Migration 0245 — canonical org-isolation policies (55 tables) | §2.1, §3.5 step 4 | PASS (with sub-finding CONFORM-2) |
| 5 | Allow-list entries (3 sysadmin-gated tables: `llm_inflight_history`, `system_incidents`, `system_incident_suppressions`) + per-caller annotations | §3.5 step 5, §7.5 | PASS |
| 6 | §3.4.3 caller-level allowRlsBypass justification fixes (refreshJob:38, loadCandidates:46) | §3.4.3 | PASS |
| 7 | PR template update (allow-list grep prompt) | §2.6 | PASS |
| 8 | Mutual-exclusion check (manifest vs allowlist — empty intersection) | §3.3.1 | PASS |
| 9 | §3.4.1 classification deliverable in progress.md (61 rows + verdicts) | §3.4.1 | PASS |
| 10 | Migration 0244 forward (UNIQUE index + LOCK TABLE) | §4.2.1 | PASS |
| 11 | Migration 0244.down (rollback) | §2.1, §4.2.2 | PASS |
| 12 | Drizzle schema uniqueIndex change | §4.2.1 | PASS |
| 13 | §4.2.0 pre-check recorded in progress.md | §4.2.0 | PASS |
| 14 | `interventionService.recordOutcome` refactor (Promise<boolean> + onConflictDoNothing) | §4.3 | PASS |
| 15 | `measureInterventionOutcomeJob` refactor (remove advisory lock + db.transaction) | §4.3 | PASS |
| 16 | Pure test (`measureInterventionOutcomeJobPure.test.ts` — decideOutcomeMeasurement contract) | §7.2 | PASS |
| 17 | Load-test result triple in progress.md (legacy / new / multiplier) | §4.7 | PASS (5× speedup local-loopback miss already deferred to tasks/todo.md by implementer) |
| 18 | `ruleAutoDeprecateJob` — withOrgTx per-org refactor | §5.2, §5.3 | PASS |
| 19 | `fastPathDecisionsPruneJob` — withOrgTx per-org refactor | §5.2, §5.3 | PASS |
| 20 | `fastPathRecalibrateJob` — withOrgTx per-org refactor | §5.2, §5.3 | PASS |
| 21 | §5.2.1 audit triplet — ruleAutoDeprecateJob (commit msg + PR draft + progress paragraph) | §5.2.1 | PASS (with sub-finding CONFORM-3 — line-number drift) |
| 22 | §5.2.1 audit triplet — fastPathDecisionsPruneJob | §5.2.1 | PASS |
| 23 | §5.2.1 audit triplet — fastPathRecalibrateJob | §5.2.1 | PASS |
| 24 | Pre-merge baseline reverification (§1 closure evidence still holds) | §8.3 | PASS |
| 25 | Sister-branch scope-out (no edits to `pre-prod-boundary-and-brief-api` or `pre-prod-workflow-and-delegation` files in pre-prod-tenancy commits) | §0.4 | PASS |

---

## Mechanical fixes applied

None. No subcomponent had a gap that met the "100% sure mechanical" bar.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

- **CONFORM-1** (REQ #3) — `workflow_engines` / `workflow_runs` manifest entries cite migrations without CREATE POLICY blocks. Will fail `verify-rls-coverage.sh` (a CI invariant per spec §7.1). Spec §3.4.1 + §9 mandate registry-only edit; spec §7.1 mandates `verify-rls-coverage.sh` exit 0. Internal spec contradiction. → `tasks/todo.md § Deferred from spec-conformance review — pre-prod-tenancy (2026-04-29)`
- **CONFORM-2** (REQ #4) — Nullable-aware policy on `org_margin_configs` and `skills` accepts `organisation_id = NULL` writes via WITH CHECK, allowing tenant code paths to contaminate the platform-global namespace. Spec §2.1 canonical shape rejects NULL writes. → `tasks/todo.md`
- **CONFORM-3** (REQ #21) — Phase 3 audit triplet line-number drift for `ruleAutoDeprecateJob`: commit message + PR-draft cite lines 134-148/175; progress.md per-job audit paragraph cites 132-136/140-143/169. Implementer documented but did not byte-reconcile. → `tasks/todo.md`

---

## Files modified by this run

- `tasks/todo.md` — appended `## Deferred from spec-conformance review — pre-prod-tenancy (2026-04-29)` section with 3 findings.

(No mechanical fixes applied to source files. The branch's source files are unchanged by this conformance check.)

---

## Next step

NON_CONFORMANT — 3 directional gaps must be addressed by the main session before `pr-reviewer`. See `tasks/todo.md` under "Deferred from spec-conformance review — pre-prod-tenancy (2026-04-29)".

Recommended sequence for the main session:
1. **CONFORM-1 first** — this is a spec contradiction. The user must decide: (a) baseline-allow `workflow_engines`/`workflow_runs` in `verify-rls-coverage.sh`; (b) drop them from the manifest and accept `verify-rls-protected-tables.sh` failure for these two tables; (c) ship a stub policy migration despite §0.4 scope-out. Resolution affects which gates can pass on this branch.
2. **CONFORM-2 second** — RLS policy semantic concern. Decide whether nullable-aware `WITH CHECK` is the intended design or whether tenant-write paths should reject NULL writes. Likely a 1-line policy change in `migrations/0245_all_tenant_tables_rls.sql` for both tables.
3. **CONFORM-3 last** — pure documentation reconciliation. Easiest path: amend the `ruleAutoDeprecateJob` paragraph in `progress.md` to cite the commit-message line ranges (134-148, 175) so all three places agree.

After resolving these, run `pr-reviewer` on the expanded changed-code set.
