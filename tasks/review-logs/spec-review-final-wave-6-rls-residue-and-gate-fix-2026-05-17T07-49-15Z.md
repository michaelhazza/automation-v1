# Spec Review Final Report — wave-6-rls-residue-and-gate-fix

**Spec:** `tasks/builds/wave-6-rls-residue-and-gate-fix/spec.md`
**Spec commit at start:** `9fdcabd7cb8232a84ca9ed4bce5d0b1d689e95dd`
**Spec commit at finish:** `dfb04011b01671caa92adaaa9ed4128bca0823e0`
**Spec-context commit:** `62497257bb53bc99cf55b9f442af951cf4ddd318`
**Iterations run:** 3 of 5
**Exit condition:** two-consecutive-mechanical-only
**Verdict:** READY_FOR_BUILD

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|---|---|---|---|---|---|---|
| 1 | 32 | 6 | 28 | 5 | 1 (C28) | 0 | 0 |
| 2 | 10 | 0 | 10 | 0 | 0 | 0 | 0 |
| 3 | 4 | 0 | 4 | 0 | 0 | 0 | 0 |

Total mechanical fixes applied: **42** (28 + 10 + 4). One directional finding auto-rejected via framing. Zero AUTO-DECIDED items routed to `tasks/todo.md`.

---

## Mechanical changes applied — grouped by section

### §1 Scope
- Prevention-gate hardening renamed to "OS-parity gate-correctness harness for every gate invoked by `scripts/run-all-gates.sh`" (iter1).

### §2 Goals
- Goal #2 scope extended from `scripts/verify-*.sh` to "every gate invoked by `scripts/run-all-gates.sh`" (iter1).
- Goal #3 baseline target canonicalised to match §9 #4 (iter1, iter2, iter3).
- Goal #4 harness shape updated to seeded-fixture + path-form simulation (iter1, iter2).

### §3 Non-Goals
- Contingent RLS-policy migration exception added for WF1 (iter1).

### §4 Framing
- Likely tier distribution updated for Tier 0 false-positive bucket (iter1).

### §5.1 Gate honesty fix
- Option B (Node-native enumeration via existing `glob ^13.0.6`) made the chosen design; Option A explicitly rejected with rationale (iter1).
- Baseline numeric source corrected to `scripts/guard-baselines.json` (iter1, §5.2).
- Helper extension corrected to `.mjs` matching repo precedent (iter2).
- Pure path-normalisation Vitest test made mandatory with three path-form fixtures (iter1, iter2).
- 5-line tolerance tightened — every divergence enumerated and security-classified (iter2).

### §6.1 Other gates
- Per-gate audit verdict columns pinned (iter1).
- Option B refactor scoped to bug-affected gates only; non-bug-affected gates skip refactor but pass §6.2 harness (iter3).

### §6.2 P3 harness
- Goal restated from "Windows-portable" to "OS-parity gate-correctness" (iter1).
- Seeded-fixture assertion required for file-scanning gates (iter1).
- `GATE_ROOT` env-var fixture-injection contract added (iter2, extended in iter3 to all file-scanning gates).
- Path-form simulation contract added (per-gate enumerator helper Vitest test) (iter2).
- Exit-code set extended to `{0,1,2,3}` matching `run-all-gates.sh` legacy informational code (iter2).

### §7.1 Migration pattern
- Code example fixed to RETAIN the `.where(eq(table.organisationId, orgId))` defence-in-depth predicate — critical correction preventing predicate-removal across 1108 callsites (iter1).
- New §7.1.1 mechanical-migration authoring rules added (iter1).
- Import-path rule corrected from "path-mapping handles it" to "use relative imports with `.js` suffix per bundler convention" (iter2).
- Dual-GUC Tier 1 migration rule added using `setOrgAndSubaccountGUC` (iter3).

### §7.3 WF1 / WF3 / WF4 / WF6
- WF1 deployment-ordering contract pinned: RLS-policy migration filename precedes companion changes; `rlsProtectedTables.ts` manifest entry in same commit (iter1, iter2).

### §8 Tier categorisation
- Tenant-table source-of-truth named (`server/config/rlsProtectedTables.ts` + FK-only baseline `scripts/.gate-baselines/fk-only-tenant-tables.txt`) (iter1, iter3).
- 1108-callsite partition spelled out (Tier 0 false positive / Tier 1 / Tier 1-blocked / Tier 2 / Tier 3) (iter1).
- Mandatory per-callsite fields enumerated (file:line, call expression, target table, tenant key, tier verdict, named entrypoint, bypass rationale, blocked-tier handoff) (iter1, iter2).
- Tier 2 `withAdminConnection` contract restated with mandatory `SET LOCAL ROLE admin_role` (iter1).
- Tier 0 + Tier 3 annotations made mandatory (so analyser counts drop) (iter2, iter3).
- Tenant-key field clarified — derived from policy migration, not from `rlsProtectedTables.ts` (iter2).

### §9 Acceptance Criteria
- 14 canonicalised acceptance items (was 12 originally); query-semantic preservation explicit (#5); CI-only test policy (#10); post-migration rerun (#12); baseline math single source of truth (#4) (iter1, iter2, iter3).
- AND-not-OR for file-scanning gate Option B + harness pass (iter2).

### §10 Chunk plan
- Chunk 0 split into design-only + Chunk 1' post-fix categorisation (iter1).
- Per-domain chunks handle inline Tier 2 work; final sweep is audit-only (iter1).
- Chunk N+2 final-pass verification + harness rerun added (iter1).

### §11 Risk register
- Predicate-removal-during-mechanical-migration row added (high likelihood) (iter1).
- WF1 zero-row-mutation-under-missing-RLS row added (medium likelihood) (iter1).
- Stale fast-glob/globby risk row corrected to reflect existing `glob ^13.0.6` choice (iter1).

### §12 Out of Scope (Deferred Items)
- Section renamed and one-line bridging note added per spec-authoring-checklist §7 (iter1).
- Tier 1-blocked deferral routing added (iter1).

### §13 File-overlap deconfliction
- Tenant-isolation merge-conflict HARD RULE hoisted to prominent blockquote at top of section (iter1, operator-required).
- Session-Q coordination extended to gate-fix + baseline-ratchet writes, not only tier categorisation (iter1).

---

## Rejected findings

- **Iter1 C10** `[status:closed:pr:<num>]` IS the repo's convention (verified 100+ uses in `tasks/todo.md` including PRs #337, #299). Codex's premise wrong.
- **Iter1 R1** Spec frontmatter — YAML form matches `tasks/builds/<slug>/spec.md` convention (Wave 5 precedent).
- **Iter1 R3** Lifecycle Declaration not applicable — consolidation-class spec, no new capability cluster (Wave 5 precedent lacks it).
- **Iter1 R4** ABCd Estimate not applicable — same reasoning as R3.
- **Iter1 R6** §9 todo-IDs already restated in §1 scope.

---

## Directional and ambiguous findings (autonomously decided)

- **Iter1 C28** §13 tenant-isolation merge-conflict rule lacks enforcement primitives (PR template, protected label, conflict-log). Classification: directional (matches "Add monitoring/compliance for X" + cross-cutting signals). **AUTO-REJECT (framing — pre-production posture; existing operator-review SOP is the chosen mechanism, not an oversight)**. Note: a companion mechanical fix (C28') was applied to hoist the rule to a prominent blockquote, which addresses the prominence concern without expanding scope.

Zero AUTO-DECIDED items routed to `tasks/todo.md`.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against three Codex review iterations. The operator-required deliverables are all present in §10 chunk 0 (gate-fix-design.md, tier-categorisation.md, gate-audit-results.md, highest-traffic-first ordering, Chunk 1 gate fix lands first). The tenant-isolation merge-conflict hard rule is prominently surfaced as a top-of-§13 blockquote. The dual Codex vetting requested by the operator has been executed.

However:
- The review did not re-verify the framing assumptions in `docs/spec-context.md` (last_reviewed_at 2026-05-11, 6 days old — green). If the product context has shifted, re-read §4 of the spec before calling it implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. The two-consecutive-mechanical-only exit at iter3 means the spec is mechanically tight, not necessarily directionally complete.
- The chatgpt-spec-review pass (operator-requested second vet) is a separate run from this spec-reviewer loop.

**Recommended next step:** complete the chatgpt-spec-review pass per the operator's explicit double-vetting requirement, then hand to architect for chunk planning.
