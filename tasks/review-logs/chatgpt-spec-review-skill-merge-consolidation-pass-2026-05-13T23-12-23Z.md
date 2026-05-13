# ChatGPT Spec Review Session — skill-merge-consolidation-pass — 2026-05-13T23-12-23Z

## Session Info
- Spec: tasks/builds/skill-merge-consolidation-pass/spec.md
- Branch: claude/improve-skill-analyzer-RiFpB
- PR: #300 — https://github.com/michaelhazza/automation-v1/pull/300
- Mode: manual
- Started: 2026-05-13T23:12:23Z

---

## Round 1 — 2026-05-13T23:12:23Z

### ChatGPT Feedback (raw)

> I'll review this as a spec-gate pass, focusing on contract consistency, buildability, hidden edge cases, and places where the implementer could misread intent.
>
> Spec is strong and buildable. I would not block it on architecture. The core approach is sound: conditional second pass, bounded cost, no workflow disruption, no new route/service/table, and good source-of-truth rules for proposedMergedContent, originalProposedMerge, and the new audit field.
>
> I found 4 should-fix items before locking.
>
> **F1 — consolidationOutcome IS NOT NULL conflicts with legacy/null semantics.**
> The spec says: "consolidationOutcome != null is the in-band marker that consolidation has been decided for this row." But elsewhere it says legacy rows remain NULL and UI treats NULL as not_triggered. The idempotency contract is slightly misleading — the real guard is existing result-row presence for the slug.
> Risk: A builder may add code that treats NULL as "not yet decided" and attempts a backfill/re-run later.
> Fix: Reword the idempotency contract — `consolidationOutcome` is not used to resume or retry consolidation for existing rows; job-time idempotency is provided by the existing per-slug result-row skip; for rows written after this migration, orchestration MUST always write one of `not_triggered | succeeded | declined | failed`; legacy rows may be NULL and are display-equivalent to `not_triggered`, but MUST NOT be interpreted as eligible for re-consolidation. Also consider making orchestration always write `not_triggered`, not NULL, for new rows where the gate does not fire.
>
> **F2 — Warning replacement semantics need to be explicit after re-validation.**
> The spec says `mergeWarnings` is the "final warning set after consolidation re-validation," but the failure path says if consolidation introduces a hard violation, revert to pre-consolidation and emit CONSOLIDATION_FAILED. The ambiguous bit: after reverting, do we restore pre-consolidation validation warnings, or keep post-consolidation warnings plus CONSOLIDATION_FAILED?
> Correct behaviour: validate pre, if consolidation succeeds validate consolidated, if consolidated violates hard constraints revert to pre, final warnings based on the actual final draft + CONSOLIDATION_FAILED.
> Risk: Reviewer could see warnings for a draft they are not actually reviewing.
> Fix: Add a contract — Final warning set MUST correspond to the final stored `proposedMergedContent`. If consolidation is reverted, discard post-consolidation validation warnings and restore/recompute warnings against the pre-consolidation draft, then append `CONSOLIDATION_FAILED`. Add to §5 and §10.
>
> **F3 — "Keep parsed consolidated output even if still bloated" conflicts with "re-run validate and final warning set".**
> The approach section says: "If consolidation fails ... post-consolidation validation still bloated, keep the consolidated output if it parsed." Reasonable, but needs a precise definition of "failed". Later §5 says revert only on hard-constraint violations, not on remaining SCOPE_EXPANSION.
> Intended rule: still bloated but smaller and no hard violations = succeeded; declined = keep original; parse/timeout/hard-loss = failed and revert; smaller but still above threshold = keep consolidated and retain SCOPE_EXPANSION.
> Risk: Implementer may mark "still bloated" as failed, causing UI copy to say "reviewer is seeing the original merge" when they are actually seeing the consolidated one.
> Fix: If parsed consolidation is shorter and passes hard-preservation validation, it is treated as `succeeded` even if `validateMergeOutput()` still emits `SCOPE_EXPANSION` or `SCOPE_EXPANSION_CRITICAL`. The final warning set retains the applicable scope-expansion warning plus `CONSOLIDATION_APPLIED`.
>
> **F4 — Preservation inventory may miss non-backticked tool/skill references.**
> The spec says the preservation inventory includes "every backtick-wrapped tool/skill reference." Good deterministic baseline, but real skill instructions may not always be backticked (e.g. "Use Gmail search_emails", "call create_event", "requires human approval before send_email", "handoff to skillAnalyzerJob").
> Risk: Consolidation can accidentally drop important unbackticked operational references while still passing the preservation self-check.
> Fix: Keep the backtick rule, add tier 2 — Preservation inventory MUST include (1) all backtick-wrapped references; (2) known tool/action names from the skill definition/instructions where they match registered tool/action identifiers; (3) HITL / approval / confirmation gate phrases. Tier 2 matches are best-effort and informational; loss should trigger `CONSOLIDATION_FAILED` only where the existing validator or deterministic checker can prove capability loss.
>
> **Tightening suggestions**
>
> **T1 — Add a strict parser rule for instructions type and non-empty output.** Parser must reject if: instructions is empty or whitespace; instructions is not a string; consolidationNote is missing or not a string; declinedToConsolidate=true but declineReason is empty. Prevents silent bad rows.
>
> **T2 — Include consolidationNote in banner details for success.** The file inventory adds consolidationNote, but §7 only mentions success banner word delta and pre-consolidation disclosure. The note is valuable reviewer context. Suggested: success banner includes `consolidationNote` below the size delta.
>
> **T3 — Clarify whether consolidationTriggerSeverity uses warning code or tier map.** Trigger severity is based on the validator warning code: 'warning' = trigger on SCOPE_EXPANSION or SCOPE_EXPANSION_CRITICAL; 'critical' = trigger only on SCOPE_EXPANSION_CRITICAL. NOT affected by operator edits to warningTierMap, otherwise changing UI warning tiers could unexpectedly change LLM spend.
>
> **T4 — Add one acceptance criterion for "no consolidation on DISTINCT / no merge".** DISTINCT rows and non-merge classifications MUST write `consolidationOutcome='not_triggered'` and MUST NOT call `routeCall` with `featureTag='skill-analyzer-consolidate'`.
>
> **Recommended lock decision:** apply F1 to F4 before locking. T1 to T4 are low-effort and worth rolling in.

Overall verdict (inferred): **CHANGES_REQUESTED** — 4 should-fix findings plus 4 tightening suggestions before lock-ready.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 — Rewrite idempotency contract: clarify `consolidationOutcome` is NOT the idempotency guard; row-presence is; legacy NULL = display-equivalent to `not_triggered` but not eligible for re-consolidation | technical | apply | auto (apply) | medium | Real ambiguity in §5+§10. A builder could misread current wording as "NULL = not yet decided, run backfill". Pure spec clarification — no architectural change. |
| F2 — Add explicit rule: final `mergeWarnings` MUST correspond to final stored `proposedMergedContent`. If reverted, discard post-consolidation warnings, recompute against pre-consolidation draft, append `CONSOLIDATION_FAILED` | technical | apply | auto (apply) | medium | Missing contract for warning-set semantics after revert. Without this, reviewer could see warnings for a draft they are not reviewing — internal correctness gap. |
| F3 — Define `succeeded` outcome explicitly: shorter + passes hard-preservation = succeeded even if `SCOPE_EXPANSION`/`SCOPE_EXPANSION_CRITICAL` still emit. Retain scope warning + `CONSOLIDATION_APPLIED` | technical | apply | auto (apply) | medium | Boundary between `succeeded` and `failed` is currently underspecified; misclassification would cause UI to say "seeing the original merge" when reviewer is seeing the consolidated one. Internal rule, prevents UX bug. |
| F4 — Extend preservation inventory with tier 2 (registered tool/action identifiers + HITL/approval phrases); tier 2 loss informational unless validator can prove capability loss | technical | apply | auto (apply) | medium | Backtick-only inventory is genuinely incomplete; bounded second tier with explicit safety-rail boundary. Aligned with the hard preservation list already in §4.2. |
| T1 — Add explicit parser rejection: empty/whitespace instructions, non-string instructions, missing/non-string consolidationNote, declinedToConsolidate=true with empty declineReason | technical | apply | auto (apply) | low | Defensive parser rules; prevents silent bad rows. Pure addition to §4.3. |
| T2 — Success banner shows `consolidationNote` below the size delta | user-facing | apply | _pending user approval_ | low | Visible reviewer copy change — reviewer is the end-user of MergeReviewBlock. Adds context the reviewer reads on screen. Cheap and informative. |
| T3 — `consolidation_trigger_severity` is based on validator warning code, NOT on operator edits to `warningTierMap`. Changing tier map MUST NOT change consolidation spend | technical | apply | auto (apply) | medium | Internal invariant clarification. Prevents an LLM-cost surprise when operators tune UI warning tiers. Config semantics, no user-visible workflow change. |
| T4 — Acceptance criterion: DISTINCT + non-merge classifications MUST write `consolidationOutcome='not_triggered'` and MUST NOT invoke `routeCall` with `featureTag='skill-analyzer-consolidate'` | technical | apply | auto (apply) | low | Already implied by spec; codifying it as an explicit acceptance criterion prevents accidental spend. |

Top themes: contract precision (F1, F2, F3, T1, T3) | preservation safety (F4) | UI reviewer affordance (T2) | acceptance criteria (T4).

### Applied (auto-applied technical + user-approved user-facing)

- [auto] F1 — Rewrote §5 idempotency contract; rewrote §10 idempotency posture; tightened §10 state machine closure bullet. `consolidationOutcome` is now an audit field; row-presence is the idempotency guard; post-migration rows always carry one of the four enum values; legacy NULL is display-equivalent to `not_triggered` but never eligible for re-consolidation.
- [auto] F2 — Added warning-set replacement rule to §5 step 6: final `mergeWarnings` MUST correspond to the final stored `proposedMergedContent`; revert discards post-consolidation warnings and restores/recomputes against the pre-consolidation draft + `CONSOLIDATION_FAILED`.
- [auto] F3 — Added outcome-classification rule to §5: shorter + passes hard-preservation = `succeeded` even if `SCOPE_EXPANSION`/`SCOPE_EXPANSION_CRITICAL` still emit; `failed` only on parse/timeout/LLM-error/hard-violation.
- [auto] F4 — Replaced §4.1 PRESERVATION INVENTORY with a tiered structure: Tier 1 (hard, verbatim-required, triggers `CONSOLIDATION_FAILED` on loss) + Tier 2 (best-effort, informational unless validator can prove capability loss).
- [auto] T1 — Added explicit parser rejection rules to §4.3 covering non-string/empty instructions, missing/empty consolidationNote, non-boolean declinedToConsolidate, and empty declineReason when declined=true.
- [user-approved] T2 — Extended §7 success-banner copy: banner now shows `consolidationNote` below the size-delta line.
- [auto] T3 — Added invariant note to §6: `consolidation_trigger_severity` is evaluated against raw validator codes, NOT against `warningTierMap`. Changing tier map MUST NOT change consolidation spend.
- [auto] T4 — Added §10 "No-consolidation guarantee for non-merging classifications" bullet: DUPLICATE + DISTINCT MUST write `consolidationOutcome='not_triggered'` and MUST NOT invoke `routeCall` with `featureTag: 'skill-analyzer-consolidate'`.
- [auto, integrity-check] §2 design choice #3 wording: realigned with F3's outcome-classification rule (parsed-and-shorter-but-still-bloated is `succeeded`, not `failed`).
- [auto, hygiene] Bumped "Last updated" front-matter date to 2026-05-14.

Integrity check: 1 issue found this round (auto: 1, escalated: 0) — §2 contradiction with F3's new rule; mechanical fix applied. Post-integrity sanity: no broken heading refs, no empty sections introduced.

---


