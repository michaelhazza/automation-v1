# Iteration 3 — Spec Review Log

Spec: `tasks/builds/wave-4-audit-absorber/spec.md`
Spec commit at start: `dc056c2d`

## Codex findings + classifications

**FINDING #1 — §4 / §6.1 — Lingering `server/jobs/index.ts` reference in §4**
- Classification: mechanical (self-contradiction; iteration 2 fixed §6.1 but missed §4).
- Disposition: AUTO-APPLY. Updated §4 framing assumption to match §6.1.

**FINDING #2 — §6.1 — Markdown not mechanically importable**
- Classification: mechanical (load-bearing claim "test imports the inventory" with non-importable artifact).
- Disposition: AUTO-APPLY. Split into two artifacts: markdown for human review, importable TS map at `server/lib/__tests__/handlerRegistryFixture.ts`. Pinned both paths and added a bidirectional-equality gate.

**FINDING #3 — §6.1 — `send_only.addedAt` not in required schema**
- Classification: mechanical (gate references field that schema doesn't require).
- Disposition: AUTO-APPLY. Made required-fields explicit per verdict; added `addedAt` to `send_only`.

**FINDING #4 — §5.2 — Poll cadence ambiguous**
- Classification: mechanical.
- Disposition: AUTO-APPLY. Replaced "configurable; default cap 5s" with `pollIntervalMs = 1000` (no backoff); pinned `context.timeoutMs` as the only total-wait bound.

**FINDING #5 — §5.2 — Idempotency-key collision risk**
- Classification: mechanical (load-bearing claim "deterministic, collapses double-enqueues" with a key that collides on duplicate titles).
- Disposition: AUTO-APPLY. Changed key to `${parentRunId}:${index}:${normalisedTitle}`; pinned the index + normalisation rule.

**FINDING #6 — §5.2 — Resume path under-specified**
- Classification: mechanical (load-bearing claim "parent's resume path" without naming the mechanism).
- Disposition: AUTO-APPLY. Pinned to existing `runs.parent_run_id` linkage; named the SQL query; explained pg-boss `singletonKey` behaviour for double-enqueue idempotency.

**FINDING #7 — §10.1 — Extra unit test exceeds the 6-test cap**
- Classification: mechanical (self-contradiction with §4 deviation block).
- Disposition: AUTO-APPLY. Removed the unit-test acceptance; replaced with code-review verification + acknowledgement that no static gate covers app-layer-predicate-on-reads. (Verified that `verify-org-scoped-writes.sh` is writes-only and table-allowlisted.)

**FINDING #8 — §11.1 — "Regenerated baseline" language remains**
- Classification: mechanical (iteration 2 removed it from §8 and §13.5 but left it in §11.1).
- Disposition: AUTO-APPLY. Removed "or regenerated"; pinned baseline as `cycle-count:0`, never relaxed.

**FINDING #9 — §13 / §15 — Deferral vs "closes in full" tension**
- Classification: mechanical.
- Disposition: AUTO-APPLY. Restructured §13.1 to define "resolved" as one of three explicit paths (implemented per default, implemented per chunk-0 override, no-op for verified-closed CD-N items). AE2 is explicitly NOT eligible for deferral. Other deferrals require a formal spec amendment.

## Rubric findings (my own pass — iteration 3)

None. The internal-consistency drift Codex called out covers everything I would have flagged.

## Iteration 3 Summary

- Mechanical findings accepted:  9 (all Codex)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   <pending>
