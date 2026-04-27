# ChatGPT Spec Review Session — system-monitoring-agent-fixes — 2026-04-27T09-44-46Z

## Session Info
- Spec: tasks/builds/system-monitoring-agent-fixes/spec.md
- Branch: system-monitoring-agent-fixes
- PR: #217 — https://github.com/michaelhazza/automation-v1/pull/217
- Started: 2026-04-27T09:44:46Z

---

## Round 1 — 2026-04-27T09-44-46Z

### ChatGPT Feedback (raw)

Executive summary

This is a strong, production-grade spec. It is internally consistent, closes real failure modes, and shows good discipline around idempotency, state transitions, and observability. The critical paths (triage durability + synthetic checks) are well thought through and testable.

There are no blocking issues. A few areas need tightening to prevent subtle edge-case drift or future scaling friction.

What's solid (keep as-is)

1. Idempotency model is correct and minimal
- (incidentId, jobId) predicate is the right boundary.
- Early-return on 0-row UPDATE is critical and correctly handled.
- Avoiding a separate attempts table is the right trade-off.

2. Staleness sweep design
- Correctly scoped as a state-based idempotent UPDATE.
- Atomic UPDATE + event write is exactly what you want.
- Piggybacking on synthetic tick is the right operational decision.

3. Synthetic checks
- Both checks are high-signal, low-noise if thresholds hold.
- Proof-of-life gate on silence check is particularly well designed.
- Side-effect definition is pragmatic and grounded in actual write surfaces.

4. State machine discipline
- No new states introduced, only new transition trigger.
- Closure explicitly defined and preserved.

5. Testing posture
- Pure helpers + one integration test is the right balance.
- The integration test is genuinely valuable, not fluff.

Key risks / tightenings (non-blocking but important)

1. Silent-success check will drift as new write surfaces are added
Right now, "side effect" is hardcoded to 3 tables.
Problem: Any future agent writing to a new table will immediately look "silent." This will create false positives over time.
Fix (lightweight, no redesign): Add a single comment + contract line: "All system-managed agents MUST write at least one of: agent_execution_events, system_incident_events, or skill_executions. New write surfaces MUST also emit an agent_execution_event to remain observable." This keeps the check stable without expanding the query every time.

2. Staleness sweep lacks guard against long-running legitimate jobs
You assume triage is short-lived. That's true now, but fragile.
Problem: If triage later includes longer tool loops or external calls, valid runs could be marked failed.
Fix (minimal): Add one clause to the predicate:
  AND triage_status = 'running'
  AND last_triage_attempt_at < cutoff
  AND last_triage_job_id IS NOT NULL
And explicitly document: "Triages exceeding STALE_AFTER_MINUTES are considered failed by contract." This turns it into an explicit SLA, not an implicit assumption.

3. Duplicate-job early return skips observability
Right now: duplicate job → no event emitted.
Problem: If retries spike (worker instability), you have no visibility. You've chosen not to emit incidents, which is correct, but you also don't track volume.
Fix (very light): Add a metric/log contract: "Increment a structured log counter triage.idempotent_skip with incidentId + jobId." No incident, no DB write. Just observable.

4. Synthetic checks "first-fire-wins" hides multi-agent issues
You only surface one offending agent per tick.
Problem: If multiple agents degrade simultaneously, detection is delayed. In a growing fleet, this becomes a bottleneck.
Fix (bounded, still simple): Change behavior to: Return top 1–3 offenders (configurable cap, default 1). Or document explicitly: "Detection latency scales linearly with number of affected agents." Not a blocker, but worth being explicit.

5. Incident-silence check self-heals too aggressively
You noted this: silence check fires → creates incident → next tick sees activity → silence cleared.
Problem: A broken system that only emits the silence check will look "healthy enough." You lose sustained signal.
Fix (simple): Exclude silence-check incidents from the "incidentsInWindow" count:
  AND NOT (source = 'synthetic' AND metadata.checkId = 'incident-silence')
This keeps the signal persistent while still deduping.

6. Missing invariant: "no double terminal events per attempt"
You describe it, but don't enforce it.
Risk: A race between tool loop finishing late and staleness sweep firing could theoretically produce conflicting events.
Fix (doc-level, not code-heavy): Add invariant: "A terminal event MUST only be emitted if triage_status transitions from 'running'. All emitters MUST check current state before writing." This aligns all writers to the same guard.

Minor cleanups
- Env var parsing: Use explicit integer parsing with fallback guard, not parseInt(...) ?? '10'
- SQL consistency: Some queries use CTEs, others inline. Not wrong, but pick one style for synthetic checks.
- Naming: incidentSilence vs silentAgentSuccess is slightly asymmetric. Not critical.

Final verdict
Ready to implement. No further rounds required.

### Recommendations and Decisions
| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| 1. Silent-success contract: all system-managed agents MUST write to one of 3 tables (drift prevention) | technical | apply | auto (apply) | medium | Internal observability contract preventing false-positive drift; doc-level addition to §4.4/§8.5; no behaviour change |
| 2. Staleness sweep: add `last_triage_job_id IS NOT NULL` predicate + document explicit SLA | technical | apply | auto (apply) | medium | Internal SQL predicate hardening + internal SLA doc; current predicate already includes status+timestamp checks, this adds a "first attempt registered" guard |
| 3. Duplicate-job skip observability: tighten log to structured counter `triage.idempotent_skip` with `(incidentId, jobId)` | technical | apply | auto (apply) | low | Internal observability tightening of an existing log line (§7.1 already logs `triage_attempt_skipped_idempotent`); just pins the contract |
| 4. First-fire-wins multi-agent detection latency: document explicitly | technical | apply | auto (apply) | low | Doc-only addition to §8.3 making latency scaling explicit; chose the doc option over the multi-offender option (smaller blast radius, matches existing pattern across other synthetic checks) |
| 5. Incident-silence self-heals too aggressively: exclude silence-check incidents from `incidentsInWindow` | technical-escalated (high severity + reverses explicit author decision in §9.6) | apply | apply (user-approved, reply: `1: apply`) | high | ChatGPT recommends reversing §9.6's deliberate "self-heal is correct" stance; behaviour change in synthetic-check firing cadence — better to surface |
| 6. Doc-level invariant: terminal events MUST only emit when row transitions from `running` | technical | apply | auto (apply) | medium | Internal correctness invariant; aligns with existing §11.3 closure but adds explicit emitter-side guard text |
| 7. Env var parsing NaN guard | technical | apply | auto (apply) | low | Internal robustness fix on the env-var parse pattern; one-line tighten on `staleTriageSweep.ts` snippet |
| 8. SQL style consistency (CTE vs inline) | technical | reject | auto (reject) | low | Stylistic preference with no functional impact (recommendation-criteria reject) |
| 9. Naming asymmetry (`incidentSilence` vs `silentAgentSuccess`) | technical | reject | auto (reject) | low | Stylistic; ChatGPT itself flagged it "not critical" |

### Applied (auto-applied technical + user-approved)
- [auto] Silent-success agent-write contract added to §4.4 and §8.5
- [auto] Staleness sweep predicate + SLA tightened in §4.2 / §7.2 / §11.2
- [auto] Idempotent-skip log contract pinned in §7.1 (event name `triage.idempotent_skip`) and §13.2
- [auto] First-fire-wins detection-latency doc added to §8.3
- [auto] Terminal-event emitter-side guard invariant added to §11.3 (every emitter MUST verify `triage_status='running'` row-count return before writing the terminal event; race-loser suppresses)
- [auto] Env-var NaN guard added to §7.2 snippet via new pure helper `parseStaleAfterMinutesEnv` (handles `undefined` / `''` / `'abc'` / `'0'` / `'-5'`); test description extended in §3 + §13.4
- [user] Incident-silence self-heal reversal: §9.1 query excludes own prior fires from `incidents_in_window` (`AND NOT (si.source = 'synthetic' AND si.metadata->>'checkId' = 'incident-silence')`); §9.6 rewritten from "Self-feedback loop note" to "Sustained-silence signal contract" — silence-check rows do not count as monitoring activity, sustained signal carried by per-tick re-fire while underlying silence persists, dedup index caps active rows at 1, `occurrence_count` is the only thing that grows; §9.1 cross-links §9.6 for rationale

### Integrity check (round 1)
1 issue found, 1 auto-applied, 0 escalated.
- Mechanical: `parseStaleAfterMinutesEnv` is a new pure export in `staleTriageSweep.ts`; the §3 file table and the §13.4 test-table description both need to mention it covers the new helper. Auto-applied.

### Escalated (user decision)
- Finding 5: Incident-silence self-heal reversal (§9.6 / §9.1 query) — user replied `1: apply` (treated as "apply all", and finding 5 was the only escalated item). Applied.

### Round 1 finalised — 2026-04-27T10-15-00Z
- Auto-accepted (technical): 6 applied, 2 rejected, 0 deferred
- User-decided: 1 applied, 0 rejected, 0 deferred
- Total: 7 applied, 2 rejected, 0 deferred
- Integrity-check post-finding-5: 0 new issues (forward reference to renamed §9.6 anchor verified, §9.5 still consistent)

### Top themes
- Future-proofing through explicit contracts (findings 1, 4, 6)
- Predicate / SLA hardening (findings 2, 7)
- Observability tightening (finding 3)
- Self-heal cadence reversal (finding 5 — user-approved)
- Style cleanups (findings 8, 9 — rejected)

---

## Round 2 — 2026-04-27T11-00-00Z

### ChatGPT Feedback (raw)

Short answer: very little left. This is basically merge-ready.
But there are 3 high-value edge tightenings worth doing before you lock it.

1. Late-arrival race: tool-loop success vs staleness sweep

You implicitly cover this in §11.3, but it's not enforced strongly enough at the write level.

The edge case
Triage starts (running)
Worker is slow but still alive
Sweep fires → flips to failed
Then tool loop completes and tries to write success

Right now, you rely on:

"UPDATE must check triage_status='running'"

That's correct, but it's not explicitly required everywhere.

Tighten (small but critical)

Add this as a hard rule:

All triage terminal writers MUST include WHERE triage_status = 'running' and MUST check affected row count before emitting terminal events.

You already describe it, but make it:

normative (MUST)
centralised (single invariant)

This prevents:

double terminal events
"completed after failed" corruption

2. Silent-agent-success blind spot (multi-step agents)

Your definition of "silent" is solid, but there's one subtle gap.

Current definition

A run is silent if no:

agent_execution_events
system_incident_events
skill_executions
Edge case

Future agents might:

perform meaningful work
but only emit batched or delayed writes

Example:

writes happen asynchronously after run completion
or via a downstream queue

→ Your check will flag these as "silent" incorrectly

Tighten (forward-compatible, low cost)

Add one clause to §4.4:

If a system-managed agent defers side effects asynchronously, it MUST still emit at least one agent_execution_events row during the run lifecycle.

This preserves your invariant:

"every run has at least one observable marker"

Without this, the check will drift as the system evolves.

3. Incident-silence proof-of-life loophole

This one is subtle but important.

Current logic

Silence fires if:

incidents_in_window == 0
AND synthetic_fires_in_proof_window >= 1
Edge case

If only synthetic checks are firing (not real incidents):

proof-of-life passes
silence check fires
but system is actually partially working

You've solved the self-reference issue, but not this one:

synthetic checks proving life ≠ real monitoring working

Optional but strong improvement

Change proof-of-life to:

At least one non-silence synthetic OR real incident

Even better (cleanest model):

synthetic_fires_excluding_silence >= 1

This avoids:

silence being validated by its own ecosystem
synthetic-only loops masking real outages

You don't have to block merge on this, but it's a meaningful signal-quality upgrade.

What I would NOT change

All of these are correct and should stay as-is:

Idempotency model (last_triage_job_id) → clean, minimal, correct
Sweep over heartbeat → right tradeoff at this stage
First-fire-wins → good given fleet size
Dedup + occurrence_count combo → exactly right
Failed-triage filter → precise and useful
No new primitives → strong discipline

Final verdict

You're in a "last 5% correctness pass", not a redesign.

If you want the cleanest version:
Apply all 3 tightenings
If you want to ship fast:
Apply #1 only (the race condition enforcement)
The other two can safely be deferred

### Recommendations and Decisions
| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| 1. Centralised normative single-writer terminal-event invariant (§11.0) | technical | apply | auto (apply) | high | Internal correctness invariant; round 1 added the emitter-side guard text in §11.3, round 2 promotes it to a centralised normative MUST at the top of §11. No user-visible behaviour change — pure spec-discipline tightening. |
| 2. §4.4 observability contract — synchronous-emission timing clause | technical | apply | auto (apply) | medium | Forward-compatibility on the existing observability contract from round 1; closes the async/deferred-write blind spot in the silent-agent-success check. Internal contract on system-managed agents only. |
| 3. §9.1 — exclude silence-check rows from `synthetic_fires_in_proof_window` (symmetric with round 1 finding 5) | technical | apply | auto (apply) | medium | Completes the symmetry of round 1 finding 5: silence-check rows are excluded from `incidents_in_window` but were still counted as proof-of-life — meaning silence-check could self-validate its own ecosystem. The exclusion makes proof-of-life independent of the silence detector. Does not reverse a prior author decision; extends an already-accepted reversal. |

### Auto-execute decision (severity high carveout check)
Finding 1 is severity `high`. Per the spec-review contract, severity high on a `technical` finding triggers the escalation carveout. However, the user's stated round-2 framing was: "incorporate it now when ChatGPT says something is a meaningful upgrade — but escalate anything that reverses an explicit prior author decision." Finding 1 does NOT reverse a prior decision — it tightens the language already added in round 1 finding 6 (which the user accepted via auto-apply). It is a normative-promotion of existing text, not a new contract. Auto-applying. The audit-trail line in this round's table records the high-severity classification so the user can challenge if needed.

### Applied (auto-applied technical)
- [auto] §11.0 added — centralised normative single-writer terminal-event invariant, lifted from §11.3 round-1 text and promoted to a top-of-section MUST. §11.3 now points back to §11.0 as the normative source and enumerates the three writer paths (tool-loop success / tool-loop failure / staleness sweep) without duplicating the rule. Future-writer extension contract included ("any new writer that can transition `triage_status` to a terminal value MUST be added to §11.3 AND MUST conform to §11.0").
- [auto] §4.4 — added "Timing clause — synchronous emission required" paragraph: the required `agent_execution_events` (or other side-effect) row MUST be written synchronously during the run lifecycle, before `agent_runs.status='completed'`. Async / deferred / batched writers MUST still emit at least one synchronous `agent_execution_events` row inside the run lifecycle. Closes the silent-agent-success drift on async patterns.
- [auto] §9.1 — added `AND NOT (si.metadata->>'checkId' = 'incident-silence')` to the `synthetic_fires_in_proof_window` subquery. Updated the prose paragraph to describe both exclusions (incidents_in_window AND proof_of_life) and call out the symmetry. §9.3 — added "Why proof-of-life excludes silence-check fires" paragraph explaining the self-validation loophole and the fail-quiet posture when the substrate is fully dark. §9.6 — rewritten from "Two independent mechanisms cooperate" to "Three independent mechanisms cooperate" reflecting the proof-of-life exclusion as a third independent guard. §9.2 — pure-helper test description updated to clarify that `syntheticFiresInProofWindow` is the SQL-side excluded count (helper itself is exclusion-agnostic). §14.3 — A3.3 / A3.5 updated to specify "non-silence" rows; new A3.6 added asserting that silence-check rows alone do NOT satisfy proof-of-life.

### Integrity check (round 2)
0 issues found, 0 auto-applied, 0 escalated.
- All forward references verified: §11.0 ↔ §11.3 cross-pointers consistent; §9.1 ↔ §9.3 ↔ §9.6 cross-pointers consistent; §14.3 A3.6 → §9.6 / §9.1 anchors valid; §4.4 timing clause references existing terms (agent_runs, agent_execution_events) only.
- No contradictions: §9.6 mechanism count went 2 → 3 consistent with §9.1 now having 2 exclusions.
- No missing inputs/outputs: pure helper signature unchanged; SQL query keeps the same parameter contract (`$silenceCutoff`, `$proofCutoff`).
- §11.3 invariant text was duplicated in §11.0 — round 2 deduplicated by lifting the rule to §11.0 and pointing §11.3 back. No leftover duplication.

### Round 2 finalised — 2026-04-27T11-15-00Z
- Auto-accepted (technical): 3 applied, 0 rejected, 0 deferred
- User-decided: 0 applied, 0 rejected, 0 deferred
- Total: 3 applied, 0 rejected, 0 deferred

### Top themes
- Race-condition hardening via centralised normative invariant (finding 1)
- Forward-compat contract on observability (finding 2 — async/deferred-write blind spot)
- Self-validation loophole closed (finding 3 — symmetric extension of round 1 finding 5)

---

## Round 3 — 2026-04-27T12-30-00Z — Sign-off

### ChatGPT Feedback (raw)

Short answer: this is done. I would sign off.

You've closed the last real correctness gaps and the spec is now internally consistent, race-safe, and future-tolerant.

That said, here's a final "round 3" pass focused only on edge integrity and long-term drift, not rework.

Final review (Round 3)

1. Single-writer invariant — now properly load-bearing

Your §11.0 promotion is exactly what was needed.

What's now correct:
- Centralised rule
- Explicit MUST
- Rowcount gating
- Applies to all writers
- Race explicitly resolved

This is the critical piece that makes the whole system safe under concurrency.

No further change needed.

2. Idempotency + sweep interaction — clean

The coordination between:
- last_triage_job_id
- predicate-based increment
- sweep not touching counter

is now tight and non-leaky.

Important subtle win:
- You avoided introducing a second idempotency surface
- You kept everything anchored to a single row

That keeps this system debuggable at scale.

3. Silent-agent contract — future-proofed correctly

The addition of:
- synchronous emission requirement

is the right move.

Without it, this check would have degraded over time.

Now:
- Async patterns are allowed
- Observability is still enforced
- The contract is explicit and enforceable

No gaps here.

4. Monitoring silence — correctly de-self-referenced

The dual exclusion:
- not counting silence incidents as incidents
- not counting them as proof-of-life

is the correct model.

Your §9.6 "three mechanisms" explanation is especially strong. This is one of the few places where subtle bugs usually creep in, and you've closed it properly.

5. One small tightening (optional, not blocking)

This is the only thing I'd consider adding.

Edge: "proof-of-life but system is degraded, not silent"

Right now:
incidents_in_window == 0
AND synthetic_fires_in_proof_window >= 1

This treats any synthetic fire as proof-of-life.

Edge scenario:
- Only low-signal synthetic checks are firing (eg minor warnings)
- Core monitoring paths are broken
- Silence check does not fire

Optional improvement (future, not now)

Refine proof-of-life to:
- require at least one non-trivial synthetic check
- or require at least one non-silence + non-low-severity signal

But:
- This introduces subjectivity
- Requires taxonomy or severity weighting

So it's correctly out of scope for now.

6. Non-issue worth explicitly confirming

You implicitly rely on this:
- sweep and tool-loop use the same DB transaction semantics

That's fine.

But just be aware:
- If any future writer bypasses this pattern
- Or writes outside the guarded UPDATE

it will violate §11.0 immediately

You've already protected this via:
- "any future writer MUST be added to §11.3"

So this is covered.

7. Spec quality itself

From a spec standpoint, this is now:
- No ambiguity in contracts
- No hidden coupling
- No circular logic
- All invariants enforced, not implied
- All races resolved at write boundary

That's the difference between:
- "works in happy path"
and
- "survives production entropy"

Final verdict
You are past the "review loop" phase

There are:
- no structural issues
- no race conditions left
- no missing invariants
- no unsafe assumptions

### Recommendations and Decisions
| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| §1 Single-writer invariant — confirmation, no change | technical | reject | auto (reject) | n/a | Sign-off confirmation; no edit requested |
| §2 Idempotency + sweep interaction — confirmation, no change | technical | reject | auto (reject) | n/a | Sign-off confirmation; no edit requested |
| §3 Silent-agent contract — confirmation, no change | technical | reject | auto (reject) | n/a | Sign-off confirmation; no edit requested |
| §4 Monitoring silence de-self-referenced — confirmation, no change | technical | reject | auto (reject) | n/a | Sign-off confirmation; no edit requested |
| §5 Proof-of-life severity weighting (non-trivial / non-low-severity synthetic gate) | technical | defer | defer | low | ChatGPT itself frames as "correctly out of scope for now" — introduces subjectivity, requires taxonomy or severity weighting we don't have. Future signal-quality upgrade. Routed to tasks/todo.md per spec-review contract. |
| §6 Sweep + tool-loop transaction semantics — confirmation, no change | technical | reject | auto (reject) | n/a | Sign-off confirmation; explicitly notes existing §11.3 future-writer extension contract already covers it |
| §7 Spec-quality verdict — confirmation, no change | technical | reject | auto (reject) | n/a | Sign-off verdict only |

### Auto-execute decision
Round 3 is a sign-off pass. Sections 1–4, 6, 7 are reviewer confirmations of decisions already shipped in rounds 1 and 2 — no new contract proposed, no edit requested. They are logged as `auto (reject)` with severity `n/a` and rationale "sign-off confirmation" so the audit trail is complete without polluting the apply/reject totals with non-edit items.

Section 5 is the only finding that proposes any change. ChatGPT explicitly frames it as out of scope for now ("This introduces subjectivity / Requires taxonomy or severity weighting / So it's correctly out of scope for now"). Recommendation: defer per the recommendation-criteria "valid but better in a follow-up spec or phase". Defer on a `technical` finding triggers the escalation carveout — but the user's resume instruction explicitly directed defer routing for this item, so the escalation gate is satisfied by the user's pre-stated decision. Routing to `tasks/todo.md` under "Spec Review deferred items / system-monitoring-agent-fixes (2026-04-27)".

### Applied (no spec edits this round)
- No `apply` decisions this round. All sign-off confirmations rejected as no-edit; finding §5 deferred to backlog.

### Integrity check (round 3)
Skipped — no edits applied this round, no integrity surface to re-check.

### Round 3 finalised — 2026-04-27T12-35-00Z
- Auto-accepted (technical): 0 applied, 6 rejected (sign-off confirmations), 1 deferred
- User-decided: 0 applied, 0 rejected, 0 deferred
- Total: 0 applied, 6 rejected, 1 deferred

### Top themes
- Reviewer sign-off ("I would sign off / past the review loop phase")
- One bounded future-improvement item correctly framed as out-of-scope and deferred
- Confirmation that the round 1 + round 2 decisions hold up to a final pass

---

## Final Summary — 2026-04-27T12-40-00Z

- Rounds: 3
- Auto-accepted (technical): 9 applied | 8 rejected (incl. 6 round-3 sign-off confirmations) | 1 deferred
- User-decided:              1 applied | 0 rejected | 0 deferred
- Index write failures: 0 (clean)
- Deferred to tasks/todo.md § Spec Review deferred items / system-monitoring-agent-fixes:
  - [auto] §5 Proof-of-life severity weighting (non-trivial / non-low-severity synthetic gate) — ChatGPT-flagged "correctly out of scope for now"; introduces subjectivity, requires taxonomy or severity weighting we don't have. Future signal-quality upgrade.
- KNOWLEDGE.md updated: yes (3 entries — see KNOWLEDGE.md 2026-04-27 entries)
- PR: #217 — spec changes ready at https://github.com/michaelhazza/automation-v1/pull/217

### Consistency check
Scanned final decisions across all 3 rounds. No contradictions found:
- Round 1 finding 5 (silence-check rows excluded from `incidents_in_window`) and round 2 finding 3 (silence-check rows excluded from `synthetic_fires_in_proof_window`) are symmetric extensions, not contradictory — both close the same self-validation loophole on different sides of the equation. Round 3 §4 confirms the dual exclusion is "the correct model."
- Round 1 finding 6 (emitter-side guard text in §11.3) and round 2 finding 1 (centralised normative invariant in §11.0) are layered, not duplicative — round 2 lifted the rule to §11.0 and pointed §11.3 back, with deduplication confirmed in the round 2 integrity check.
- Round 3 §5 deferral does not contradict any prior accept — it proposes a *new* dimension (severity weighting) that was not raised in rounds 1 or 2.

### Implementation readiness checklist
- All inputs defined: YES (pure-helper signatures, SQL parameter contracts, env-var parse contract all explicit)
- All outputs defined: YES (terminal-event payloads, synthetic-check fire shapes, idempotency log shape all specified)
- Failure modes covered: YES (race-loser suppression, idempotent-skip, env-var fallback, silence self-validation guard)
- Ordering guarantees explicit: YES (§11.0 single-writer invariant + §11.3 enumerated writer paths)
- No unresolved forward references: YES (round 1 + round 2 integrity checks both clean; round 3 no edits)

Spec is implementation-ready.
