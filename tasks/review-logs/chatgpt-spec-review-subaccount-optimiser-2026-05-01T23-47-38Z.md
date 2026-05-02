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

Updated spec printed below — paste it into ChatGPT and paste the response here for Round 2, or say 'done' to finalise.

