# Iteration 2 — Spec Review Log

Spec: `tasks/builds/wave-4-audit-absorber/spec.md`
Spec commit at start: `56b887a4`

## Codex findings + classifications

**FINDING #1 — §6.1 / §14 Chunk 3 — `server/jobs/index.ts` does not exist**
- Codex's fix: name the actual registration source.
- Classification: mechanical (file-inventory drift — a non-existent file was named as the source-of-truth).
- Verification: `ls server/jobs/` shows ~100 individual job files, no `index.ts`.
- Disposition: AUTO-APPLY. Replaced "Handler registration map: server/jobs/index.ts" with "Handler registration: spread across createWorker(...) callsites in server/jobs/*.ts; chunk 0 produces handler-registry-inventory.md."

**FINDING #2 — §6.1 — Not every JOB_CONFIG entry has a main-app handler**
- Codex's fix: add a per-queue verdict (handler_tested / external_consumer / send_only / exempt).
- Classification: mechanical (load-bearing claim "framework passes against all current handlers" without a mechanism for non-handler queues).
- Verification: `agent-spend-response` in `jobConfig.ts:304` is documented as "main app emits; worker picks up by correlationId" — no main-app handler.
- Disposition: AUTO-APPLY. Replaced single `idempotencyExempt` flag with four-verdict `idempotencyContract` scheme. Pinned schemas, gate behaviour, 90-day re-classification rule for `send_only`.

**FINDING #3 — §5.2 / AE2 — Contradictory semantics**
- Codex's fix: pick one contract (return immediately OR block internally).
- Classification: mechanical (self-contradiction within one section).
- Disposition: AUTO-APPLY. Picked "queue durably, block internally, return existing result shape" — preserves LLM-visible contract; gains durability. Pinned 8 numbered contract elements covering enqueue, poll, timeout, partial failure, restart-resume, actionRegistry, architecture.md, acceptance.

**FINDING #4 — §8 / §11.1 / §13.5 — Cycle baseline already at 0; "drop below" is impossible**
- Codex's fix: chunk 0 verifies each CD-N is still open; remove "below baseline" language.
- Classification: mechanical (load-bearing claim "named cycles are gone" against an already-floor baseline).
- Verification: `scripts/.gate-baselines/circular-deps.txt` is `cycle-count:0`; the audit log predates the post-#307 cleanup sprint.
- Disposition: AUTO-APPLY. Added Section 0-style verification log requirement; reframed §8 as "verified open" → fix, "verified closed by sha" → drop. Updated §13.5 to expect baseline preservation, not regeneration.

**FINDING #5 — §9.2 SK2 — 16 kebab files, not 1**
- Codex's fix: chunk 0 enumerates the full inventory; rename or allowlist each.
- Classification: mechanical (file-inventory drift).
- Verification: `ls server/skills/*-*.md | wc -l` returns 16.
- Disposition: AUTO-APPLY. Listed all 16 files inline; default = rename all to snake_case; added allowlist file path for documented exceptions; added `actionRegistry` cross-check + skill-loader grep sweep to chunk 0.

**FINDING #6 — §13.1 Acceptance — AE2 in deferral list undermines the build**
- Codex's fix: remove AE2 from the deferral-permit list.
- Classification: mechanical (the §5.2 fix in this iteration pinned AE2's contract; the deferral-permit list still cited it as a chunk-0 decision).
- Disposition: AUTO-APPLY. Removed AE2 from deferral list; removed AE2 from chunk 0's operator-decision list in §14; updated §4 framing assumption to say AE2 contract is pinned in §5.2 (chunk 0 verifies feasibility only).

## Rubric findings (my own pass — iteration 2)

None. The spec's structure is now consistent across §1, §2, §4, §5, §6, §8, §9, §11, §13, §14, §15.

## Iteration 2 Summary

- Mechanical findings accepted:  6 (all Codex)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   <pending>
