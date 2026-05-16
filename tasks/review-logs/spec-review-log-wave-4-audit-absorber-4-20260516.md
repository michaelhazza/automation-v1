# Iteration 4 — Spec Review Log

Spec: `tasks/builds/wave-4-audit-absorber/spec.md`
Spec commit at start: `d82819e7`

## Codex findings + classifications

**FINDING #1 — Header line: scope says "4 prevention gates" but §1 says 5**
- Classification: mechanical (numeric-count contradiction).
- Disposition: AUTO-APPLY. Updated header to "5 prevention gates (incl. MC4)".

**FINDING #2 — §2 Goal 2: "route OR document best-effort" still offered**
- Classification: mechanical (§5.2 pinned the contract; the goal still hedged).
- Disposition: AUTO-APPLY. Removed the OR-alternative; pointed at §5.2.

**FINDING #3 — §5.1 AE1 callsite count wrong (says 7 incl. line 268; actually 6)**
- Classification: mechanical (file-inventory drift; line 268 is `getOrgScopedDb`, not an event-emission).
- Verification: `grep -n "void insertExecutionEventSafe\|void insertOutcomeSafe" handoff.ts` returns exactly 6 lines: 107, 128, 140, 227, 249, 341.
- Disposition: AUTO-APPLY. Corrected to 6 callsites; documented the line 268 misread; AE1 verification moved from a 7th runtime test to PP-AE2 static gate (per §4 cap).

**FINDING #4 — Runtime-test count contradiction (§4 caps at 6 but §5.1 + §5.2 author 2 more)**
- Classification: mechanical (self-contradiction with §4).
- Verification: §5.1 named `handoffCriticalEventDurability.test.ts`; §5.2 named `spawnSubAgentsDurability.integration.test.ts` — both runtime tests, neither counted in the 6.
- Disposition: AUTO-APPLY. §5.1 test withdrawn (verification rides on PP-AE2 gate). §5.2 test deduplicated into MC8's `handoffDurability.integration.test.ts` (one of the 6); MC8 expanded to carry the four AE2 scenarios.

**FINDING #5 — §5.2 AE2 contract assumes `enqueueHandoff` returns runId + uses singleton-key, but neither is true**
- Classification: mechanical (load-bearing claim against the actual primitive).
- Verification: `enqueueHandoff` returns `Promise<boolean>` (`pipeline.ts:183`); `agent-handoff-run` uses `idempotencyStrategy: 'payload-key'` (`jobConfig.ts:54-60`).
- Disposition: AUTO-APPLY. Pinned the required `enqueueHandoff` extension as part of chunk 2: return shape becomes `Promise<{ enqueued, runId, jobId }>`; existing callers in `handlers/tasks.ts:93,757` migrated. Idempotency uses the existing `payload-key` strategy with a `dedupKey` payload field; chunk 0 confirms hash-determinism.

**FINDING #6 — §5.2 AE2 result shape contradiction (claims `{ children: [...] }` but actual is `{ results, total_tokens, total_duration_ms }`)**
- Classification: mechanical (load-bearing claim against the actual primitive).
- Verification: `executeSpawnSubAgents` returns `{ success, results, total_tokens, total_duration_ms }` at handoff.ts:355-360.
- Disposition: AUTO-APPLY. Rewrote §5.2 step 3 to return the real existing shape verbatim (`{ success, results, total_tokens, total_duration_ms }`); step 4 timeout shape preserves the existing fields and adds a new `pending` field for runIds-still-in-flight.

**FINDING #7 — §6.1 references "PP-MC2 catalogue or sibling" gate but PP-MC2 is the unrelated critical-paths gate**
- Classification: mechanical (mis-named primitive).
- Disposition: AUTO-APPLY. Named the gate explicitly: `scripts/verify-handler-registry-fixture.sh`, authored as part of chunk 3.

**FINDING #8 — §11.4 PP-MC2 gate doesn't enforce all manifest schema fields**
- Classification: mechanical (load-bearing schema vs gate-assertion gap).
- Disposition: AUTO-APPLY. Strengthened gate assertions to cover version/id/description/surface/last_verified plus the existing 3 coverage-key checks.

## Rubric findings (my own pass — iteration 4)

None. Codex's verification of the actual primitive shapes (`enqueueHandoff` return type, `executeSpawnSubAgents` result fields, `payload-key` strategy) caught defects my earlier pass would have missed without re-reading the source files.

## Iteration 4 Summary

- Mechanical findings accepted:  8 (all Codex)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   <pending>
