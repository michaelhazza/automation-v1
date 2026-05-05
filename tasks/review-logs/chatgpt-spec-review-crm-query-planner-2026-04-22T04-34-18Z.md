# ChatGPT Spec Review — CRM Query Planner v1

**Spec:** `tasks/builds/crm-query-planner/spec.md`
**Branch:** `claude/crm-query-planner`
**PR:** https://github.com/michaelhazza/automation-v1/pull/173
**Session start:** 2026-04-22T04:34Z
**Reviewer voice:** ChatGPT (external, post-Codex spec-reviewer cycles)
**Adjudicator:** Claude (main session, acting as chatgpt-spec-review coordinator)

Prior Codex `spec-reviewer` state: 3 iterations complete, 49 mechanical findings applied, final log at `tasks/review-logs/spec-review-final-crm-query-planner-20260422T034500Z.md`. Framing assumptions applied: pre-production, rapid evolution, no feature flags, prefer existing primitives (per `docs/spec-context.md`).

---

## Round 1 — ChatGPT raw feedback

ChatGPT's verdict: "Implementation-ready with low structural risk. What's left is not correctness bugs, but behavioural ambiguity under edge conditions. Add the ~8 invariant clarifications above and lock it."

ChatGPT explicitly asked for **invariant-level clarifications**, not redesign. 11 findings total.

### Finding-by-finding decisions

| # | Finding | Verdict | Edit target | Notes |
|---|---------|---------|-------------|-------|
| 1 | Single-plan invariant (§4 / §10 / §11) | **APPLY** (light) | §11.1 | Already in §3 line 123 — reinforced in §11.1 and tied to Stage 1 subset |
| 2 | Validator authority on Stage 1 bypass (§11 vs §8) | **APPLY** | §11.1 | Spec had it implied via §8.3 rule list; now tied explicitly to validator-authority principle. Stage 1 subset is framed as "scoped application of authority, not exemption" |
| 3 | Cache-hit vs non-projection validator rules (§9 vs §11) | **APPLY** | §9.3.1 | §9.3.1 already reran Rule 10; added invariant covering future rules. Classification requirement ("principal-dependent vs plan-dependent") locked so every new validator rule updates §9.3.1 and §8.3 in the same edit |
| 4 | LLM retry / no-retry contract (§10) | **APPLY** | §10.4 | Spec already limited to 1 escalation retry; stated as named retry contract with worst-case token envelope |
| 5 | Cost ceiling timing ambiguity (§16) | **APPLY** | §16.2 | Executor cost explicitly **not** pre-bounded beyond 10-call hybrid cap + runCostBreaker; per-query ceiling is Stage-3-only |
| 6 | Hybrid 10-call cap post-hoc (§14) | **APPLY** | §14.3 | Added two-layer enforcement: pre-dispatch estimate + mid-iteration short-circuit |
| 7 | `stageResolved` on error paths (§17) | **APPLY** | §17.1 | Added `stageResolved` to `planner.error_emitted` payload; added invariant that every request emits exactly one `stageResolved`-bearing event. Also added `briefId` to standard envelope (needed for finding 11) |
| 8 | Planner-as-router semantics (§18) | **APPLY** | §18.2 | Added lightweight note: entry-point vs execution-path semantics for action-level attributes |
| 9 | P2 cache stability sequencing (§19) | **APPLY** | §19 P2 | Cache effectiveness explicitly NOT a P2 exit criterion; metric still measured |
| 10 | Capability gating for internal callers (§21) | **APPLY** | §21.1 | Route-level check only; direct service callers must populate `callerCapabilities` on `ExecutorContext`. No exemption path in v1 |
| 11 | Correctness metric missing (§24) | **APPLY** (scoped) | §17.2, §24 | Added `planner.brief_refinement_rate` metric definition. Dashboard surfacing P3+. New success criterion #13: "Correctness proxy is measurable" |

### Decisions NOT made

No findings were rejected or deferred. All 11 were applied as invariant-level clarifications with minimal scope impact — every edit is one of:
- A one-line invariant addition
- A paragraph of clarification tying existing behaviour to a named principle
- A payload-field addition with spec-documented invariant (finding 7)
- A new metric **definition** (not new dashboard surface — finding 11)

No new files. No new modules. No new dependencies. Three new fields:
- `stageResolved: 1 | 2 | 3 | null` on `planner.error_emitted` payload
- `briefId?: string` on standard event envelope
- `callerCapabilities: Set<string>` on `ExecutorContext` (already implied by §12.1 per-entry capability check; now explicitly required)

### Adjudication notes

- **Framing alignment:** ChatGPT's findings aligned with the pre-production framing assumptions — no hypothetical-future scope, no feature flags, no unnecessary indirection. This is why every finding applied.
- **Finding 3 scope:** ChatGPT's raw text was arguably wrong about Rule 10 (§9.3.1 explicitly reruns it), but the underlying concern about future-rule classification is real. The applied edit addresses the forward-looking concern without accepting the misread on current state.
- **Finding 7 scope:** ChatGPT asked for an invariant on `planner.classified` being emitted on error paths. The applied fix is structurally different — adding `stageResolved` to `planner.error_emitted` — because `planner.classified` semantics name a *successful* classification and would be misleading on error. The invariant ("every request emits exactly one stageResolved-bearing event") preserves ChatGPT's intent.
- **Finding 11 scope:** ChatGPT called the metric "lightweight"; it did require one envelope-field addition (`briefId`). Dashboard rendering deferred to P3 to keep v1 gate tight; the computability-on-v1-data success criterion is the P1 gate.

---

## Deferred items / follow-ups

None. Every finding was fully addressed in-spec.

---

## Spec state after Round 1

- Codex spec-reviewer: 3 iterations, closed clean
- ChatGPT review: 1 round, 11 findings, 11 applied
- Remaining open questions: unchanged (§22)
- Deferred Items section: unchanged (§ before-§23)
- Length: ~1,960 lines (up from ~1,936 — net ~24 lines added for invariant clarifications)

**Verdict:** Spec locked pending any additional ChatGPT rounds. If ChatGPT returns a second round, it will be addressed here; otherwise this is the final spec state before implementation.

---

## Appendix — Raw ChatGPT feedback (Round 1)

> Here's a true final-pass spec review. At this point I'm not rehashing what's already been caught in your 3 iterations. I'm looking for residual structural risks that can still break implementation despite everything being "mechanically correct."
>
> All findings are high-signal only.

*(11 findings enumerated — see table above for decisions. Raw text retained in git history via this log; full copy not re-inlined to keep this log scannable.)*

> Final verdict: This spec is now Implementation-ready with low structural risk. What's left is not correctness bugs, but behavioural ambiguity under edge conditions: retries, cache guarantees, validator authority, cost boundaries. None of these require redesign. They require explicit one-line invariants. Bottom line: You don't need another full review cycle. Add the ~8 invariant clarifications above and lock it. At that point, failure modes shift from "spec was unclear" to "implementation didn't follow spec". Which is exactly where you want to be.

Applied 11 of 11.

---

## Round 2 — Final determinism pass

ChatGPT explicitly framed this as a **final challenge pass**: "I'm only looking for things that could still break in implementation or create ambiguity under pressure." 8 findings, all edge-condition determinism rules — retry tie-break, short-circuit shape, metric sampling boundaries, failure-mode definitions. None required redesign.

### Finding-by-finding decisions

| # | Finding | Verdict | Edit target | Notes |
|---|---------|---------|-------------|-------|
| 1 | Validator classification enforcement (§11.1 / §9.3.1) | **APPLY** | §11.2 intro + inline tags on rules 1–10 | Added `[principal-dependent]` / `[plan-dependent]` / `[stage1-subset]` classification tags inline on every rule. Missing tag is now a spec violation caught by `spec-reviewer` / `pr-reviewer`. Prevents cache-correctness drift when future rules are added |
| 2 | Retry tie-break (§10.4) | **APPLY** | §10.4 | Added explicit rule: escalation attempt is authoritative if both default and escalation calls return valid plans. Default-tier cost still captured on `stage3_parse_completed`. Locks same-input-same-plan determinism |
| 3 | Hybrid short-circuit result shape (§14.3) | **APPLY** | §14.3 | Added crisp single-line invariant: `BriefErrorResult { errorCode: 'cost_exceeded' }`; **no partial `BriefStructuredResult` in v1**. Round 1 edit was implied; now explicit |
| 4 | 10-call cap bounds count only (§16.2) | **APPLY** | §16.2 | Clarified: cap bounds **call count only, not response payload size or per-call latency**. Distinguishes count-bound from size-bound |
| 5 | stageResolved terminal state (§17.1) | **APPLY** | §17.1 | Added terminal-emission rule: `stageResolved`-bearing events fire only at terminal resolution; pre-terminal status events MUST NOT carry `stageResolved`. Prevents future async path double-emission |
| 6 | Cost attribution split (§18.2) | **APPLY** (corrected) | §18.2 + §16.2.1 + §17.1 payload | ChatGPT's framing ("routing overhead only") was wrong — planner includes Stage 3 LLM cost, which is real compute, not routing. Applied the **correct** framing: split into `(1) Planner cost` = Stage 3 LLM + planner-internal, `(2) Executor cost` = canonical DB / live provider calls. Updated `computeActualCostCents` signature to return `{ total, stage3, executor }` and `planner.result_emitted` payload to reflect the split |
| 7 | Missing-capability failure mode (§21.1) | **APPLY** (corrected) | §21.1 | ChatGPT suggested `errorCode: 'unauthorized'` — wrong; taxonomy uses `missing_permission` per §12.1 and `shared/types/briefResultContract.ts`. Applied with correct code. Locked "no fallback attempted" — no silent plan rewrite / projection degradation / filter drop |
| 8 | Refinement-rate sampling boundary (§17.2) | **APPLY** | §17.2 | Made three things explicit: **session boundary** = one `briefId` = one session; **per-session window** = 10-minute rolling; **aggregation window** = daily UTC roll-up matching system-pnl convention |

### Adjudication notes

- **Two corrections on ChatGPT wording** (findings 6 and 7). ChatGPT's suggested fixes used taxonomy that didn't match the repo's actual conventions. The underlying concerns were real; the applied edits preserve the intent with correct terminology.
- **Finding 1 is a process guard, not just a doc note.** Adding inline classification tags on every rule means `spec-reviewer` and `pr-reviewer` can grep for untagged rules — this is a meta-rule **with** an enforcement mechanism, exactly what ChatGPT asked for.
- **Finding 6 cascaded into three edits.** The cost-split invariant in §18.2 implied changes to `computeActualCostCents`'s return type (§16.2.1) and `planner.result_emitted`'s payload (§17.1). All three kept consistent to avoid documentation drift.

### Net changes Round 2

- Lines: +32 / -15 (47 modified) in `spec.md`
- New payload shape: `planner.result_emitted.actualCostCents` is now `{ total, stage3, executor }` instead of a single number
- New function signature: `computeActualCostCents` returns the three-way split
- No new files, no new modules, no new deferred items

### Round 2 verdict from ChatGPT

> "👉 You can ship this spec now. If you apply the 6–8 one-line clarifications above, you reach: No hidden ambiguity, No undefined edge behaviour, No future contributor traps. Bottom line: You've crossed the important threshold already. These last tweaks aren't about correctness. They're about making the system impossible to misinterpret under pressure."

Applied 8 of 8.

---

## Final state

- Codex spec-reviewer: 3 iterations, closed clean
- ChatGPT spec review: 2 rounds, 19 findings, 19 applied (11 + 8)
- Remaining open questions: unchanged (§22)
- Deferred Items section: unchanged
- Length: ~1,999 lines (up from ~1,972 after Round 2)

**Verdict:** Spec is **implementation-proof**. Ready for KNOWLEDGE.md pattern extraction and implementation kickoff.

### Pattern candidates for KNOWLEDGE.md

Surfaced from this 2-round pass — patterns worth lifting into `docs/spec-authoring-checklist.md` or `KNOWLEDGE.md`:

1. **Inline classification tags on validator rules.** Any rule-set that splits its behaviour across code paths (cache hit / cache miss, Stage 1 / Stage 4) should tag each rule inline with which path(s) it runs on. Untagged rules become ambiguity magnets on cross-path refactors.
2. **Terminal-emission invariants for observability.** When specifying an event-per-request, distinguish **terminal events** (success/error outcomes) from **status events** (intermediate transitions). Require state fields like `stageResolved` only on terminal events.
3. **Retry-tie-break clause for any LLM retry.** Whenever a spec allows >1 LLM attempt per request (retry, escalation, multi-model), lock which attempt wins when multiple succeed. Default: last successful attempt is authoritative.
4. **Cost-attribution split for routing actions.** When an action dispatches through multiple execution paths, the spec MUST split cost into `routing/planning` vs `executing` and enforce the split in observability payloads.
5. **Cap semantics are count-bound unless stated otherwise.** "10-call cap" bounds call count; response size and per-call latency require separate bounds. Never conflate.
6. **Correctness-proxy metrics ship event-data in v1, dashboard later.** Event shape locked in v1 so v2/v3 dashboards consume without schema migrations. Separates "instrumentation is in place" from "visualization is in place" as two distinct exit criteria.

These are the candidates; final KNOWLEDGE.md entries to be written when the user decides the spec is locked.

---

## Round 3 — Pre-build execution safeguards

ChatGPT pivoted explicitly: "You're ready to build. What's left is making the build phase deterministic and low-friction." 7 findings, all about **execution safeguards**, not spec gaps. ChatGPT also said plainly: "Do not add more invariants, expand spec scope, introduce new abstractions, optimise performance yet."

Given that, the adjudicator was selective about what landed in the spec vs what was advice for the build phase.

### Finding-by-finding decisions

| # | Finding | Verdict | Rationale |
|---|---------|---------|-----------|
| 1 | Golden path (first-build target) | **APPLY** | P1 sub-sequencing is spec-level; added §19 P1.0 / P1.1 / P1.2 intra-phase milestones |
| 2 | Linear execution mode for early testing | **SKIP** | Spec is already linear — no retries in parallel, no streaming, no concurrent executors. Adding "be linear" as an invariant when there's nothing to disable adds noise without value |
| 3 | Trace object | **APPLY** | Real debugging win. Added `PlannerTrace` type in §6.7 + embedded on `planner.result_emitted` payload. Explicitly framed as a view over existing events, not a new source of truth |
| 4 | Failure injection flags | **SKIP** | Pure tests + mocks in §20 already cover every branch at integration level. Runtime fault-injection env flags are scope-add without signal |
| 5 | Explicit build sequence | **PARTIAL** (folded into #1) | §19 phase plan (P1 / P2 / P3) already exists; ChatGPT wanted finer-grained ordering within P1. That's what the P1.0 / P1.1 / P1.2 sub-milestones deliver. Duplicating §19 into a longer linear Phase-0-through-5 list would bloat the spec |
| 6 | Spec-drift guard / PR-must-reference-§ rule | **SKIP** | Already covered by CLAUDE.md §11 ("Docs Stay In Sync With Code") — repeating repo-wide workflow rules inside a per-feature spec is redundant |
| 7 | Non-empty-suggestions fallback for `unsupported_query` | **APPLY** | One-line addition to §15.3 — closes a real behaviour gap where an empty Stage 3 `clarificationPrompt` could produce a dead-end error |

### ChatGPT's "if you do nothing else, do these three"

ChatGPT's top three were: (1) golden path, (3) trace object, (5) linear execution mode.
The adjudicator applied (1) and (3). (5) was rejected on the basis that the spec already enforces linear execution structurally — there is no concurrent code path to disable.

### Net changes Round 3

- Lines: +39 / -1 in `spec.md`
- New types: `PlannerTrace` in §6.7
- New payload field: `trace: PlannerTrace` on `planner.result_emitted`
- New sub-sequencing: P1.0 (skeleton) / P1.1 (golden path) / P1.2 (rest of P1) in §19
- New behaviour contract: non-empty suggestions guarantee for error results, with a concrete fallback string

### What did NOT land in the spec (intentionally)

Everything ChatGPT framed as a **build-phase practice**:

- Linear execution mode during bring-up — good dev discipline, not a product requirement
- Failure injection flags — testability tooling, not spec surface
- PR-must-reference-§ workflow rule — already in CLAUDE.md

These are real good ideas; they'll inform the **implementation plan** (architect agent / execute-plan skill), not the spec. Keeping the spec surgical is itself a spec-authoring discipline ChatGPT would have flagged had it bloated.

Applied 3 of 7, skipped 3, folded 1.

---

## Final state after Round 3

- Codex spec-reviewer: 3 iterations, closed clean
- ChatGPT spec review: 3 rounds, 26 findings total (11 + 8 + 7), 22 applied (11 + 8 + 3)
- Skipped: 4 (all from Round 3, all build-phase not spec-phase)
- Remaining open questions: unchanged (§22)
- Deferred Items: unchanged
- Length: ~2,038 lines

**Verdict:** Spec is implementation-proof AND the P1 build has a clear golden-path first-commit target. The next agent (architect or direct implementation) can start on P1.0 skeleton with confidence.

### Updated pattern candidates for KNOWLEDGE.md

Adding to the earlier list:

7. **Golden-path sub-sequencing within phases.** For any multi-feature phase (e.g. P1 ships 8 registry entries), ship ONE end-to-end path first (skeleton → golden path → replication). This proves cross-cutting wiring before taking on breadth, and gives the UI integration surface a real target within hours.
8. **Trace object derived from existing events.** Where debugging requires cross-event correlation (`intentHash` grouping), add a flat trace type embedded on the terminal event. Frame it explicitly as a view over existing events, not a new source of truth — avoids the ambiguity of "is the trace or the event stream authoritative?"
9. **Non-empty-result guarantees on error shapes.** When a contract requires "every error carries suggestions", specify the fallback path concretely (e.g. "inject a static list of supported phrasings if the LLM produced no clarification"). An empty-array technically satisfies a `suggestions: string[]` field type but violates the UX intent.

These join the 6 from Rounds 1-2 for the eventual KNOWLEDGE.md pass.

---

## Round 4 — "Last 2-3% tightening" pass

ChatGPT explicitly confirmed all 4 of Round 3's skips as correct calls. Then returned one more high-signal pass — labelled "last 2-3% tightening, not a structural review."

8 findings + one "perfect addition" (a deterministic-first preamble sentence). Adjudicated: 8 applied, 1 skipped.

### Finding-by-finding decisions

| # | Finding | Verdict | Notes |
|---|---------|---------|-------|
| 1 | `NotImplementedError` for non-golden-path during P1.1 | **APPLY** | Put teeth on the golden-path guidance. `throw new NotImplementedError` beats stub-returning. Documented in §19 with explicit code sketch; guards come off in P1.2 |
| 2 | Trace mutations[] for decision deltas | **APPLY** (scoped) | Added `PlannerPlanMutation` + closed-set enumeration. Only two mutation stages exist in v1 (canonical-precedence promotion, P2 hybrid→unsupported rewrite). Future mutations MUST extend the enum — silent mutation is a spec violation |
| 3 | Canonical executor `assertFieldsSubset` | **APPLY** | Added to §12.1 executor contract. Defence in depth against Stage 1 / Stage 4 / executor drift on `allowedFields`. Specified the helper's purity and throw shape |
| 4 | Cost prediction drift warning | **APPLY** | Added to §16.2.1: `warn`-level `cost_prediction_drift` log when actual > predicted × 2. Non-blocking, threshold configurable via `systemSettings` |
| 5 | Cache miss categorization refinement | **SKIP** | Existing `not_present \| expired \| principal_mismatch` already covers avoidability signal. `evicted` is indistinguishable from `expired` at lookup time without tracking-on-evict. Defer unless cache debugging becomes a real concern |
| 6 | Unsupported query subcategory | **APPLY** (narrow) | Added `errorSubcategory` to `planner.error_emitted` with closed set covering P1/P2/P3 distinctions + cost-boundary splits. Explicitly planner-internal; never surfaces on wire `errorCode` |
| 7 | Capability skip-unknown-capability rule | **APPLY** | Real disambiguation fix — existing §11.2 rule 10 wording ("treating missing entries as absent") was genuinely ambiguous. Added two-state rule: unknown slug → skipped + logged; known slug + caller lacks it → fails. Cross-referenced from §11.2 rule 10 to §12.1 so there's one source of truth |
| 8 | Planner ↔ Orchestrator boundary invariant | **APPLY** (invariant only) | Added to §3. Skipped the `assert(!input.preclassifiedSource)` — the request type (§18.1) has no such field, so assertion is structurally redundant. The invariant is worth stating so the Orchestrator's future evolution doesn't quietly grow such a slot |
| Final | "Deterministic-first" preamble sentence | **APPLY** | Added verbatim as a blockquote at the top of the spec, above §1. One-liner ChatGPT called out explicitly as the final perfect addition |

### Self-check against "don't add more invariants" (Round 3 warning)

ChatGPT itself said this round is 2-3% tightening, which inherently involves more invariants. The applied edits are narrow:

- Finding 1 is a build-phase guard, not a product invariant
- Finding 2 is a data model addition with a closed set (two mutations in v1)
- Finding 3 is a defensive assertion co-located with existing capability check
- Finding 4 is a log line, not a runtime check
- Finding 6 is a payload field, not a new decision branch
- Finding 7 disambiguates existing ambiguous wording — net invariant count unchanged
- Finding 8 is a one-liner describing an already-structurally-enforced property
- Final is a 1-sentence preamble

None of these add new abstractions or new execution paths. Consistent with Round 3's "don't bloat" guidance.

### Net changes Round 4

- Lines: +47 / -3 in `spec.md`
- New types: `PlannerPlanMutation`
- New payload field: `errorSubcategory` on `planner.error_emitted`
- New observability: `cost_prediction_drift` warn log
- New executor assertion: `assertFieldsSubset`
- New build-phase guard: `NotImplementedError` pattern during P1.1
- New preamble invariant: "Deterministic-first, no implicit behaviour"
- New boundary invariant: planner receives raw intent only

---

## Final state after Round 4

- Codex spec-reviewer: 3 iterations, closed clean
- ChatGPT spec review: 4 rounds, 34 findings total (11 + 8 + 7 + 8), 30 applied
- Skipped: 4 (3 from Round 3 build-phase practices + 1 from Round 4 cache-refinement)
- Length: ~2,071 lines (from starting point ~1,936)
- Remaining open questions: unchanged (§22)
- Deferred Items: unchanged

**Verdict:** ChatGPT's framing — "past 'ready to build', now at 'safe to build without rework risk'." Ready to move to implementation planning.

### Full KNOWLEDGE.md pattern candidates (12 total across 4 rounds)

Carrying forward from Rounds 1–3 + Round 4 additions:

1. **Inline classification tags on validator rules** (R2)
2. **Terminal-emission invariants for observability** (R2)
3. **Retry-tie-break clause for any LLM retry** (R2)
4. **Cost-attribution split for routing actions** (R2)
5. **Cap semantics are count-bound unless stated otherwise** (R2)
6. **Correctness-proxy metrics ship event-data in v1, dashboard later** (R2)
7. **Golden-path sub-sequencing within phases** (R3)
8. **Trace object derived from existing events** (R3)
9. **Non-empty-result guarantees on error shapes** (R3)
10. **Hard build-phase guards (`NotImplementedError`) on non-golden-path code during vertical slice** (R4)
11. **Closed-set mutation enumeration in trace objects** (R4)
12. **Two-state capability rule: skipped_unknown vs enforced_known** (R4)

Ready for extraction into `docs/spec-authoring-checklist.md` and/or `KNOWLEDGE.md` when the user signals the spec is locked.

ChatGPT's suggested next step: *"turning this into a Claude Code execution plan (task-by-task build order with guardrails)"* — i.e. invoke the `architect` agent next to decompose the spec into implementation chunks.

---

## Round 5 — "Edge integrity under real-usage pressure"

ChatGPT's own end-note: *"Do not review again. Do this: → Generate the Claude Code execution plan."* Treating this as genuinely the last review round — 7 findings that surface only under real-usage pressure.

6 applied, 1 skipped.

### Finding-by-finding decisions

| # | Finding | Verdict | Notes |
|---|---------|---------|-------|
| 1 | Plan cache confidence / short-TTL | **APPLY** (narrow) | Added `cacheConfidence: 'high' \| 'medium' \| 'low'` on `PlanCacheEntry`. Tiered TTL: high/medium = 60s (existing), low = 15s. Plan confidence sourced from Stage 1 (always high) and Stage 3 outcome (low if escalation fired or confidence < threshold). Prevents bad Stage 3 plans from going sticky |
| 2 | Idempotency contract | **APPLY** (invariant only) | Added to §3. Deterministic at Stage 1 / Stage 2, non-deterministic at Stage 3 (by design — LLM is the escape hatch). Skipped the `planner.idempotency_miss` log — detecting it requires shadow-copying prior plans, which is Query Memory Layer v2 territory |
| 3 | Hybrid partial-success semantics | **APPLY** (as fail-fast + deferred partial) | v1 is **fail-fast** on individual live-call failures: `errorCode: 'live_call_failed'`. No partial `BriefStructuredResult` returns because partial mixes in an inconsistent set the user can't tell is incomplete. Partial-result mode added to Deferred Items as a BUILD-WHEN-SIGNAL item, gated on transient-failure rate |
| 4 | Cost back-pressure loop (auto-downgrade) | **SKIP** | Per-run `cost_prediction_drift` log already exists (§16.2.1). Aggregate "sustained drift" detection is a dashboard concern, not a service concern. Auto-tier-downgrade is out of scope for v1 — no automation infrastructure to plug into |
| 5 | Dead-end detection metric | **APPLY** (light) | Added `planner.registry_gap_rate` derived metric to §17.2. Computed from existing events (stage1_missed + high-confidence Stage 3 parse + unsupported_query terminal). Direct input to Query Memory Layer v2 promotion workflow |
| 6 | Registry conflict detection | **APPLY** (statement only) | Single-match invariant added to §8.2. Structural guard already exists via the build-time alias collision throw. Added runtime defence-in-depth assertion (`RegistryConflictError`) as a sentinel — module-load failure should always prevent the state, so the runtime throw catches "the index was mutated externally" |
| 7 | Normaliser versioning | **APPLY** | `NORMALISER_VERSION = 1` constant in §6.5. Included in cache key (§9.1) and `PlannerTrace` (§6.7). New §7.5 documents the safe-upgrade contract: bump on any behaviour change that affects output hash. Makes normaliser upgrades automatic cache-invalidation events without explicit flush |

### Adjudication notes

- **ChatGPT's anti-poisoning insight (finding 1) is the highest-leverage Round 5 find.** The problem is real: a subtly-wrong-but-valid Stage 3 plan cached at 60s TTL would dominate responses for up to a minute. Tiered TTL is a 15-second blast radius maximum.
- **Fail-fast + defer partial (finding 3) is the opposite of ChatGPT's suggestion.** ChatGPT wanted partial-success with `partial: true`. The adjudicator chose fail-fast for v1 because "mixing canonical-base rows that got live-filtered against rows that didn't" is a silently-inconsistent result — the user has no visual cue. Fail-fast produces clear signal; partial mode is opt-in via future `allowPartial: true` request flag, signal-gated in Deferred Items
- **Skipping finding 4 (back-pressure loop) is the one place the adjudicator disagreed with ChatGPT's direct suggestion.** The per-run drift log was already accepted in Round 4; adding a sustained-drift aggregate log without consumers is speculative. Dashboards exist for this; adding service-side aggregation would duplicate work

### Net changes Round 5

- Lines: +51 / -7 in `spec.md`
- New constants: `NORMALISER_VERSION = 1`
- New type fields: `cacheConfidence` + `normaliserVersion` on `PlanCacheEntry`; `normaliserVersion` on `PlannerTrace`
- New errorSubcategory values: `live_call_failed`, `partial_failure`
- New cache behaviour: tiered TTL, version-scoped cache keys
- New metric: `planner.registry_gap_rate`
- New invariants: idempotency contract (§3), single-match (§8.2), fail-fast hybrid (§14.3)
- New deferred item: hybrid partial-result mode (BUILD-WHEN-SIGNAL)

---

## Final state after 5 rounds

- Codex spec-reviewer: 3 iterations, closed clean
- ChatGPT spec review: **5 rounds**, **41 findings total** (11 + 8 + 7 + 8 + 7), **36 applied, 5 skipped**
- Length: ~2,115 lines (from starting ~1,936)

ChatGPT's directive after Round 5: *"Do not review again. → Generate the Claude Code execution plan."* Aligning with that — the spec is locked; the next action is `architect` agent decomposition into P1.0 / P1.1 / P1.2 tasks.

### Full KNOWLEDGE.md pattern candidates (15 total across 5 rounds)

Adding Round 5:

13. **Tiered TTL on plan caches by plan confidence.** When an LLM can produce "valid-looking but subtly wrong" outputs, tier the cache TTL by plan confidence so bad plans have small blast radius. Don't rely on validator acceptance alone — a cache entry's TTL is a second defence against silent plan poisoning.
14. **Versioned pure functions whose output affects cache keys.** Any pure transformation used in a cache key (tokenisation, hashing, normalisation) needs a version constant. Bumping the version becomes a safe, automatic cache invalidation mechanism — no explicit flush, no stale-entry bugs.
15. **Fail-fast vs partial in multi-call executors.** When an executor dispatches N sub-calls, state explicitly whether individual failures are fail-fast (one failure kills the query) or partial (return successes with a `partial: true` marker). Mixing modes silently is the real bug; stating the default is the fix. Partial-mode belongs in Deferred Items unless real-usage signal justifies it.

15 patterns total ready for extraction into `docs/spec-authoring-checklist.md` / `KNOWLEDGE.md` when the user gives the signal.
