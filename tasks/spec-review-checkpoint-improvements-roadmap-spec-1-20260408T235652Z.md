# Spec Review HITL Checkpoint — Iteration 1

**Spec:** `docs/improvements-roadmap-spec.md`
**Spec commit (last touch):** `fd04f52568d0664d10410c468b286d31fd39c3b6`
**HEAD commit at review start:** `6a8e48b33d88c1218cac7a694f746ffc8c011abd`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-08T23:56:52Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 2 until every finding below is resolved by the human. Resolve by editing this file in place, changing each `Decision:` line to `apply` / `apply-with-modification` / `reject` / `stop-loop`, then re-invoking the spec-reviewer agent.

Iteration 1 applied 12 mechanical findings in parallel with this checkpoint being written. See the "Iteration 1 Summary" section at the bottom for the list.

## Table of contents

- Finding 1.1 — P1.2 regression replay cadence: weekly vs monthly (ambiguous)
- Finding 1.2 — P1.2 Goal claims "every commit" but design is deferred-activation cron (ambiguous)
- Finding 1.3 — Sprint 3 ordering: P2.1 first vs P2.2 first (directional)
- Finding 1.4 — P4.3 `agent.complexityHint` under-specified (ambiguous)
- How to resume the loop
- Iteration 1 Summary

---

## Finding 1.1 — P1.2 regression replay cadence: weekly vs monthly

**Classification:** ambiguous
**Signal matched:** Testing posture / rollout cadence — picking a cadence has testing-posture implications. Biased to HITL because the mechanical fix (pick one) hides a cost/frequency tradeoff the human should own.
**Source:** Codex (finding #5)
**Spec section:** P1.2 Design / Cost ceiling (`docs/improvements-roadmap-spec.md:893-897`), P1.2 Verdict (`:925-929`), Job idempotency keys (`regression-replay` row), Testing strategy (`:2747`)

### Codex's finding (verbatim)

> 5. **Spec section:** `P1.2 Design / Cost ceiling`, `P1.2 Verdict`, `Job idempotency keys`, and `Testing strategy`
> One-sentence description: the regression replay schedule conflicts across sections: weekly cron in design/job table, monthly cron in the verdict and Sprint 2 summary, and later activation only in the testing appendix.
> Suggested mechanical fix: State one authoritative replay cadence and one authoritative activation point, then normalize all references to that exact contract.
> Severity: **High**

### Tentative recommendation (non-authoritative)

If this were mechanical, I would pick **weekly** as the authoritative cadence — it appears in three of the four spots (Design / Cost ceiling, Testing strategy activation note, and the `singletonKey: replay:${caseId}:${runDate}` shape which is implicitly weekly-keyed). Rename "monthly cron wiring" in P1.2 Verdict to "weekly cron wiring", rename "Monthly cron wired" in the Sprint 2 summary to "Weekly cron wired", and leave the **monthly cost budget** (a different concept — per-org cost ceiling enforced by `runCostBreaker`) in place. The activation point would stay: "Sprint 2 capture ships first, replay activation deferred until the `regression_cases` table has enough rows to be meaningful (natural 1-2 week gap after capture lands)".

This is tentative because weekly vs monthly is a cost/signal tradeoff: weekly is 4× the LLM cost of monthly for the same per-org budget, but catches regressions closer to the offending commit. The human owns the tradeoff.

### Reasoning

The spec contradicts itself (three references say weekly, one says monthly, the verdict hedges). Mechanical cleanup is "pick one". But the pick affects monthly LLM spend via `runCostBreaker` and the signal-latency of the regression feedback loop — that is a directional call disguised as consistency cleanup. Bias to HITL: false positive costs 30 seconds; false negative locks in the wrong cadence and either over-spends or under-signals.

### Decision

```
Decision: apply
Modification (if apply-with-modification): 
Reject reason (if reject): 
```

---

## Finding 1.2 — P1.2 Goal claims "every commit" but design is deferred-activation cron

**Classification:** ambiguous
**Signal matched:** Testing posture signals — "deferred activation until a later testing phase" is a testing-posture statement, not purely mechanical.
**Source:** Codex (finding #6)
**Spec section:** P1.2 Goal (`docs/improvements-roadmap-spec.md:764`), P1.2 Design (`:895`), Testing strategy (`:2747`)

### Codex's finding (verbatim)

> 6. **Spec section:** `P1.2 Goal` vs `P1.2 Design / Testing strategy`
> One-sentence description: the goal claims captured regressions are "re-run on every commit," but the implementation sections explicitly route replay to a periodic cron and later defer activation until a later testing phase.
> Suggested mechanical fix: Rewrite the goal to match the shipped contract, or explicitly split "capture ships now" from "replay activation ships later" in the item verdict.
> Severity: **High**

### Tentative recommendation (non-authoritative)

If this were mechanical, I would rewrite the P1.2 Goal to something like: "Every time a human reviewer rejects or edits an agent action at a HITL gate, automatically capture the rejection as a replayable regression case. Captured cases are replayed on a periodic cron (cadence per Finding 1.1) against the real LLM router so any future regression in the same agent against the same input is caught and surfaced." The "every commit" structural-trajectory claim would be moved out of P1.2 and into P3.3's goal (where it already belongs — P3.3 is the stubbed-router structural trajectory test suite that does run per-commit).

### Reasoning

This finding is downstream of Finding 1.1 — resolving the cadence resolves the goal rewrite. Classified as ambiguous because the current goal conflates two things (capture + replay cadence) and splitting them is a small directional call the human should bless. If Finding 1.1 is resolved as `stop-loop`, this finding is moot; if Finding 1.1 is `apply` or `apply-with-modification`, the goal rewrite should follow the same decision.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Rewrite P1.2 Goal to describe weekly cron-driven regression replay (matching Finding 1.1's weekly cadence decision). Split "capture ships now" from "replay activation deferred" per the tentative recommendation. Move the "every commit" structural-trajectory claim out of P1.2 and into P3.3's goal where it belongs.
Reject reason (if reject): 
```

---

## Finding 1.3 — Sprint 3 ordering: P2.1 first vs P2.2 first

**Classification:** directional
**Signal matched:** Sequencing signals — "Swap the order of these two items", "This should come after / before [other item]". Hardcoded list in spec-reviewer.md; not overridable.
**Source:** Codex (finding #8)
**Spec section:** P2.1 coupling notes (`docs/improvements-roadmap-spec.md:1158-1163`), Sprint 3 table (`:2801-2807`), Parallelisation opportunities (`:2864`)

### Codex's finding (verbatim)

> 8. **Spec section:** `P2.1 coupling notes`, `Sprint 3 table`, and `Parallelisation opportunities`
> One-sentence description: the spec says P2.1 must ship first with `middlewareVersion: 1` and P2.2 then bumps it to 2, but the sprint ordering and parallelisation text say P2.2 can land first and P2.1 lands last.
> Suggested mechanical fix: Make the Sprint 3 ordering consistent with the checkpoint versioning contract, or revise the versioning contract to allow the published sprint order.
> Severity: **High**

### Tentative recommendation (non-authoritative)

Two coherent options, pick one:

**Option A — P2.1 first (preserve the versioning contract).** Swap the Sprint 3 table so P2.1 is item #12 and P2.2 becomes item #16 (or wherever P2.1 was). Update the Parallelisation paragraph to say: "P2.1 lands first because the initial `SerialisableMiddlewareContext` shape must exist before P2.2 adds reflection fields; P2.2 then bumps `middlewareVersion` from 1 to 2. P2.3 slices A/B/C are sequential and run in parallel with either." Safer for the versioning contract — explicit sequential shape changes are easier to reason about under crash-resume.

**Option B — P2.2 first (accept the parallelisation ordering).** Rewrite the P2.1 coupling note to: "P2.2 ships first as a Sprint 3 warm-up. Because the P2.1 checkpoint schema in this document already pre-declares `lastReviewCodeVerdict` and `reviewCodeIterations` fields (see the `SerialisableMiddlewareContext` interface above), P2.1 ships with `middlewareVersion: 1` already containing those fields. P2.2 does not bump the version — the version is 1 for the entire Sprint 3." This matches the current schema text but means the "bump to 2 when P2.2 lands" language in the coupling notes and the Sprint 3 summary needs to be retracted.

Both options are internally consistent. Option B is lower-risk for the Sprint 3 schedule (P2.2 is smaller and independent). Option A is lower-risk for the versioning contract.

### Reasoning

This is a hardcoded directional signal ("swap the order of these two items"). The classifier does not override the list based on its own judgment. The mechanical version would be "pick one and normalise", but the pick carries different risk profiles and different implications for the reflection-loop crash-resume property. The human must own this call.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Option B — keep P2.2 first as Sprint 3 warm-up. Retract the middlewareVersion bump (1 → 2) from P2.1 coupling notes and Sprint 3 summary. P2.1 ships with middlewareVersion: 1 containing the pre-declared reflection fields (lastReviewCodeVerdict, reviewCodeIterations) already present in the SerialisableMiddlewareContext interface. Version stays at 1 for all of Sprint 3. Rationale: middlewareVersion bumps are pre-production dead weight per framing assumption 4 (no feature flags, no migration ceremony).
Reject reason (if reject): 
```

---

## Finding 1.4 — P4.3 `agent.complexityHint` under-specified

**Classification:** ambiguous
**Signal matched:** Architecture signal (introduce a new schema field vs reuse an existing one) + rubric finding (unnamed new primitive).
**Source:** Codex (finding #13) + rubric
**Spec section:** P4.3 Design (`docs/improvements-roadmap-spec.md:2403-2407`), P4.3 Files to change (`:2421-2430`), P4.3 Verdict (`:2449-2453`)

### Codex's finding (verbatim)

> 13. **Spec section:** `P4.3 Design/Verdict` and `P4.3 Files to change`
> One-sentence description: `agent.complexityHint` is load-bearing for plan gating, but the spec leaves it as "new optional field on agents (or reuse an existing config field)" and does not include any agent schema/migration file in the file inventory.
> Suggested mechanical fix: Choose one source of truth for complexity configuration, name the exact field/file/migration, and add it to the P4.3 file table.
> Severity: **Medium**

### Tentative recommendation (non-authoritative)

If this were mechanical, I would:

- Add a new column `complexity_hint text CHECK (complexity_hint IN ('simple', 'complex'))` on `agents` via a new migration `migrations/0090_agents_complexity_hint.sql` (0090 is the next free number after 0089).
- Add `migrations/0090_agents_complexity_hint.sql` + its down-migration to the P4.3 Files to change table.
- Add `server/db/schema/agents.ts` to the P4.3 Files table with the mirroring `complexityHint` column.
- Strike the "or reuse an existing config field" clause from the P4.3 Verdict step 4 prose.

The alternative (reuse an existing field, e.g. a JSON blob on `agents.meta` or on `agents.additionalPrompt`) is viable but adds a parser and makes gate enforcement harder. The clean answer is a new typed column.

### Reasoning

Classified as ambiguous because "add a new migration to Phase 4" is a small schema decision the spec currently hedges on. The human may have a reason for the hedge. Bias to HITL: false positive costs 30 seconds; false negative commits a migration the human didn't want.

### Decision

```
Decision: apply
Modification (if apply-with-modification): 
Reject reason (if reject): 
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path (`docs/improvements-roadmap-spec.md`).
3. The agent will read this checkpoint file as its first action, honour each decision (`apply`, `apply-with-modification`, `reject`, or `stop-loop`), and continue to iteration 2.

If you want to stop the loop entirely without resolving every finding, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.

---

## Iteration 1 Summary

- Mechanical findings accepted:  12
- Mechanical findings rejected:  0
- Directional findings:          1 (Finding 1.3)
- Ambiguous findings:            3 (Findings 1.1, 1.2, 1.4)
- Reclassified → directional:    0
- HITL checkpoint path:          `tasks/spec-review-checkpoint-improvements-roadmap-spec-1-20260408T235652Z.md` (this file)
- HITL status:                   pending
- Codex CLI:                     invoked successfully. Note: the `codex review --file` / `codex review --stdin` pattern described in `.claude/agents/spec-reviewer.md` does not match the actual Codex CLI 0.118.0 — `codex review` only accepts code diffs (`--uncommitted`, `--base`, `--commit`), not markdown files. Used `codex exec --sandbox read-only --skip-git-repo-check "<bounded review prompt>"` as the non-interactive equivalent, with framing assumptions and rubric categories inlined into the prompt so Codex knew not to flag directional concerns. This substitution is a spec-reviewer.md bug and should be fixed in a follow-up (update `.claude/agents/spec-reviewer.md` Step 1 to describe the actual CLI shape).

### Mechanical findings applied in iteration 1

1. **[P0.2 Slice B interface block]** Collapsed the duplicate `scopeRequirements` declaration and removed the stale "five new optional fields" count. Reordered so `scopeRequirements` appears once at the top of the new-field block with the canonical description.
2. **[P0.2 Files to change + Test plan]** Normalised the registry gate filename to `verify-action-registry-zod.sh` in both the P0.2 Files to change table and the surrounding prose, matching the Testing strategy appendix.
3. **[P1.1 Files to change]** Added the six prose-referenced but previously missing implementation files to the P1.1 Files table: `server/instrumentation.ts` (ALS extension), `server/lib/createWorker.ts` (Path 2 wrapper), `server/lib/adminDbConnection.ts` (Path 3 bypass), `server/config/rlsProtectedTables.ts` (RLS manifest), and the `verify-rls-contract-compliance.sh` gate script.
4. **[P1.1 Files to change]** Added `server/services/__tests__/rls.context-propagation.test.ts` (integration test I1) to the P1.1 Files table with a description matching its use in the Testing strategy appendix.
5. **[P2.1 Write path]** Replaced the stale `persistCheckpoint()` snippet: removed the `messages` field from the payload, replaced it with `messageCursor`, added `configVersion`, rewrote the surrounding prose to make per-tool-call semantics authoritative, and retired the 3-second throttle language (noted as replaced by per-tool-call natural rate limiting).
6. **[P4.1 Topic taxonomy]** Disambiguated the two "universal" rules: the topic-taxonomy paragraph now uses "topic-unclassified" for the passive default for untagged skills, and explicitly points at the `isUniversal: true` contract for the authoritative universal-skill rule.
7. **[P1.1 Layer 3]** Added the `preTool` middleware action union definition including the `skip` variant consumed downstream by P4.1's confidence escape hatch. Previously the `skip` action was referenced as "added in P1.1 Layer 3" without P1.1 Layer 3 actually defining it.
8. **[P4.1 ask_clarifying_question schema]** Added `'low_confidence'` to the canonical `blocked_by` enum and marked that snippet as the source of truth. Noted that all other references (confidence escape hatch, `verify-confidence-escape-hatch-wired` gate, Sprint 5 summary) must match.
9. **[P4.2 Files to change]** Added an entry anchoring `mwCtx.cachedMemoryBlocks` to the runtime `MiddlewareContext` interface with the `// ephemeral:` marker the `verify-middleware-state-serialised.sh` gate (from P2.1) requires.
10. **[P4.4 Active mode]** Removed the undeclared `requiresCritiqueGate.activate = true` nested field and replaced with explicit follow-up-ticket language noting the two possible future shapes (widen to `boolean | { activate: boolean }` or add a separate `critiqueGateMode` field), neither of which is required by this roadmap.
11. **[Per-item rollback notes]** Updated 0082, 0083, and 0084 rollback entries to include dropping the RLS policy and removing the table from `server/config/rlsProtectedTables.ts` in the same commit — matching the earlier P2.1 claim at line 1053 that the rollback table would reflect this.
12. **[Retention and pruning — anchored to owning items]** Added missing files to P1.1 (`organisations.security_event_retention_days` migration row in 0082, `limits.ts` defaults, `prune-security-events.ts`, `securityEventsCleanupProcessor.ts`, `jobConfig.ts`), P1.2 (`agents.regression_case_cap` migration row in 0083, `agents.ts` schema mirror, `limits.ts` default), and P2.1 (`organisations.run_retention_days` migration row in 0084, `organisations.ts` schema mirror, `limits.ts` default, `prune-agent-runs.ts`, `agentRunCleanupProcessor.ts`, `jobConfig.ts`).

### Spec file at end of iteration 1

Working tree has uncommitted edits against `docs/improvements-roadmap-spec.md`. The human should review the diff (`git diff docs/improvements-roadmap-spec.md`) alongside this checkpoint before resolving the pending decisions. No commit is created by the spec-reviewer — commits are the human's responsibility per the project convention.
