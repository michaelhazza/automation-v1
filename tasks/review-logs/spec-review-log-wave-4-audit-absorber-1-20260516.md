# Iteration 1 — Spec Review Log

Spec: `tasks/builds/wave-4-audit-absorber/spec.md`
Spec commit at start: `77b70f82`

## Codex findings + classifications

**FINDING #1 — MC7 / §6.1 — Handler registry shape**
- Codex's fix: name an existing source-of-truth (likely `JOB_CONFIG` + per-handler registration metadata); locate `idempotencyExempt` in an existing config surface.
- Classification: mechanical (file-inventory drift / unnamed primitive)
- Verification: `JOB_CONFIG` exists at `server/config/jobConfig.ts`; `createWorker.ts` does NOT expose a registry — it consumes `JOB_CONFIG` and is invoked per-handler.
- Disposition: AUTO-APPLY. Pinned `JOB_CONFIG` as the registry source-of-truth; defined `idempotencyExempt` schema as a new optional field on `JOB_CONFIG` entries.

**FINDING #2 — AE2 / §5.2 — "1-line wrap" is load-bearing but underspecified**
- Codex's fix: name the `enqueueHandoff` contract, payload shape, idempotency key, parent/child linkage, completion semantics.
- Classification: mechanical (under-specified contract; the spec already names `enqueueHandoff` as the existing primitive — this is contract-pinning, not introducing new behaviour)
- Verification: `enqueueHandoff` exists at `server/services/skillExecutor/pipeline.ts:183`; current `executeSpawnSubAgents` returns sync child results (verified handoff.ts).
- Disposition: AUTO-APPLY. Documented the semantic shift as multi-line, named the LLM-visible contract change, and routed the queued-vs-poll decision to chunk 0.

**FINDING #3 — §8 / CD2-CD10 inventory contradiction**
- Codex's fix: definitive inventory of cycle items.
- Classification: mechanical (spec contradiction across §1/§2/§8/§13)
- Disposition: AUTO-APPLY. Reconciled to 9 items (CD2-CD10) consistently in §1, §2, §8, §13. Split CD9-CD10 from "4 cycles batched" into 2+2 to give each chunk a discrete entry.

**FINDING #4 — PP-CD1 / §11.1 — Existing gate already covers**
- Codex's fix: reuse existing `verify-no-new-cycles.sh`.
- Classification: mechanical (prefer existing primitives)
- Verification: `scripts/verify-no-new-cycles.sh` exists; baseline `cycle-count:0`.
- Disposition: AUTO-APPLY. Replaced PP-CD1 with "existing — no new gate authored" framing; added baseline regeneration rule for §8 cycle drops.

**FINDING #5 — Testing posture vs integration tests**
- Codex's fix: declare deviation from `runtime_tests: pure_function_only` explicitly.
- Classification: mechanical (spec-authoring-checklist §9 violation; spec proposes runtime tests without acknowledging the framing deviation)
- Disposition: AUTO-APPLY. Added explicit deviation block in §4 framing assumptions naming the 6 integration tests as scoped exception with rationale.

**FINDING #6 — SK1 / §9.1 — Duplicate snapshot script**
- Codex's fix: reuse existing `scripts/snapshot-action-registry.ts` + `scripts/snapshots/action-registry.snapshot.json`.
- Classification: mechanical (prefer existing primitives)
- Verification: both files exist; snapshot includes captured `ACTION_REGISTRY` keys.
- Disposition: AUTO-APPLY. Recast SK1 as "author one new comparator that consumes existing snapshot"; named the comparator + report output paths.

**FINDING #7 — PP-SK2 / §11.3 — Duplicate gate**
- Codex's fix: reuse existing `scripts/verify-universal-skill-sync.sh`.
- Classification: mechanical (prefer existing primitives)
- Verification: gate exists at P7, hard-error since 2026-05-15.
- Disposition: AUTO-APPLY. Replaced PP-SK2 with "existing — no new gate authored" framing.

**FINDING #8 — MC count mismatch / §1**
- Codex's fix: reconcile MC count and bucket classification.
- Classification: mechanical
- Disposition: AUTO-APPLY. Restructured §1 to have correct counts; moved MC4 to prevention-gates bucket; renamed "Standalone test gaps (4): MC2/3/4/11/12" (5 names with MC4 a gate) to clean bucket structure.

**FINDING #9 — AE1/AE5/PP-AE2 critical-event invariant under-specified**
- Codex's fix: pin exact functions and event classes.
- Classification: mechanical (load-bearing claim without mechanism)
- Verification: handoff.ts uses `void insertOutcomeSafe` (lines 128, 227, 341) AND `void insertExecutionEventSafe` (lines 107, 140, 249). All 7 callsites confirmed.
- Disposition: AUTO-APPLY. Added Critical-event invariant block in §5.1 covering all three functions (`insertExecutionEventSafe`, `insertOutcomeSafe`, `insertCriticalAuditEvent`); updated PP-AE2 in §11.2 to enumerate same.

**FINDING #10 — PA-CLEANUP-DEF-3 voice.profile.refreshed under-specified**
- Codex's fix: name existing event stream + payload contract.
- Classification: mechanical (unnamed contract; no existing event stream fits)
- Disposition: AUTO-APPLY. Recast default to log-only acceptance (the codebase has no system-maintenance audit stream); operator override path documented as column-extension contract on `voice_profiles` table; deferred new audit-stream table to v2 in §15.

**FINDING #11 — PA-CLEANUP-DEF-2 query contract**
- Codex's fix: name full predicate set + ordering + uniqueness.
- Classification: mechanical
- Disposition: AUTO-APPLY. Pinned full query, deterministic ordering, uniqueness assumption, schema-constraint-follow-up call.

**FINDING #12 — Acceptance escape hatch / §13**
- Codex's fix: name a deferral policy.
- Classification: mechanical
- Disposition: AUTO-APPLY. Replaced open-ended "OR explicitly v2-deferred" with chunk-0-named-decision-only policy.

## Rubric findings (my own pass)

**RUBRIC-frontmatter / §11 of checklist**
- Issue: Missing `Last updated`; `status: DRAFT` not in checklist's lowercase form.
- Disposition: AUTO-APPLY. Updated frontmatter to `status: reviewing`, added `last_updated: 2026-05-16`.

**RUBRIC-lifecycle-declaration / §12 of checklist**
- Issue: Spec is Significant-class; missing Lifecycle Declaration block.
- Disposition: AUTO-APPLY. Added Lifecycle Declaration table after frontmatter (5 fields, Growth state).

**RUBRIC-abcd-estimate / §12 of checklist**
- Issue: Spec is Significant-class; missing ABCd Estimate block.
- Disposition: AUTO-APPLY. Added ABCd Estimate table (S/M/L sizing, no numerics).

**RUBRIC-deferred-items-section / §7 of checklist**
- Issue: Spec has §15 "Out of Scope" but checklist requires `## Deferred Items` heading.
- Disposition: AUTO-APPLY. Renamed §15 to `## Deferred Items`; expanded entries to include reason per item; added HandlerContext + system-maintenance-audit-stream entries.

**RUBRIC-numeric-count-reconciliation / §8 of checklist**
- Issue: §1 said "~28 items" but listed buckets summed to ~37; "5 small circular cycles" appeared in §1, §2, §13 contradicting §8 listing 9.
- Disposition: AUTO-APPLY. Reconciled all counts: 37 items total; 9 cycles in §8; 6 integration tests; 5 prevention gates including MC4.

**RUBRIC-PP-MC2-manifest-schema / §3 of checklist (Contracts)**
- Issue: `tasks/critical-paths-manifest.yml` named without a schema.
- Disposition: AUTO-APPLY. Added full YAML schema to §11.4.

## Iteration 1 Summary

- Mechanical findings accepted:  18 (12 Codex + 6 rubric)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   <pending>
