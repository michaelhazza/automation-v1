# ChatGPT Spec Review Session — subaccount-optimiser — 2026-05-01T23-47-38Z

## Session Info
- Spec: docs/sub-account-optimiser-spec.md
- Branch: claude/evaluate-new-features-waqfY
- PR: #250 — https://github.com/michaelhazza/automation-v1/pull/250
- Mode: manual
- Started: 2026-05-01T23:47:38Z

---

## Round 1 — 2026-05-01T23:47:38Z

### ChatGPT Feedback (raw)

```
Executive summary

This is a strong, well-structured spec. The biggest win is the decision to build a generic recommendation primitive rather than a one-off feature. The architecture is coherent, idempotent, and aligns well with your existing agent and telemetry patterns.

What's left isn't structural. It's about tightening a few edge-case behaviours, consistency rules, and operational safeguards that will matter at scale. No blockers, but a handful of gaps worth closing before build.

1. High-impact gaps (worth fixing before build)

1.1 Recommendation churn and "flapping"
You've defined evidence_hash → update-in-place, which is good, but you're missing stability thresholds.
Right now: any numeric change → new hash → re-render → re-surface
That creates noise for metrics that fluctuate daily (costs, latency, cache tokens).
Fix: Add a per-category "material change threshold" before allowing update-in-place:
- Budget: change ≥ 10%
- Latency: ratio delta ≥ 20%
- Rates (escalation, uncertainty): ≥ 10 percentage points
If below threshold: treat as no-op, even if hash changes. This prevents recommendation churn.

1.2 No "cooldown" after dismiss
Current behaviour: dismiss frees dedupe slot; next run can recreate immediately. That's going to annoy operators.
Fix: Add soft cooldown:
- Add dismissed_until TIMESTAMPTZ
- Default: now + 7 days
- output.recommend ignores matches during cooldown
Optional: vary by severity (critical: 1–2 days; warn/info: 7–14 days)

1.3 Cap behaviour is correct but suboptimal
You cap at 10 per (scope, producing_agent) which is good. But: lower-priority items are silently dropped; no visibility into what got excluded.
Fix: Add lightweight overflow tracking:
- In-memory or log-only list of dropped candidates
- Emit debug metric: recommendations.dropped_due_to_cap
Optional future: store overflow in a separate non-surfaced table

1.4 Missing prioritisation consistency across runs
You define sorting before insert, but not across time.
Edge case: Day 1 — 10 items inserted; Day 2 — new critical item appears; cap blocks it because old low-priority items still occupy slots.
Fix: When cap reached, compare new candidate vs lowest-priority existing open rec; if higher priority → replace lowest. This keeps surface high-signal.

1.5 Org rollup could get noisy fast
includeDescendantSubaccounts=true will scale poorly visually once 20+ subaccounts each with multiple recs. Even with top-3, you risk multiple rows from same subaccount dominating.
Fix (minimal): In collapsed mode, enforce max 1 per subaccount in top 3. Keeps it representative instead of clustered.

2. Medium-level design improvements

2.1 Evidence schema consistency
evidence is flexible JSONB, but you don't enforce structure. Risk: inconsistent keys across evaluators; brittle downstream usage.
Fix: Define per-category evidence schemas (lightweight contract). Example:
type AgentOverBudgetEvidence = { agent_id: string; this_month: number; last_month: number; budget: number }
No DB constraint needed, just shared types.

2.2 Render caching needs versioning
You cache render output by (category, dedupe_key, evidence_hash). Missing: prompt versioning. If you tweak prompt → stale copy persists.
Fix: Add render_version (string or number); included in cache key.

2.3 Routing uncertainty metric could mislead
Current trigger: confidence < 0.5 OR secondLook > 30%. Problem: not tied to outcome quality.
You already have downstreamOutcome.
Fix: Refine trigger: low confidence + bad outcome rate, OR high secondLook + low improvement. Otherwise you'll flag healthy "cautious" agents.

2.4 Cache efficiency heuristic is too naive
Current: creation tokens > reused tokens. Problem: doesn't account for cache lifecycle, prefix reuse timing.
Better signal: reuse ratio over time window or reuse per prefixHash. At minimum: add guard — minimum volume threshold before firing.

3. Execution & infra observations

3.1 Schedule staggering is good but incomplete
You stagger by created_at hash → good. Missing: rebalancing when many new subaccounts added at once.
Not a blocker, but consider: periodic redistribution job (future).

3.2 Materialised view refresh timing
Nightly refresh is fine, but: optimiser runs at 06:00 local; view might be stale depending on timezone.
Fix: Document explicitly — refresh must complete before earliest run window. Or: tolerate staleness (likely fine).

3.3 Advisory lock scope is correct
Good use of pg_advisory_xact_lock(hashtext(...)). No issues here. This is solid.

4. UI / product clarity tweaks

4.1 "Help me fix this →" should imply state change
You already auto-acknowledge on click. Good.
Add: subtle UI feedback (toast or disappearance). Otherwise it feels inconsistent.

4.2 No empty state is correct, but…
Edge case: user expects section but it disappears.
Consider: show section after first-ever appearance; then hide only if previously had content.
Not required, just UX polish.

5. Things that are particularly well done
- Generic agent_recommendations primitive
- Clear separation of scan → evaluate → render → write
- Idempotency model is clean and consistent
- Evidence-hash driven updates is the right pattern
- Advisory lock usage avoids race conditions properly
- Scope model (org vs subaccount) is future-proof
- UI restraint (no overbuilding dashboards) is exactly right

Final verdict: No structural issues. This is ready to build.
If you apply anything before implementation, prioritise:
1. Flapping control (material change thresholds)
2. Dismiss cooldown
3. Cap replacement logic (not just blocking)
Everything else can be layered post-release.
```

Inferred verdict: APPROVED (explicit "No structural issues. This is ready to build.").

### Recommendations and Decisions

| ID | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|----|---------|--------|----------------|----------------|----------|-----------|
| F1 | 1.1 Material-change thresholds before re-surfacing (flapping) | user-facing | apply | apply (user: as recommended) | high | Real noise risk — current spec re-surfaces on any numeric delta. |
| F2 | 1.2 Dismiss cooldown (`dismissed_until`, default 7d, severity-tiered) | user-facing | apply | apply (user: as recommended) | high | Without cooldown, dismissing frees the dedupe slot and the next run recreates the row immediately. |
| F3 | 1.3 Cap-overflow observability (drop log + tagged-log-as-metric) | technical | apply | auto (apply) | medium | Internal observability — tagged-log-as-metric per KNOWLEDGE.md. |
| F4 | 1.4 Cap replacement when full (swap lowest-priority for higher arrival) | user-facing | apply | apply (user: as recommended) | high | Correctness gap — `critical` arrivals silently dropped while `info` items hold slots. |
| F5 | 1.5 Org-rollup top-3: max 1 per subaccount in collapsed mode | user-facing | apply | apply (user: as recommended) | medium | Prevents one noisy subaccount dominating cross-client top-3. |
| F6 | 2.1 Per-category evidence TypeScript types in `shared/types/` | technical | apply | auto (apply) | medium | Internal contract — no runtime cost, prevents schema drift. |
| F7 | 2.2 `render_version` in render-cache key | technical | apply | auto (apply) | medium | Prevents stale copy when prompts change. |
| F8 | 2.3 Routing-uncertainty trigger refinement (tie to `downstreamOutcome`) | user-facing | defer | defer (user: as recommended) | medium | Refined heuristic needs baseline outcome-quality data — ship simpler v1 trigger, measure, refine. Routed to tasks/todo.md. |
| F9 | 2.4 Cache-efficiency minimum-volume threshold | technical | apply | auto (apply) | medium | Defensive noise guard for low-volume agents. |
| F10 | 3.1 Periodic schedule-rebalancing job (when many subaccounts added at once) | technical-escalated (defer) | defer | defer (user: as recommended) | low | Future scale concern — hash-staggering handles steady state. Routed to tasks/todo.md. |
| F11 | 3.2 Document materialised-view refresh timing relative to 06:00 local optimiser run | technical | apply | auto (apply) | low | Doc-only clarification of an already-correct design. |
| F12 | 3.3 Advisory lock confirmation (no finding) | — | — | n/a | — | ChatGPT confirmed the pattern is correct; not a finding. |
| F13 | 4.1 Subtle UI feedback when "Help me fix this →" auto-acknowledges | user-facing | apply | apply (user: as recommended) | low | Without feedback, the row's disappearance feels uncaused. |
| F14 | 4.2 Empty-state UX: show after first appearance, then hide only if previously had content | user-facing | defer | defer (user: as recommended) | low | Stateful empty-state introduces UX state that needs design pass. Routed to tasks/todo.md. |
| I1 | Integrity: `Evidence hash` paragraph contradicts new `materialDelta` gate | technical (integrity) | apply | auto (apply) | medium | Old paragraph said hash change always triggers update-in-place + acknowledged_at clear; new bullets gate on `materialDelta`. |
| I2 | Integrity: `Pre-write candidate ordering` claims producer-side sort required for "deterministic cap-eviction" | technical (integrity) | apply | auto (apply) | medium | Eviction is now executor-side and priority-aware regardless of producer order — sorting is an optimisation, not a correctness requirement. |
| I3 | Integrity: `Idempotency posture` implies all races resolve via 23505 | technical (integrity) | apply | auto (apply) | medium | Same-`producing_agent_id` races are serialised by advisory lock + `FOR UPDATE`; 23505 is now a cross-`producing_agent_id` fallback only. |

**Summary counts (Round 1):**
- Auto-accepted (technical): 5 ChatGPT + 3 integrity-check = 8 applied, 0 rejected, 0 deferred
- User-decided: 5 applied (F1/F2/F4/F5/F13), 0 rejected, 3 deferred (F8/F10/F14)
- Not a finding: F12

### Applied (auto-applied technical + user-approved user-facing)

**Spec edits (`docs/sub-account-optimiser-spec.md`):**
- [auto] §2 — render-cache key extended with `render_version`; explanatory paragraph on bump policy added
- [auto] §2 — `llm.cache_poor_reuse` trigger gains volume-floor noise guard (≥5000 cache tokens in window)
- [user] §2 — new "Material-change thresholds" subsection with per-category `materialDelta` predicate table for all 8 categories
- [auto] §3 — explicit refresh-timing rationale for `optimiser_skill_peer_medians` (pg-boss job at 00:00 UTC; staleness window acceptable for 7-day-aggregate medians)
- [user] §6.1 — `dismissed_until TIMESTAMPTZ` column added to `agent_recommendations`; new `agent_recommendations_dismissed_active_cooldown` index; documented why partial-unique index can't widen to reference `now()` (Postgres IMMUTABLE constraint)
- [user] §6.2 — output union extended to `'cap_reached' | 'cooldown' | 'updated_in_place' | 'sub_threshold' | 'evicted_lower_priority'`; six-case bullet list rewritten; new "Decision flow + advisory lock" subsection with explicit five-step ordering inside the lock
- [auto] §6.2 — `Evidence hash` paragraph reconciled with `materialDelta` (I1)
- [auto] §6.2 — `Pre-write candidate ordering` softened from MUST to SHOULD (I2)
- [auto] §6.2 — `Idempotency posture` clarified for advisory-lock vs unique-index race paths (I3)
- [user] §6.3 — new `collapsedDistinctScopeId` prop; "Org-rollup collapsed-mode dedupe" subsection
- [auto] §6.5 — new "Per-category evidence shapes" subsection with discriminated-union TypeScript excerpt
- [user] §6.5 — dismiss endpoint contract extended with `cooldown_hours?` body param (admin-only, clamped 1h-90d), per-severity defaults (24h/168h/336h), `dismissed_until` field in response
- [user] §6.5 — CTE update for dismiss path now sets `dismissed_until` atomically with `dismissed_at`
- [user] §6.5 — new "Click feedback before navigation" subsection (250ms beat with "Marked as resolved" inline replacement before navigation; parallel fire-and-forget POST)
- [user] §7 — section content note on collapsed-mode org-rollup dedupe
- [auto] §9 Phase 0 — added `shared/types/agentRecommendations.ts`, `server/services/optimiser/renderVersion.ts`, `server/services/agentRecommendationsService.ts`, expanded test list
- [auto] §10 — primitive files-touched list expanded with 3 new server files + 1 shared types file; client component note updated
- [user] §13 — Recommendation noise risk-mitigation block expanded with priority-aware eviction, material thresholds, dismiss cooldown, drop-log convention
- [user] Deferred Items section — appended F8 (routing-uncertainty refinement), F10 (schedule rebalancing), F14 (stateful empty-state UX) with reconsider-per-trigger reasons

**`tasks/todo.md`:**
- [user] New `### subaccount-optimiser (2026-05-02)` subheading under `## Spec Review deferred items` with three deferred entries (F8, F10, F14) tagged `[user]`

### Integrity check

Integrity check: 3 issues found this round (auto: 3, escalated: 0). Post-integrity sanity confirmed: no broken references, no empty sections, all cross-section identifiers (`materialDelta`, `evicted_by_higher_priority`, `evicted_lower_priority`, `dismissed_until`, `collapsedDistinctScopeId`) appear consistently across §2 / §6.1 / §6.2 / §6.3 / §6.5 / §7 / §9 / §10 / §13 / Deferred Items.

### Top themes

- **Lifecycle hardening dominates Round 1.** F1 + F2 + F4 together rebuild the recommendation lifecycle: how findings enter (cap eviction), persist (material thresholds), and leave (dismiss cooldown). Pre-Round-1 the spec had a clean dedupe + update-in-place but no soak-time, no priority replacement, and no cooldown. Post-Round-1 the lifecycle has all three.
- **The "default-to-user-facing on ambiguity" rule did real work.** Five of seven applied user-facing findings touched behaviour an operator could perceive (re-surfacing rules, dismiss cooldown, top-3 ordering, click feedback, eviction visibility). One borderline call (F4 cap replacement) went user-facing under the rule and the user approved.
- **Integrity check found three contradictions, all introduced by the same edit.** Rewriting §6.2 to add `materialDelta` left the surrounding paragraphs (`Evidence hash`, `Pre-write candidate ordering`, `Idempotency posture`) stating contradicting old behaviour. All three auto-resolved as mechanical fixes.

### Round 1 status

Round 1 complete. Spec grew from 681 → 776 lines (+95). Five user-facing applies, three user-facing defers, eight technical auto-applies (5 ChatGPT + 3 integrity).

---

## Round 2 — 2026-05-02T00-12-00Z

### ChatGPT Feedback (raw)

```
Executive summary
This is now a tight, production-ready spec. You've closed the major failure modes from the first round:
- Flapping → solved with material thresholds
- Reappearance spam → solved with cooldown
- Cap starvation → solved with eviction
- Org noise → solved with collapsed dedupe
- Render staleness → solved with render_version
At this point, there are no structural gaps. What remains are a few edge-case correctness and long-term scaling tweaks. None are blockers.

What you fixed well (important)
- Material-change predicates are exactly what was missing.
- Cooldown with severity weighting is correct and pragmatic.
- Priority-based eviction inside the executor is the right call. This avoids producer-order dependency.
- Render versioning closes a subtle but real production issue.
- Collapsed dedupe by subaccount fixes the rollup UX properly.

Remaining gaps (small but worth tightening)

1. Eviction + cooldown interaction edge case
Right now eviction sets dismissed_at=now(), dismissed_until=NULL.
That's intentional, but introduces oscillation: low-priority rec evicted → next run produces it again → reappears immediately. This creates oscillation under pressure when the system is near cap.
Fix (minimal): introduce a short implicit cooldown for eviction (6-12 hours).

2. Material thresholds missing absolute floor
Current relative threshold like abs(delta)/max(prev,1) fails when values are small (noise becomes proportionally large). 100→110=10% fires but absolute change trivial.
Fix: add dual condition — relative AND minimum absolute delta. cost ≥ 10% AND ≥ $10 equivalent; latency ≥ 20% AND ≥ 200ms; rates ≥ 10pp AND ≥ 3 events change.

3. Cap eviction fairness across categories
Current priority tuple severity → category → dedupe_key makes category ordering arbitrary bias; some categories may dominate long-term.
Fix (lightweight): when selecting eviction candidate, prefer evicting same category as incoming first; fallback to global lowest priority. Keeps category mix healthier.

4. Cooldown bypass via evidence change
Cooldown blocks insertion regardless of evidence. But what if situation becomes much worse during cooldown? Dismissed "slightly over budget" → now 3× over budget → still suppressed.
Fix: if new severity > previous severity OR delta exceeds critical override threshold, ignore cooldown and insert.

5. Routing uncertainty still not outcome-aware
You've deferred it. Right now it will still flag cautious but effective agents. When you revisit, incorporate downstreamOutcome.

6. Log-only drop visibility is good, but incomplete
recommendations.dropped_due_to_cap is good. But for debugging you'll want eviction info too.
Add for eviction path: recommendations.evicted_lower_priority with evicted category, incoming category, priority comparison.

7. Evidence schema versioning (minor future-proofing)
Strong typing is good. Missing: versioning of evidence shape. If you ever change shape, hashes change, unintended re-surfacing.
Fix (lightweight): add optional evidence_version: number; include in hash input. Not urgent.

Things you should NOT change
Resist the urge to add more categories now / auto-fix flows / notifications / further generalise the UI. You've hit the right level of scope.

Final verdict: Architecturally sound, operationally stable, UX-aware, scalable without rework. No blockers. You can build this confidently.
```

Inferred verdict: APPROVED (explicit "No blockers. You can build this confidently.").

### Recommendations and Decisions

| ID | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|----|---------|--------|----------------|----------------|----------|-----------|
| R2-F1 | Eviction sets `dismissed_until=NULL` → low-priority can oscillate under pressure. Add 6-12h implicit cooldown on eviction. | user-facing | apply | _pending user_ | high | Real edge case in steady-state-near-cap. Cheap fix — set `dismissed_until=now()+6h` on eviction path. |
| R2-F2 | Material thresholds need absolute floors (not just relative). | user-facing | apply | _pending user_ | high | Without floors, 100→110 (10%) fires the same as 1000→1100 (10%). Define: cost ≥ $10, latency ≥ 200ms, rates ≥ 3-event count change. |
| R2-F3 | Cap eviction has implicit category bias. Add diversity preference (evict same-category-as-incoming first). | user-facing | defer | _pending user_ | medium | Diversity rule has correctness risks (could evict critical-of-same-category over info-of-different-category). Defer until production data shows actual dominance. |
| R2-F4 | Cooldown can suppress severity-escalating findings. Allow bypass when new severity > previous severity. | user-facing | apply | _pending user_ | high | Failure mode: dismissed "slightly over" stays suppressed when situation becomes 3× worse. Stored "previous severity" available on dismissed row. |
| R2-F5 | Routing uncertainty signal still not outcome-aware (reaffirmation of R1-F8). | — | — | n/a | — | Same finding as R1-F8, already deferred. No new decision. |
| R2-F6 | Eviction event log incomplete — add `recommendations.evicted_lower_priority` structured log with evicted/incoming details. | technical | apply | auto (apply) | low | Internal observability — sister convention to `recommendations.dropped_due_to_cap` shipped in Round 1. |
| R2-F7 | Add `evidence_version` to hash input for future shape-evolution safety. | technical-escalated (defer) | defer | _pending user_ | low | "Not urgent, but clean" per ChatGPT. `render_version` already covers prompt changes. Escalated because recommendation is `defer`. |

**Summary counts (Round 2):**
- Auto-applied (technical): 1 ChatGPT (R2-F6) + 1 integrity (test-list update for new lifecycle paths) = 2 applied, 0 rejected, 0 deferred
- User-decided: 3 applied (R2-F1, R2-F2, R2-F4), 0 rejected, 2 deferred (R2-F3, R2-F7) — user replied "as recommended"
- No new decision (Round 1 carry-over): R2-F5

### Decisions and Resolutions (post user reply)

| ID | Final Decision |
|----|----------------|
| R2-F1 | apply (user: as recommended) — eviction implicit 6h cooldown |
| R2-F2 | apply (user: as recommended) — relative+absolute threshold floors across all 6 numeric predicates |
| R2-F3 | defer (user: as recommended) — diversity bias has hidden correctness risks; routed to tasks/todo.md |
| R2-F4 | apply (user: as recommended) — severity-escalation bypass on cooldown |
| R2-F5 | n/a — Round 1 deferral re-affirmed; consistency check confirms no contradiction |
| R2-F6 | auto (apply) — `recommendations.evicted_lower_priority` structured log on eviction |
| R2-F7 | defer (user: as recommended) — `evidence_version` is forward-compat insurance against a shape change that hasn't happened; routed to tasks/todo.md |

### Applied (auto-applied technical + user-approved user-facing)

**Spec edits (`docs/sub-account-optimiser-spec.md`):**
- [user] §2 Material-change thresholds — six numeric predicates rewritten with dual-condition (relative AND absolute) floors. New predicates:
  - `agent.over_budget`: 10% AND ≥ 1000 cents ($10) absolute change
  - `playbook.escalation_rate`: 10pp rate change AND ≥ 3 escalation-count change
  - `skill.slow`: 20% ratio change AND ≥ 200ms absolute p95 change
  - `memory.low_citation_waste`: 10pp rate change AND volume floor (`total_injected >= 10`) AND ≥ 3 volume change
  - `agent.routing_uncertainty`: 10pp rate change AND volume floor (`total_decisions >= 10`) AND ≥ 3 volume change
  - `llm.cache_poor_reuse`: 20% relative AND ≥ 1000 token absolute change
  Categories with naturally absolute predicates (`inactive.workflow`, `escalation.repeat_phrase`) unchanged.
- [user] §5 — `optimiser.scan_routing_uncertainty` return-shape now includes `total_decisions` for the volume floor.
- [user] §6.5 — `AgentRoutingUncertaintyEvidence` evidence type extended with `total_decisions: number`.
- [user] §6.2 Decision flow step 1 (cooldown) — severity-escalation bypass added: if `severity_rank(new) > severity_rank(matched_row)`, cooldown is ignored and the candidate falls through to insert as a fresh finding.
- [user] §6.2 Decision flow step 4 (eviction) — evicted row now carries `dismissed_until=now() + interval '6 hours'` (was `NULL`); eviction emits `recommendations.evicted_lower_priority` structured log with full displacement context.
- [user] §6.2 Output union bullets — `evicted_lower_priority` and `cooldown` bullets reconciled with new behaviours (6h implicit cooldown on evict; severity bypass on dismiss-cooldown).
- [auto] §6.2 Eviction step now emits `recommendations.evicted_lower_priority` log with `{evicted_recommendation_id, evicted_category, evicted_severity, evicted_dedupe_key, incoming_category, incoming_severity, incoming_dedupe_key}` (R2-F6).
- [user] §13 risks — Recommendation noise mitigation block expanded with 6h eviction cooldown, dual-condition thresholds (relative + absolute floors), severity-escalation bypass, and `recommendations.evicted_lower_priority` log line.
- [user] Deferred Items section — appended R2-F3 (cap-eviction diversity bias) and R2-F7 (evidence_version) with reconsider-per-trigger reasons.
- [auto] §9 Phase 0 test list — updated to cover new lifecycle paths (relative/absolute/volume floor variants, eviction implicit cooldown, severity-escalation bypass).

**`tasks/todo.md`:**
- [user] Two new entries appended to `### subaccount-optimiser (2026-05-02)`: R2-F3 and R2-F7 (both `[user]`-tagged).

### Integrity check

Integrity check: 1 issue found this round (auto: 1, escalated: 0). The §9 Phase 0 test list mentioned dismiss cooldown but didn't cover the new severity-escalation bypass or eviction implicit cooldown paths — auto-extended. Post-integrity sanity confirmed: `total_decisions` consistent across §2 / §5 / §6.5; `severity_rank(...)` referenced consistently in §6.2 step 1 + cooldown bullet; eviction 6h cooldown referenced consistently in step 4 + `evicted_lower_priority` bullet + cooldown bullet + §13 risks.

### Top themes

- **Round 2 closes the lifecycle loopholes Round 1 introduced.** Round 1 added eviction with `dismissed_until=NULL` (oscillation risk) and severity-blind cooldown (priority-suppression risk). Round 2 closes both: 6h implicit cooldown on eviction prevents oscillation; severity-escalation bypass prevents critical findings from being suppressed by a stale dismiss.
- **Absolute floors complete the noise-suppression story.** Round 1 added relative-only `materialDelta` predicates. Round 2 surfaces the small-value failure mode (`$5 → $5.50` = 10% but trivial) and pairs every relative threshold with an absolute floor. Two of the rate-based predicates additionally need a supporting-count floor — for routing_uncertainty this required adding `total_decisions` to the evidence shape, which propagated through §5, §6.5, and §2.
- **R2-F3 defer is the cleanest call of the round.** "Diversity bias on eviction" sounds appealing but the simple form has hidden correctness costs (could evict critical-of-same-category over info-of-different-category). The deferred entry captures the correctness shape that future work needs to satisfy ("prefer same-category at-or-below incoming severity") so reviving the idea later doesn't have to rediscover the trap.
- **R2-F5 was correctly handled as a re-affirmation, not a re-decision.** ChatGPT's "still not outcome-aware" comment about routing uncertainty was already a Round 1 deferral. Treating it as a new decision would have created false noise in the consistency check at finalisation.

### Round 2 status

Round 2 complete. Spec grew from 776 → 783 lines (+7 net — most edits were in-place tightening, not section additions). Three user-facing applies, two user-facing defers, two technical auto-applies (1 ChatGPT + 1 integrity).

---

## Round 3 — 2026-05-02T00-30-00Z

### ChatGPT Feedback (raw)

```
Executive summary
You're effectively done. This is implementation-ready at production standard.
The remaining gaps are now micro-level edge conditions, future-proofing, and observability polish. No blockers, no structural risks.
Below is the final sweep. If you address these, you're at "nothing left to bite you later".

Final micro-gaps (last 5%)

1. Ordering stability under identical priority
Eviction + sort tuple is severity → category → dedupe_key. Deterministic, but not time-aware. Edge case: two equal-priority recs, older might persist forever while newer ones churn.
Fix: append → updated_at ASC for eviction (prefer stalest) and updated_at DESC for display (still shows freshest). Prevents long-lived stale recs clogging the cap.

2. Evidence hash canonicalisation risk
sha256(canonical_json(evidence)) is good, but hidden risk: numeric normalization. {"cost": 1000} vs {"cost": 1000.0} can hash differently depending on serializer.
Fix: enforce integers for currency (already true), fixed precision for floats (e.g. 4dp), OR stringify via strict encoder before hashing. Otherwise phantom updated_in_place.

3. Acknowledge reset logic edge case
updated_in_place clears acknowledged_at — correct. But small-but-material oscillations (just over threshold) could let user keep seeing same issue reappear.
Optional refinement: only clear acknowledged_at if severity increased OR delta > 2× threshold. Prevents borderline churn from resurfacing too aggressively. Not required now.

4. Cap fairness across agents (future)
Per-agent cap is correct. Longer-term, more agents writing to same surface → fragmented UI across producers.
Future consideration (not now): soft global cap per scope (20-30) on top of per-agent cap. Just flagging for later scaling.

5. Query cost guardrails (important at scale)
Heavy scans (memory_citation_scores, fast_path_decisions, agent_execution_events). All 7-day windows. Missing: explicit scan bounding or indexing callouts.
Add: composite indexes on (subaccount_id, created_at) and (agent_id, created_at). Hard cap scan window WHERE created_at >= now() - interval '7 days'. Avoids silent cost creep.

6. Socket storm control
dashboard.recommendations.changed emits on create/update/acknowledge/dismiss. Edge case: bulk run 8 recs → 8 socket events → 8 refetches.
Fix: debounce client refetch (250-500ms) OR emit once per run. Not critical for v1 but worth a 5-min debounce.

7. Missing "first seen" vs "last changed" distinction
Track created_at and updated_at; UI sorts by updated_at — correct. But you lose ability to show persistence of problems.
Optional (future UX): surface "ongoing for X days". No schema change needed.

8. Phrase tokeniser risk (real-world noise)
Regex + n-grams works, but edge cases: punctuation variants, casing, synonyms ("guarantee" vs "guaranteed").
Minimal improvement: lowercase + stem basic suffixes (ing, ed, s). Avoids fragmented counts.

9. Missing hard failure visibility
You log dropped_due_to_cap, evicted_lower_priority. Don't log scan failures or partial category failures.
Add: recommendations.scan_failed with category, error type. Otherwise silent failures = invisible blind spots.

10. One subtle UX gap
Hide section when empty is clean, but: user gets used to section, it disappears → feels broken. Already flagged as deferred — confirming this will come up in real usage.

Final verdict
"Ship it. Monitor. Iterate."
If you want one last step: convert these into a pre-build checklist so nothing slips during implementation. Otherwise, you're good to go.
```

Inferred verdict: APPROVED ("Ship it. Monitor. Iterate.").

### Recommendations and Decisions

| ID | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|----|---------|--------|----------------|----------------|----------|-----------|
| R3-F1 | Append `updated_at ASC` to eviction priority tuple, `updated_at DESC` to display sort | user-facing | apply | _pending user_ | medium | Equal-priority items currently have indeterminate eviction order; older ones can persist forever. Cheap addition. |
| R3-F2 | Pin numeric canonicalisation for evidence_hash (integers for currency/counts/ms; 4dp for percentages) | technical | apply | auto (apply) | medium | Phantom updated_in_place risk if values pass through multiple serializers. Fix is purely technical. |
| R3-F3 | Only clear `acknowledged_at` if severity increased OR delta > 2× threshold | user-facing | defer | _pending user_ | low | ChatGPT itself says "Not required now". `materialDelta` floors already absorb most micro-noise. Polish layer that needs production usage to tune. |
| R3-F4 | Soft global per-scope cap (20-30) on top of per-agent cap | technical-escalated (defer) | defer | _pending user_ | low | ChatGPT explicitly frames as "future consideration (not now)". Single optimiser agent in v1; no fragmentation risk yet. Routed to tasks/todo.md. |
| R3-F5 | Composite indexes (`(subaccount_id, created_at)`, `(agent_id, created_at)`) + 7-day window cap on heavy scans | technical | apply | auto (apply) | medium | Indexes likely already exist on most source tables; spec adds an implementation-time verification step. Window cap is cheap to document. |
| R3-F6 | Client-side debounce (250-500ms) on `dashboard.recommendations.changed` refetch | technical | apply | auto (apply) | low | Cheap client-side guard against bulk-run socket storms. |
| R3-F7 | "Ongoing for X days" UI surface using existing `created_at` | user-facing | defer | _pending user_ | low | ChatGPT itself says "Optional (future UX)". v1 UI doesn't need persistence-aware copy yet. Routed to tasks/todo.md. |
| R3-F8 | Phrase tokeniser: lowercase + stem basic suffixes (ing, ed, s) | technical | apply | auto (apply) | low | Tokeniser-quality improvement that prevents fragmented counts. Direction unambiguous. |
| R3-F9 | Add `recommendations.scan_failed` structured log for scan errors | technical | apply | auto (apply) | medium | Sister convention to `dropped_due_to_cap` and `evicted_lower_priority`. Closes silent-failure blind spot. |
| R3-F10 | Hide-when-empty UX (re-affirmation of R1-F14 deferral) | — | — | n/a | — | Same finding as R1-F14, already deferred. ChatGPT explicitly notes "Already flagged as deferred, which is correct". |

**Summary counts (Round 3):**
- Auto-applied (technical): 5 ChatGPT (R3-F2, R3-F5, R3-F6, R3-F8, R3-F9) + 1 integrity (priority tuple direction wording) = 6 applied, 0 rejected, 0 deferred
- User-decided: 1 applied (R3-F1), 0 rejected, 3 deferred (R3-F3, R3-F4, R3-F7) — user replied "as recommended"
- No new decision (carry-over): R3-F10 = R1-F14

### Decisions and Resolutions (post user reply)

| ID | Final Decision |
|----|----------------|
| R3-F1 | apply (user: as recommended) — `updated_at` tiebreaker (eviction stalest-first; display already freshest-first) |
| R3-F2 | auto (apply) — numeric canonicalisation rules pinned (integers + 4dp percentages) |
| R3-F3 | defer (user: as recommended) — acknowledge-clear ramp; routed to tasks/todo.md |
| R3-F4 | defer (user: as recommended) — soft global per-scope cap; routed to tasks/todo.md |
| R3-F5 | auto (apply) — composite-index assumption + 7-day window cap as Phase 1 verification step |
| R3-F6 | auto (apply) — 250ms trailing-edge debounce on socket refetch |
| R3-F7 | defer (user: as recommended) — "Ongoing for X days" UI; routed to tasks/todo.md |
| R3-F8 | auto (apply) — phrase tokeniser polish (lowercase + minimal suffix-stem) |
| R3-F9 | auto (apply) — `recommendations.scan_failed` structured log (closes silent-failure gap) |
| R3-F10 | n/a — re-affirms R1-F14 deferral; no new decision |

### Applied (auto-applied technical + user-approved user-facing)

**Spec edits (`docs/sub-account-optimiser-spec.md`):**
- [user] §6.2 — eviction `evicted_lower_priority` bullet now describes priority ranking with explicit `updated_at` tiebreaker (newer wins for ranking; stalest-first for eviction).
- [user] §6.2 — Decision flow step 4 ORDER BY now reads `severity asc, category desc, dedupe_key desc, updated_at asc` (returns lowest-priority + stalest first for eviction).
- [auto] §6.2 — Pre-write candidate ordering paragraph updated to reflect the new tiebreaker (and notes that producer can't participate in `updated_at` ordering since candidates aren't stored yet).
- [auto] §6.2 — NEW "Numeric canonicalisation" subsection in §6.2 Evidence hash documents the integer / 4dp-percentage normalisation rules. Closes phantom-`updated_in_place` risk from RFC 8785 / serializer round-trips.
- [auto] §6.5 — Socket payload subsection now documents 250ms trailing-edge debounce on `dashboard.recommendations.changed` refetch (collapses bulk-run 8-event storms into one refetch).
- [auto] §9 Phase 1 — `escalationPhrases.ts` bullet expanded with tokeniser pre-processing (lowercase + strip punctuation + suffix-stem `-ing` / `-ed` / `-s`); explicitly notes minimal — no full Porter / Snowball.
- [auto] §9 Phase 1 — NEW "Query cost guardrails" bullet documenting 7-day window cap + composite-index assumption per source table; verification runs as part of each query module's unit test.
- [auto] §9 Phase 2 — NEW bullet wrapping each scan-skill invocation in try/catch + `recommendations.scan_failed` structured log (sister to dropped/evicted log lines).
- [auto] §13 risks — NEW "Silent scan failures" bullet referencing the Phase 2 wrap.
- [user] Deferred Items section — appended R3-F3 (acknowledge-clear ramp), R3-F4 (soft global per-scope cap), R3-F7 ("ongoing for X days" UI) with reconsider-per-trigger reasons.
- [auto] §6.2 (integrity I1) — `evicted_lower_priority` bullet rewritten to remove asc/desc ambiguity in the priority-tuple description (replaced asc/desc directional terminology with explicit ranking semantics: "newer `updated_at` wins ranking; stalest evicted first").
- [auto] §6.2 (integrity I1, second paragraph) — `Pre-write candidate ordering` updated to align with the new ranking framing.

**`tasks/todo.md`:**
- [user] Three new entries appended to `### subaccount-optimiser (2026-05-02)`: R3-F3, R3-F4, R3-F7 (all `[user]`-tagged).

### Integrity check

Integrity check: 1 issue found this round (auto: 1, escalated: 0). The `updated_at asc` direction in the priority-tuple description was ambiguous (asc as sort direction vs asc as priority direction conflict — the eviction query orders asc to find stalest first, but the priority ranking itself treats newer as higher). Rewritten in plain ranking terms to eliminate the ambiguity. Post-integrity sanity: `recommendations.scan_failed` referenced consistently in §9 Phase 2 and §13 risks; numeric canonicalisation rules referenced in §6.2 Evidence hash + §6.5 evidence types (canonicalisation step lives next to evidence types per the spec); 250ms debounce documented in §6.5 socket subsection only (single source of truth).

### Top themes

- **Round 3 is the observability + edge-case round.** Rounds 1 and 2 hardened the lifecycle; Round 3 closes silent-failure blind spots (`recommendations.scan_failed`), ordering edge cases (stalest-first eviction), numeric serialisation hazards (canonicalisation rules), socket storm absorption (debounce), tokeniser fragmentation (lowercase + stem), and query cost ceilings (7-day window + index assumption). None are structural; all are "nothing left to bite you later" polish.
- **Three carry-over deferrals (R3-F3, R3-F4, R3-F7) all share a common shape: needs production data.** Acknowledge-clear ramp needs operator usage to tune; soft global cap needs multi-producer fragmentation to actually emerge; "ongoing for X days" needs an operator workflow that benefits. Pre-launch, all three are speculative; post-launch with real data, each becomes designable.
- **The auto-apply rate climbed from 5/14 (R1) to 1/7 (R2) to 5/10 (R3).** R1 had a high user-facing rate because the lifecycle changes were operator-perceptible. R2's surface was lifecycle-tightening (most user-facing). R3's surface is observability and edge cases — most are technical and auto-apply. This is the typical convergence pattern: directional decisions concentrate in early rounds, mechanical tightening dominates later rounds.

### Round 3 status

Round 3 complete. Spec grew from 783 → 796 lines (+13 net). One user-facing apply, three user-facing defers, six technical auto-applies (5 ChatGPT + 1 integrity).

---

## Round 4 — 2026-05-02T00-48-00Z

### ChatGPT Feedback (raw)

```
Executive summary: You're genuinely at the end. What's left is ultra-edge correctness + long-term survivability, not build blockers.

Final "last 1%" gaps

1. Cross-agent dedupe collision (real but rare)
Multiple agents writing to (scope, category, dedupe_key); unique index on (scope_type, scope_id, category, dedupe_key). Two different agents can unintentionally overwrite each other's findings, especially if future agents reuse categories like agent.over_budget.
Minimal fix: enforce hard rule category = "<agent_namespace>.<area>.<finding>" (e.g. optimiser.agent.over_budget vs portfolio.agent.over_budget). Already hinted at namespacing but needs to be hard rule, not suggestion.

2. Evidence canonicalisation incomplete — array ordering
You handled integers and floats (4dp). Missing: array ordering. sample_escalation_ids: ["a","b","c"] vs ["b","a","c"] → same meaning → different hash → triggers updated_in_place. Fix: sort arrays where order is non-semantic before hashing. Especially sample_escalation_ids and any future list-type evidence.

3. Eviction fairness still has one corner case
Alphabetical category bias still dominates before freshness. Priority: severity → category → dedupe_key → updated_at. Example: agent.* will always beat memory.* even if memory rec is more important operationally.
Better ordering: severity → updated_at → category → dedupe_key. Removes structural bias, keeps determinism.

4. Missing "run-level atomicity" for outputs
Each output.recommend runs independently; cap + eviction applied per call. Edge case: run generates 12 recs, order of calls influences final surface. Fix (lightweight): add explicit invariant "A single agent run must produce a deterministic final set of recommendations regardless of execution interleaving." Currently implied, not enforced.

5. Cooldown + severity escalation loophole
Bypass if severity increases. Edge case: warn → dismiss → critical → bypass → drops to warn → cooldown blocks → critical again → bypass again. Flip-flop spam.
Fix: track last_escalation_bypass_at, allow bypass only once per cooldown window. Not required for v1, but this will show up in real data.

6. "See all N" truncation honesty
Correctly notes limit=100 cap. But /suggestions doesn't exist yet → user hits dead end: "I know there are more but I can't access them".
Fix: change copy to "Showing top 100 of N", remove "see full list" language until /suggestions ships.

Final verdict: "Production-safe, scale-aware, future-extensible." 2 correctness edge cases, 2 fairness refinements, 2 UX/operational polish items. None block build.
```

Inferred verdict: APPROVED ("Production-safe, scale-aware, future-extensible. None block build.").

### Recommendations and Decisions

| ID | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|----|---------|--------|----------------|----------------|----------|-----------|
| R4-F1 | Category namespace: promote from convention to hard rule (`<agent_namespace>.<area>.<finding>`) | technical | apply | auto (apply) | medium | Prevents unintentional cross-agent dedupe collisions when future agents reuse short category names. Also defuses R4-F3's alphabetical-bias concern within a single agent's namespace. |
| R4-F2 | Evidence canonicalisation: sort non-semantic arrays before hashing | technical | apply | auto (apply) | medium | `sample_escalation_ids` order is non-semantic; permutation of the same IDs produces a different hash and triggers phantom `updated_in_place`. RFC 8785 doesn't sort arrays. |
| R4-F3 | Eviction priority tuple reorder: severity → updated_at → category → dedupe_key | user-facing | defer | _pending user_ | low | With R4-F1 applying the namespace hard rule, category-alphabetical bias is scoped within one agent's namespace. Reordering would sacrifice tuple stability (same rec evicted across runs) for fairness that's no longer a real concern with proper namespacing. |
| R4-F4 | Add explicit run-level atomicity invariant in the spec | technical | apply | auto (apply) | low | Currently implied by the pre-sort recommendation. A one-paragraph spec invariant is cheap and closes the "implied not enforced" gap. |
| R4-F5 | Cooldown bypass loophole: allow bypass only once per cooldown window | user-facing | defer | _pending user_ | low | ChatGPT says "Not required for v1". Requires `last_escalation_bypass_at` column. Scenario (multi-oscillation within one window) won't appear in pre-production telemetry. Revisit with production data. |
| R4-F6 | Change "Showing 100 of N — see /suggestions" copy to "Showing top 100 of N" until /suggestions ships | user-facing | apply | _pending user_ | low | /suggestions is a v1.1 deferred item. Current copy implies a destination that doesn't exist. Simple wording change. |

**Summary counts (Round 4):**
- Auto-applied (technical): 3 ChatGPT (R4-F1, R4-F2, R4-F4) + 1 integrity (singletonKey assertion softened to requirement) = 4 applied, 0 rejected, 0 deferred
- User-decided: 1 applied (R4-F6), 0 rejected, 2 deferred (R4-F3, R4-F5) — user replied "as recommended"

### Decisions and Resolutions (post user reply)

| ID | Final Decision |
|----|----------------|
| R4-F1 | auto (apply) — category namespace promoted to hard rule (`<agent_namespace>.<area>.<finding>`); §2 namespace note + §6.2 naming rule + §6.5 example row updated |
| R4-F2 | auto (apply) — array sorting added to canonicalisation: non-semantic arrays sorted ascending before hash input; `sample_escalation_ids` called out explicitly |
| R4-F3 | defer (user: as recommended) — R4-F1 namespace rule scopes bias within one agent's namespace; within-namespace alphabetical ordering is stable/arbitrary; routed to tasks/todo.md |
| R4-F4 | auto (apply) — "Run-level atomicity invariant" paragraph added to §6.2 with three-property guarantee (pre-sort + sequential calls + singletonKey scheduling) |
| R4-F5 | defer (user: as recommended) — bypass-once-per-window guard; scenario requires multi-oscillation within one cooldown window (implausible pre-production); routed to tasks/todo.md |
| R4-F6 | apply (user: as recommended) — "Showing top 100 of N" copy replacing dead-end "/suggestions" reference |

### Applied edits

- [auto] §2 — "Namespace note" paragraph clarifying that taxonomy table uses short `area.finding` form; full stored values use `optimiser.<area>.<finding>`.
- [auto] §6.2 — Category naming rewritten from "convention only" to "hard rule: three segments `<agent_namespace>.<area>.<finding>`"; extended with examples across multiple agents.
- [auto] §6.5 — Example row `"category"` updated from `"agent.over_budget"` to `"optimiser.agent.over_budget"`.
- [auto] §6.2 — Array sorting added to the Numeric canonicalisation paragraph: RFC 8785 does NOT sort arrays; non-semantic arrays must be sorted ascending before hashing; `sample_escalation_ids` called out explicitly; future list-type evidence fields must document order semantics.
- [auto] §6.2 — NEW "Run-level atomicity invariant" paragraph (three-property guarantee: pre-sort, sequential calls, singletonKey scheduling). `singletonKey` phrased as a Phase 2 implementation requirement, not a current assertion.
- [user] §7 — Expanded-mode truncation copy changed from "Showing 100 of N — see /suggestions for the full list" to "Showing top 100 of N" (no dead-end link to deferred /suggestions page).
- [user/auto] Deferred Items — appended R4-F3 (eviction reorder) and R4-F5 (bypass-once guard) with reconsider-per-trigger reasons.
- [auto] §6.2 (integrity I1) — `singletonKey` claim in atomicity invariant softened from present-tense assertion to future-tense implementation requirement on `agentScheduleService`.
- [user] `tasks/todo.md` — R4-F3 and R4-F5 appended to subaccount-optimiser subheading (both `[user]`-tagged).

### Integrity check

Integrity check: 1 issue found this round (auto: 1, escalated: 0). The "Run-level atomicity invariant" asserted `singletonKey` as a current property of `agentScheduleService` — this is a new requirement that Phase 2 must implement, not an existing codebase fact. Rewritten as a "MUST" requirement with "(Phase 2 implementation requirement)" callout. Post-integrity sanity: `optimiser.agent.over_budget` in §6.5 example row is the only full-slug occurrence; all other category references use short form with §2 namespace note as the bridge — consistent.

### Top themes

- **R4-F1 is a spec-architectural fix, not just a naming cleanup.** Promoting category namespace to a hard rule closes the unintentional cross-agent dedupe collision risk that would become real as more agents adopt the generic primitive. It also renders R4-F3's alphabetical-bias concern moot within a single agent's namespace. One fix preempts two problems.
- **R4-F2 completes the evidence-hash canonicalisation trilogy.** R3 added integer/float normalisation; R4 adds array sorting. RFC 8785 handles string canonicalisation. Together they cover all JSON types. The spec's canonicalisation rules are now fully specified: integers bare, floats to 4dp, strings via RFC 8785, arrays sorted ascending where order is non-semantic.
- **R4-F4 (atomicity invariant) converts an implied assumption into a verifiable spec property.** The pre-sort was already recommended; singletonKey scheduling wasn't stated anywhere. Surfacing both as an explicit three-property invariant gives the build session something testable: "does the schedule registration prevent concurrent runs for the same subaccount?" is now a Phase 2 implementation requirement, not a gap to rediscover.

### Round 4 status

Round 4 complete. Spec grew from 796 → 813 lines (+17). One user-facing apply (copy fix), two user-facing defers, four technical auto-applies (3 ChatGPT + 1 integrity). ChatGPT's verdict: "Production-safe, scale-aware, future-extensible."

---

## Round 5 — 2026-05-02T01-00-00Z (final round before lockdown)

### ChatGPT Feedback (raw)

```
Executive summary: You're now at the true end-state. Only 4 additional micro-gaps worth fixing. Everything else is either already solved, or not worth touching until real usage data exists.

1. Render cache key is missing render_version
You defined cache by (category, dedupe_key, evidence_hash, render_version) but later implementation paths only reference (category, dedupe_key, evidence_hash) in multiple places. Risk: tweak prompt → old copy persists → no re-render. Fix (must-do): make explicit everywhere; render_cache_key = hash(category, dedupe_key, evidence_hash, render_version); any render prompt change → bump RENDER_VERSION.

2. Cross-agent dedupe still technically unsafe
Namespace rule is good, but enforcement is "code review convention". One future agent forgets prefix → silent overwrite. Low-cost hardening: at skill executor level, validate category.startsWith(`${agentNamespace}.`). Avoids schema change, eliminates 90% of risk.

3. Array canonicalisation is correct but not future-safe
sample_escalation_ids sorted before hashing. But rule is "document whether arrays are semantic." Future dev forgets → phantom updates return. Fix: ALL arrays sorted before hashing by default; explicit preserveOrder: true to opt out. Default-safe is better than opt-in-safe.

4. Cap fairness across categories (minor but real)
Even with namespacing, optimiser.agent.* dominates optimiser.memory.* alphabetically within same agent. One noisy category crowds out others. Minimal improvement: severity → updated_at → category → dedupe_key. Preserves determinism, improves rotation fairness, reduces structural bias.

Final verdict: "Deploy-ready, scale-stable, architecture-complete". 2 defensive guards + 2 fairness tweaks. None are blockers. For absolute zero-regret before build: enforce category namespace in executor, include render_version everywhere, default-sort arrays, reorder eviction priority.
```

Inferred verdict: APPROVED ("Deploy-ready, scale-stable, architecture-complete").

### Recommendations and Decisions

| ID | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|----|---------|--------|----------------|----------------|----------|-----------|
| R5-F1 | render_version missing from 3 cache-key references in §2 / §5 / §13 | technical | apply | auto (apply) | high | Spec has correct definition in §2 line 96 but stale `(evidence_hash)`-only references in 3 other places. Mechanical consistency fix. Severity high but confident in fix → auto-apply. |
| R5-F2 | Promote category namespace from code-review convention to runtime executor guard | technical | apply | auto (apply) | medium | Single `if (!category.startsWith(agentNamespace + '.')) throw` makes forgetting the namespace fail-loud at test time, not silent-collide in production. |
| R5-F3 | Default-sort all arrays before hashing; opt-out with `@preserveOrder` annotation | technical | apply | auto (apply) | medium | Default-safe vs opt-in-safe — forgetting to document an array's order semantics no longer produces hash drift. |
| R5-F4 | Eviction priority reorder: severity → updated_at → category → dedupe_key (was severity → category → dedupe_key → updated_at) | user-facing | apply | apply (user: as recommended) | medium | **Reverses R4-F3 deferral.** ChatGPT R5 shows concrete production impact: `optimiser.agent.*` (alphabetically earliest) is ALWAYS last evicted; `optimiser.skill.*` ALWAYS first. Systematic per-category bias, not arbitrary tiebreaker. Moving updated_at to position 2 rotates eviction by freshness; full determinism preserved. |

**Summary counts (Round 5):**
- Auto-applied (technical): 3 — R5-F1, R5-F2, R5-F3
- User-decided: 1 applied (R5-F4) — user replied "as recommended, go"

### Applied edits

- [auto] §2 — Render-cache description (material thresholds paragraph) updated to reference full key tuple instead of just evidence_hash.
- [auto] §5 — Skill-table footer updated: render keyed on `(category, dedupe_key, evidence_hash, render_version)`; RENDER_VERSION bump invalidates cache after prompt-template change.
- [auto] §6.2 — Category naming: hard rule extended with runtime executor guard (`category.split('.').length >= 3` + `startsWith(agentNamespace + '.')`); validation throws `failure(FailureReason.InvalidInput, 'Category must follow <agent_namespace>.<area>.<finding> format')`.
- [auto] §6.2 — Numeric canonicalisation: array rule flipped from "document order semantics" to "default-sort all arrays; opt-out with `@preserveOrder` JSDoc annotation".
- [auto] §13 risks — LLM render cost mitigation updated to reference full cache key tuple.
- [user] §6.2 — Eviction priority ranking reordered to `severity → updated_at → category → dedupe_key`. `evicted_lower_priority` bullet rewritten with concrete rationale (alphabetical bias example: `optimiser.agent.*` vs `optimiser.skill.*`); decision flow step 4 ORDER BY updated; pre-write candidate ordering paragraph aligned (producer can't participate in updated_at ordering — explicitly noted).

### Integrity check

Integrity check: 0 issues found this round. All four findings landed cleanly with no contradictions introduced. `render_version` consistently referenced across §2 (definition), §2 (material thresholds), §5 (skill footer), §13 (risks), §9 Phase 0 (renderVersion.ts file authoring) — 7 occurrences total, all aligned. Eviction priority ranking cross-references between §6.2 (bullet, decision flow step 4, pre-write candidate ordering) all use the new tuple. No broken references.

### Top themes

- **R5 is the "default-safe" round.** All four findings flip a property from "documented but enforced by humans" to "default behaviour or runtime-validated":
  - R5-F1: render_version was already in the canonical cache key but other references hadn't propagated. Now consistent everywhere — no place left where a developer could miss it.
  - R5-F2: namespace rule was code-review-only. Now executor-guarded — wrong values fail loud at test time.
  - R5-F3: array sort was opt-in (with documentation requirement). Now default — wrong arrays fail safe by default.
  - R5-F4: alphabetical-category eviction was "arbitrary tiebreaker". Now freshness-rotated — no per-category structural bias.
  Together they convert the spec from "follow these rules carefully" to "the rules are enforced for you."
- **R5-F4 reverses R4-F3 cleanly because the argument got more specific.** R4-F3 was deferred on the abstract grounds of "namespacing makes it within-namespace bias; arbitrary." R5 made it concrete: "`optimiser.agent.*` ALWAYS beats `optimiser.skill.*`, every run, forever, no matter how stale agent.* gets." That's no longer arbitrary — it's a systematic operator-perception bias. The deferral was correct given R4's argument; the apply is correct given R5's argument. Both calls are defensible for their information state.
- **Five rounds of ChatGPT review have produced the canonical convergence pattern.** R0 → R1: +95 lines (lifecycle scaffolding). R1 → R2: +7 (in-place tightening). R2 → R3: +13 (observability). R3 → R4: +17 (atomicity + namespace). R4 → R5: ~+20 (default-safe). Each round adds less; each round's findings move closer to the surface ("polish" not "structure"). After R5, ChatGPT's verdict shifted from "production-safe" to "deploy-ready, architecture-complete" — the language tracks the convergence.

### Round 5 status

Round 5 complete. Spec at 813 lines. Three technical auto-applies, one user-facing apply (reversing R4-F3 deferral). User signal: "as recommended, go" — proceeding immediately to finalisation.

