# ChatGPT PR Review Session — bugfixes-april26 — 2026-04-24T11-55-28Z

## Session Info
- Branch: bugfixes-april26
- PR: #185 — https://github.com/michaelhazza/michaelhazza/automation-v1/pull/185
- Started: 2026-04-24T11:55:28Z
- Note: diff already shared with ChatGPT; Round 1 feedback processed directly per caller contract.

---

## Round 1 — 2026-04-24T11-55-28Z

### ChatGPT Feedback (raw)

Executive summary: near merge-ready PR. Themes — resumability, idempotent recovery, UI clarity under long-running jobs, eliminating silent failure states. 2 material issues to fix before merge + a handful of tightening improvements.

Must-fix (red):
1. Hidden selected agent proposals — SkillAnalyzerResultsStep.tsx filter `allProposals.filter((p) => p.isProposedNewAgent || p.score >= AGENT_SCORE_DISPLAY_THRESHOLD)` hides selected proposals below the threshold. Fix: add `p.selected ||`.
2. Dual source of truth for mid-flight statuses — defined in staleAnalyzerJobSweepJobPure.ts, implicitly in pipeline (skillAnalyzerJob.ts), referenced in tests. Stringly-typed duplication; move to single exported enum/type.

Important improvements (yellow):
3. Resume UX correctness — UI assumes resume always works; backend may reject/race/partial. Add explicit server response contract `{ status: 'resumed' | 'already_running' | 'rejected' }`.
4. Polling lifecycle complexity — pollVersion, initialJob vs currentJob, terminal-state guards in multiple places. Create single `isTerminal(status)` helper.
5. Diff fallback logic (MergeReviewBlock) — edge case when one side is empty string looks like full replacement. Handle explicitly: `if (!baseline) return [{ kind: 'added', value }]; if (!value) return [{ kind: 'removed', value: baseline }];`
6. Warning partition logic coupling — FORMATTING_WARNING_CODES set; new codes silently fall into primary group. Add invariant assertion or dev-time comment.
7. Job expiry change (3600 → 14400) — if sweep fails, job locked for 4 hours. Verify resume endpoint's force-expire path runs even if job isn't marked failed.

Green (skipped — not action items): real production failure modes addressed, resume architecture correct, sweep job design clean, UI state modelling improved, KNOWLEDGE.md additions high quality.

Final verdict: Approve with 2 required fixes.

### Triage + Recommendations

| # | Finding | Triage | scope_signal | Recommendation | Rationale |
|---|---------|--------|--------------|----------------|-----------|
| 1 | Hidden selected agent proposals — add `p.selected \|\|` to filter | user-facing | standard | implement | Silent UI state — user cannot see/deselect a selected agent below threshold. Visible workflow + approval-correctness bug affecting admin-as-user. Explicitly user-facing per playbook (changes visible behaviour; admin UI). |
| 2 | Centralise mid-flight status definitions — export single const/type, import everywhere | technical | standard | implement | Pure internal type-safety refactor; no visible behaviour change. Exact class of bug (matching vs comparing) already happened — same-root-cause structural risk. Clear, immediate value. |
| 3 | Resume UX — explicit server contract `{ status: 'resumed' \| 'already_running' \| 'rejected' }` with UI branching | user-facing | architectural | defer | API contract change + visible UX branching. Current behaviour: server throws 409 on conflict, client shows extracted message. Works correctly; improvement is polish, not bug. Scope: server route + service response type + mergeTypes mirror + ProcessingStep branching + tests. Out-of-scope for this bug-fix PR. |
| 4 | Polling lifecycle — single `isTerminal(status)` helper | technical | standard | implement | Pure internal refactor (DRY). Five status literal checks exist in SkillAnalyzerProcessingStep alone (lines 89, 110, 113, 132, 137, 138, 181) + SkillAnalyzerWizard. Low-risk, matches existing runStatus.ts pattern used for agent-runs. Extract to `client/src/components/skill-analyzer/analyzerStatus.ts`. |
| 5 | Diff fallback for empty-string baseline/value | technical | standard | implement | Real edge-case bug in `InlineDiff`. When baseline is `""` and value is non-empty, `diffWordsWithSpace("", "foo")` produces `[{added:"foo"}]` (works) but the `hasUnchanged` check goes false → fallback kicks in and renders an empty strikethrough. Explicit empty-string guards are safer + clearer. Pure display fix, no behaviour user needs to approve. |
| 6 | Warning partition — invariant assertion/comment for unclassified codes | technical | standard | implement | Lightweight safety net. Add dev-time assertion: at module load, iterate known `MergeWarningCode` values and log a warning if any are neither in `FORMATTING_WARNING_CODES` nor explicitly classified primary. Prevents silent miscategorisation. No user-visible behaviour change. |
| 7 | Resume force-expire path — runs only when `job.status === 'failed'` | technical | standard | implement | **Real latent bug.** Read of `resumeJob` confirms: if pg-boss has a ghost `active` row AND the DB row is still mid-flight (not yet marked failed by sweep), the endpoint throws 409. The sweep has a 15-min threshold; within that window a user clicking Resume hits a blocked state. Fix: when the local row is mid-flight (not 'completed' / not 'pending') AND `updated_at` is older than a short stale bound (e.g. 2× STALLED_THRESHOLD_MS ≈ 10 min), allow the force-expire path. Internal reliability fix; user still sees the same "Resume" button, just works in more cases. |

### Scope budget

Finding 1 (user-facing) awaits user approval.
Finding 3 is a user-facing defer — route to tasks/todo.md regardless of user decision on content.
Findings 2, 4, 5, 6, 7 = technical auto-implement.

### Auto-apply plan (pending technical implementation)

- [technical/2] Export `SKILL_ANALYZER_MID_FLIGHT_STATUSES` + `SkillAnalyzerJobStatus` from a single module (likely `server/services/skillAnalyzerService.ts` keeping the existing `SkillAnalyzerJobStatus` as the source of truth), import into `staleAnalyzerJobSweepJobPure.ts` and sweep tests. Drop the duplicate string list.
- [technical/4] Create `client/src/components/skill-analyzer/analyzerStatus.ts` with `isTerminalAnalyzerStatus` + `isMidFlightAnalyzerStatus`. Refactor `SkillAnalyzerProcessingStep.tsx` and `SkillAnalyzerWizard.tsx` to use it.
- [technical/5] Add explicit empty-string branches to `InlineDiff` in `MergeReviewBlock.tsx` before the `diffWordsWithSpace` call.
- [technical/6] Add a dev-time check at module load in `MergeReviewBlock.tsx` that validates every `MergeWarningCode` is in exactly one of the two partitions.
- [technical/7] Broaden the `force-expire` branch in `resumeJob` to also cover mid-flight rows whose `updated_at` is beyond a conservative stale bound.

### Implemented (technical auto-applies — round 1, committed separately from user-facing finding 1)

- [auto/2] Centralised mid-flight status definitions in `server/services/skillAnalyzerServicePure.ts` — added `SKILL_ANALYZER_JOB_STATUSES`, `SKILL_ANALYZER_MID_FLIGHT_STATUSES`, `SKILL_ANALYZER_TERMINAL_STATUSES` plus `isSkillAnalyzerMidFlightStatus` / `isSkillAnalyzerTerminalStatus`. `server/services/skillAnalyzerService.ts` now re-exports them (preserving external import path). `server/jobs/staleAnalyzerJobSweepJobPure.ts` imports from the canonical module. `server/db/schema/skillAnalyzerJobs.ts` uses the type in its `$type<>` parameter. No behaviour change; all existing pure tests pass. 7/7 sweep tests pass.
- [auto/4] Added `client/src/components/skill-analyzer/analyzerStatus.ts` — browser-safe mirror of the server status helpers. Refactored `SkillAnalyzerProcessingStep.tsx` to use `isTerminalAnalyzerStatus`. Wizard's `resolveStep` intentionally distinguishes `completed` (→ results) from `failed` (→ processing error view), so left as-is.
- [auto/5] Added explicit empty-string handling to `InlineDiff` in `MergeReviewBlock.tsx` — empty baseline renders as pure addition; empty value renders as pure removal. Previously the fallback branch could trip with a misleading empty-string strikethrough.
- [auto/6] Added dev-time invariant in `MergeReviewBlock.tsx` — walks `DEFAULT_WARNING_TIER_MAP` at module load in non-production and warns if any informational-tier warning codes are not classified into `FORMATTING_WARNING_CODES`. Next informational code added in `mergeTypes.ts` will surface a console warning at boot if the partition wasn't updated.
- [auto/7] Broadened `resumeJob` force-expire path in `server/services/skillAnalyzerService.ts` — now covers both `job.status === 'failed'` AND mid-flight rows whose `updated_at` is older than 30 min (2× the sweep threshold). Previously a user clicking Resume during the sweep's 15-min window would get a 409 "already queued or running" on a dead worker. Added `skill_analyzer.resume_force_expired_ghost` log for observability.

### Deferred (user-facing defer, routed to tasks/todo.md)

- Finding 3 — explicit resume response contract `{ status: 'resumed' | 'already_running' | 'rejected' }` with UI branching. Architectural scope change; defer to a dedicated PR.

### Awaiting user approval (user-facing)

- Finding 1 — hidden selected agent proposals. Preserve selected proposals regardless of score threshold. Recommendation: implement. **Not committed yet** per caller contract.

### Verification

- Server `tsc -p server/tsconfig.json --noEmit`: 76 errors before / 76 errors after (zero net added; all pre-existing in unrelated modules).
- Client `tsc -p client/tsconfig.json --noEmit`: 11 errors before / 11 errors after (zero net added).
- `npx tsx server/jobs/__tests__/staleAnalyzerJobSweepJobPure.test.ts`: 7/7 pass.
- `npx tsx server/services/__tests__/skillAnalyzerServicePure*.test.ts`: 149/150 pass; 1 pre-existing failure in `remediateTables` verified present on baseline (unrelated to this round).
- No `lint` script defined in package.json; typecheck + targeted tests cover the changes.

### User decisions (logged after recommendation block)

- **Finding 1 — IMPLEMENT.** User confirmed this is a real correctness bug, not polish: hiding a selected-but-low-score agent proposal silently traps the selection with no UI to undo it. Verified that `addableAgents` (line 143-146) and both empty-state messages (lines 194-204) already use `allProposals`, not the filtered `proposals` — the reviewer's note is correct, no further changes needed on those lines. The fix is scoped to the single filter predicate on line 134-136.
- **Finding 3 — DEFER.** User confirmed the current 409-throw + error-message-extraction behaviour is functionally correct; the tagged-union contract improvement is polish for a dedicated PR, out of scope for this bug-fix batch. Routed to `tasks/todo.md` under new dated section `## Deferred from chatgpt-pr-review — PR #185 (bugfixes-april26)`.

### Implemented (user-approved user-facing — round 1, final)

- [user/1] `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` — added `p.selected ||` to the `AgentChipBlock` proposals filter. Selected proposals now always render regardless of score, so a user who auto-selected a below-threshold agent (or whose agent fell below the threshold after a score recompute) can still see and deselect it. Added a comment explaining the state-preservation rationale.

```diff
   const proposals = allProposals.filter(
-    (p) => p.isProposedNewAgent || p.score >= AGENT_SCORE_DISPLAY_THRESHOLD,
+    (p) => p.selected || p.isProposedNewAgent || p.score >= AGENT_SCORE_DISPLAY_THRESHOLD,
   );
```

### Deferred (user-facing defer, routed to tasks/todo.md — round 1, final)

- Finding 3 — written to `tasks/todo.md` under new section `## Deferred from chatgpt-pr-review — PR #185 (bugfixes-april26)` with full scope description (server route + `resumeJob` response type + client `SkillAnalyzerWizard` / `mergeTypes` mirror type + `SkillAnalyzerProcessingStep` branching + tests).

### Verification (post user-approved fix)

- Client `tsc -p client/tsconfig.json --noEmit`: 11 errors → 11 errors (zero net added; same pre-existing errors in `ClarificationInbox.tsx` and `SkillAnalyzerExecuteStep.tsx` unrelated to this change).
- `npx tsx server/services/__tests__/skillAnalyzerServicePure.test.ts`: 29/29 pass.
- `npx tsx server/services/__tests__/skillAnalyzerServicePureAgentRanking.test.ts`: 11/11 pass (agent-ranking is the closest surface to the filter change; tests exercise the proposal ranking that feeds `agentProposals`).

### KNOWLEDGE.md pattern extraction (round 1)

Reviewed KNOWLEDGE.md against the 7 round-1 findings. Four novel reusable patterns captured:

- **Display-threshold filters must preserve state-bearing items** — finding 1. Generalises to any UI that hides low-signal items below a score/confidence/relevance threshold when those items can carry user-visible state (`selected`, `pinned`, `resolved`). No existing entry covered this.
- **Dev-time invariant at module load catches partition/enum drift** — finding 6. Generalises to any "enum-subset-as-partition" module: status classifiers, permission tiers, event priority maps. No existing entry.
- **Stale-job sweep window leaves a recovery-blocked gap for resume** — finding 7. Complements the existing 2026-04-24 pg-boss ghost lock entry (line 427) which documents the ghost lock; this new entry documents the sweep-window gap in the recovery path itself. Distinct and reusable.
- **Diff rendering must branch explicitly on empty-string inputs** — finding 5. Generalises to any merge / review / before-after UI that diffs strings. No existing entry.

Skipped:

- Finding 2 (centralise status enums across files) — the pattern is substantively covered by the existing line 327 engine-drift entry and line 504 stable-codes entry. Appending a narrower entry would duplicate existing guidance.
- Finding 3 (resume response contract as tagged union) — user-facing product decision, not a reusable engineering pattern.
- Finding 4 (single `isTerminal` helper) — the pattern is pure DRY against an existing codebase pattern (`shared/runStatus.ts`); no durable lesson to extract.

---

## Round 2 — 2026-04-24T13-30-00Z

### ChatGPT Feedback (raw)

Executive summary: effectively done — merge-ready. Fixes are correct, architectural direction is clean, no hidden regressions in the diff. Only remaining items are optional hardening and one small consistency check.

1. **Resume path vs UI contract (sanity check only)** — deferred tagged union is fine; `resumeJob` now has three outcomes (success / 409 / force-expire ghost→success) and UI behaviour (resumeError string + optimistic reset) is internally consistent. **No action required.**
2. **Status source-of-truth mirroring (minor risk check)** — server canonical vs client mirror both contain identical strings. Confirmed from diff. Documented as future drift point. **No change needed.**
3. **Stale sweep + resume interplay (important but already handled)** — 5 min UI stalled, 15 min sweep auto-fail, 30 min resume force-expire — well-designed layered model. Mild edge: UI says "worker may have crashed after 5 min" but resume might still 409 until 30 min (rare). Broadened force-expire mitigates. **Acceptable tradeoff. Not worth changing now.**
4. **ProcessingStep complexity (non-blocking observation)** — still dense (pollVersion, initialJob vs currentJob, lastProgressAt, multiple guards). Stability-first implementation. Future extraction candidate (state machine or hook). **Do nothing now.**
5. **One tiny improvement (optional, 2 min change)** — In AgentChipBlock, current fixed filter is `allProposals.filter((p) => p.selected || p.isProposedNewAgent || p.score >= AGENT_SCORE_DISPLAY_THRESHOLD)`. Optional: append `.sort((a, b) => Number(b.selected) - Number(a.selected))` so selected always renders first. Not required, but improves UX clarity slightly.

Final verdict: No correctness bugs remain. No architectural blockers. No hidden regressions. Deferred item correctly scoped. Clear to merge. **✅ done.**

### Recommendations and Decisions

| # | Finding | Triage | scope_signal | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|--------------|----------------|----------------|----------|-----------|
| 1 | Resume path vs UI contract — sanity check, no action | user-facing | standard | reject (no-op — reviewer observation) | reject (no-op — reviewer observation) | low | Reviewer explicitly marked "no action required." Already handled via round-1 deferral of the tagged-union contract (routed to tasks/todo.md). No new work. |
| 2 | Status source-of-truth mirror — identical strings confirmed, minor future drift risk | technical | standard | reject (no-op — reviewer observation) | auto (reject) | low | Reviewer marked "no change needed." Client mirror is intentional (browser-safe) and already protected at round 1 finding 2 by centralising the server canonical list. Future drift already caught by the module-load invariant pattern introduced in round 1 finding 6 if we apply it to the status enum later; not worth adding speculatively. |
| 3 | Stale sweep + resume interplay — acceptable tradeoff, already handled | technical | standard | reject (no-op — reviewer observation) | auto (reject) | low | Reviewer marked "not worth changing now." The layered model (5/15/30 min) is deliberate: UI hint at 5 min, sweep auto-fail at 15 min, resume force-expire at 30 min. Tightening the UI copy to match the 30 min force-expire window would mislead more often than it helps. |
| 4 | ProcessingStep complexity — observation, defer | technical | architectural | defer | defer (escalated — scope_signal architectural) | low | Reviewer marked "do nothing now." Extraction (state machine or hook) is a meaningful refactor with non-trivial blast radius (polling lifecycle, progress tracking, terminal-state guards in multiple places). Escalated per the architectural-scope carveout — surface to user via the deferred backlog rather than auto-apply. |
| 5 | AgentChipBlock — sort selected proposals first | user-facing | standard | implement | implement | low | Visible reorder (chips move to top when selected). One-line change using stable `Array.prototype.sort` (ES2019+). `p.selected: boolean` → `Number()` coerces to 0/1 — type-safe. No risk. Meaningfully aids discoverability when many below-threshold proposals are visible because they're selected. User said "apply if recommend implement" — implementing. |

### Implemented (user-approved user-facing — round 2, final)

- [user/5] `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` — appended `.sort((a, b) => Number(b.selected) - Number(a.selected))` to the `AgentChipBlock` `proposals` derivation. Selected chips now render at the top of the chip list, improving discoverability when below-threshold proposals are visible because they're selected. Added a block comment explaining stability semantics (`Array.prototype.sort` is stable in ES2019+, so the relative order of unselected proposals is preserved from the score-ranked `allProposals` input).

```diff
-  const proposals = allProposals.filter(
-    (p) => p.selected || p.isProposedNewAgent || p.score >= AGENT_SCORE_DISPLAY_THRESHOLD,
-  );
+  const proposals = allProposals
+    .filter(
+      (p) => p.selected || p.isProposedNewAgent || p.score >= AGENT_SCORE_DISPLAY_THRESHOLD,
+    )
+    .sort((a, b) => Number(b.selected) - Number(a.selected));
```

### Deferred (routed to tasks/todo.md — round 2)

- Finding 4 — ProcessingStep extraction (state machine or hook). Reviewer observation marked "do nothing now." Appended to existing `## Deferred from chatgpt-pr-review — PR #185 (bugfixes-april26)` section rather than opening a new section — same review, same PR.

### Verification (round 2)

- Client `tsc -p client/tsconfig.json --noEmit`: 11 errors → 11 errors (zero net added; same pre-existing errors in `ClarificationInbox.tsx` and `SkillAnalyzerExecuteStep.tsx` unrelated to this change).
- No client-side test suite exists for `SkillAnalyzerResultsStep.tsx`. The change is purely presentational (reorder existing array, identical render path). Typecheck clean + no behaviour change in the downstream chip-render loop = green.
- No `lint` script defined in package.json.

### Top themes (finding_type vocabulary)

- reviewer_observation (findings 1, 2, 3)
- architecture (finding 4 — escalated defer)
- other (finding 5 — UX sort-order polish)

---

## Round 3 — 2026-04-24T14-50-00Z

### ChatGPT Feedback (raw)

Executive summary

I went through the full PR surface, not just the delta you described. This is clean. There are no hidden correctness issues, no architectural regressions, and the resilience model is now actually robust. You're safe to merge. There are only two very minor observations, both optional.

1. Status mirroring is now structurally correct (no drift risk today)
You fixed the biggest historical footgun: canonical lives in server, client has a minimal mirror + helper functions. This is exactly the right tradeoff. Key piece: "server module is the source of truth; this file is a minimal browser-safe mirror". Reinforced with centralized helpers (isTerminalAnalyzerStatus, isMidFlightAnalyzerStatus) and removal of scattered string checks. Verdict: no drift today. Next evolution would be codegen, but not worth it yet.

2. Stale-job recovery system is now properly closed-loop (this is excellent)
Three layers: Detection (UI 5 min stalled, Sweep 15 min silence), Recovery (Sweep → marks failed + expires pg-boss lock; Resume endpoint → force-expire safety path), Execution (handler is idempotent and resumable). Specifically fixes the previously dangerous "dead worker + active pg-boss lock + UI stuck forever" state. Now: no permanent stuck state, no infinite 409 loop, no lost work. Production-grade behaviour.

3. ProcessingStep: complex but now correct
Polling lifecycle deterministic; Resume properly re-arms polling (pollVersion); stalled detection uses server timestamp, not mount time; terminal handling unified via helper. Was fragile before; now stable. Worth refactoring later. **Do not touch it now. It's in the right "stability-first" state.**

4. MergeReviewBlock partition guard is a quiet high-quality addition
Enum grows → dev warning fires; no runtime cost in prod; no silent misclassification. The exact kind of guard most codebases skip.

5. One optional improvement (very minor)
In the sweep: `ORDER BY updated_at FOR UPDATE SKIP LOCKED`. You might consider `ORDER BY updated_at ASC`. Postgres defaults to ASC, so behaviour is identical. Purely clarity. Not required.

6. One UX edge (also optional)
Edge case: job stalls (5 min) → user clicks Resume → backend still sees pg-boss active (rare race) → user gets error message. You already surface resumeError, which is good. Optional: if error contains "already running", replace with "Worker is still shutting down — try again shortly". Polish, not correctness.

Final verdict: No bugs. No race conditions. No broken contracts. No hidden regressions. Deferred items correctly scoped. Properly merge-ready.

Final answer: done.

### Recommendations and Decisions

| # | Finding | Triage | scope_signal | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|--------------|----------------|----------------|----------|-----------|
| 1 | Status mirroring structurally correct — no drift risk today | technical | standard | reject (no-op — reviewer observation) | auto (reject) | low | Reviewer marked "no drift today." Ratifies round-1 finding 2 implementation (server canonical + minimal client mirror). Not a finding — a validation that the shipped design holds under deep review. |
| 2 | Stale-job recovery closed-loop (detection / recovery / execution layers) | technical | standard | reject (no-op — reviewer observation) | auto (reject) | low | Reviewer marked "production-grade behaviour." Ratifies round-1 finding 7 (broadened force-expire) + the existing sweep + handler idempotency. Validation, not a finding. |
| 3 | ProcessingStep complex but correct — do not touch | technical | standard | reject (no-op — reviewer observation) | auto (reject) | low | Reviewer explicitly said "Do not touch it now. It's in the right stability-first state." Ratifies round-2 finding 4 deferral (extraction already routed to tasks/todo.md). No action. |
| 4 | MergeReviewBlock partition guard — quiet high-quality addition | technical | standard | reject (no-op — reviewer observation) | auto (reject) | low | Reviewer commendation on round-1 finding 6. No action. |
| 5 | Sweep: explicit `ORDER BY updated_at ASC` for clarity | technical | standard | reject (cosmetic — zero behavioural change) | reject | low | Postgres default for `ORDER BY` is ASC. Appending an explicit `ASC` is purely cosmetic, zero behavioural impact, zero clarity win over the existing explicit ordering by `updated_at`. Reviewer marked "not required." User confirmed: reject. No auto-implement even though technical — `[missing-doc]` path does not apply; this is a "recommend reject" per §Recommendation Criteria "stylistic preference only, with no documented standard." |
| 6 | Resume "already running" error: rewrite copy to "Worker is still shutting down — try again shortly" | user-facing | standard | reject (subsumed by round-1 deferred item) | reject | low | User-facing (visible error copy). Reviewer marked "polish, not correctness." Already subsumed by round-1 finding 3 deferral (resume tagged-union response contract) — the planned `{ status: 'resumed' \| 'already_running' \| 'rejected' }` contract means the UI will branch on the structured status code and render a first-class "already running" UX, not parse an error-string. Spot-fixing the string now would duplicate work and have to be reverted when the contract PR lands. User confirmed: reject. |

### Top themes (finding_type vocabulary)

- reviewer_observation (findings 1, 2, 3, 4 — four explicit validations)
- other (finding 5 — cosmetic SQL clarity)
- other (finding 6 — UX copy, subsumed by deferred contract)

### Verification (round 3)

No files changed in round 3 — both actionable items rejected. No lint / typecheck / test re-run required. HEAD unchanged at `b5b1dbc8` (includes the round-2 finalize commit `4ba038e6` + the subsequent `git merge origin/main` fast-forward of `b5b1dbc8`).

### Decision-source notes

- **Finding 5 — reject as cosmetic, not auto-implement.** Technical finding with a `reject` recommendation is a terminal auto-reject per the playbook; no escalation carveout fires (not architectural, no `[missing-doc]`, no confidence hedge). Logged directly. User confirmation captured for the audit trail regardless.
- **Finding 6 — reject because subsumed by deferred contract.** Technically the reviewer's copy suggestion is valid in isolation. What makes it a reject-not-defer is that the fix it proposes (rewrite a string) would have to be reverted when the tagged-union contract (round-1 finding 3, already on the backlog) replaces the error-parsing pathway entirely. Adding a new durable rule: **do not spot-fix a string if a deferred refactor already replaces the pathway**. See KNOWLEDGE.md check below.

---

## Final Summary

- Rounds: 3
- Auto-accepted (technical): 5 implemented | 6 rejected | 0 deferred
  - Round 1: findings 2, 4, 5, 6, 7 implemented (5 technical auto-implements)
  - Round 2: findings 2, 3 rejected (reviewer no-ops on technical observations)
  - Round 3: findings 1, 2, 3, 4 rejected (four reviewer validations / no-ops)
- User-decided: 2 implemented | 3 rejected | 2 deferred
  - Round 1: finding 1 implemented (user-facing filter bug fix), finding 3 deferred (user-facing architectural)
  - Round 2: finding 5 implemented (user-facing UX sort polish), finding 1 rejected (user-facing no-op reviewer observation), finding 4 deferred (technical escalated via architectural scope signal)
  - Round 3: finding 5 rejected (technical cosmetic — ASC default), finding 6 rejected (user-facing copy subsumed by round-1 deferred contract)
- Index write failures: 0 (clean — finalize pass writes round-3 entries in addition to round-1 + round-2 entries already present)
- Deferred to tasks/todo.md § Deferred from chatgpt-pr-review — PR #185:
  - [user] Resume response contract as tagged union with UI branching (round 1 finding 3)
  - [user] ProcessingStep complexity — extract polling lifecycle to state machine or hook (round 2 finding 4)
  - No new deferrals in round 3.
- Architectural items surfaced to user (user decisions):
  - Round 1 finding 3 — defer (user-approved)
  - Round 2 finding 4 — defer (escalated for architectural scope; user pre-authorised "defer → tasks/todo.md" via round-2 instructions)
  - Round 3 — no architectural items surfaced.
- KNOWLEDGE.md updated:
  - Round 1: yes (4 durable patterns — display-threshold filters, module-load invariants, stale-sweep recovery window, diff empty-string branching)
  - Round 2: yes (1 durable pattern — state-bearing items surface first, complement to round-1 filter rule)
  - Round 3: yes (1 durable pattern — do not spot-fix a string if a deferred refactor already replaces the pathway)
- architecture.md updated: no
- docs/capabilities.md updated: no
- PR: #185 — ready to merge at https://github.com/michaelhazza/michaelhazza/automation-v1/pull/185 (HEAD `b5b1dbc8`)

### Consistency Warnings

None. All decisions across all three rounds are internally consistent:
- Round 2 finding 1 ratifies round-1 finding 3 defer (resume contract).
- Round 2 finding 2 ratifies round-1 finding 2 implementation (centralise server statuses).
- Round 2 finding 3 ratifies round-1 finding 7 implementation (broadened force-expire).
- Round 2 finding 5 builds on round-1 finding 1 (filter + sort on the same derivation).
- Round 3 findings 1 / 2 / 3 / 4 are explicit third-party validations of round-1 and round-2 outputs.
- Round 3 finding 6 respects the round-1 finding 3 deferral boundary: the copy improvement lives inside the deferred tagged-union contract scope, not in a spot-fix commit.

### Deep-pass review observation (operational note, not a KNOWLEDGE.md entry)

ChatGPT's round 3 was framed as a full PR surface re-read, not a delta review. The result — zero new findings, four explicit validations, two optional observations marked "not required" / "polish" — matches the expected "deep-pass after two correctness rounds converges to close" shape. Treat this as a positive signal to finalise, not to open another round. The repeated-finding-on-same-file anchor-on-diff failure mode documented in KNOWLEDGE.md (2026-04-24 ChatGPT hallucinate "duplicate line") is the opposite pattern and did not appear here — the reviewer clearly read HEAD on round 3 (specific lookups for `ORDER BY` and `resumeError` are both accurate against current HEAD).
