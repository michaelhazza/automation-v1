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
