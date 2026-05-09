# Spec Review Final Report

**Spec:** `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md`
**Spec commit at start:** `5a9e297d`
**Spec commit at finish:** `e8cac575`
**Spec-context commit:** `8b6f8d80`
**Spec-context staleness:** green (last_reviewed_at: 2026-05-05, age 4 days)
**Iterations run:** 5 of MAX_ITERATIONS (5)
**Exit condition:** iteration-cap (also satisfies two-consecutive-mechanical-only AND codex-found-nothing-new)
**Verdict:** READY_FOR_BUILD (5 iterations, 19 mechanical fixes applied, 0 deferred items, 0 directional, 0 unresolved)

---

## Iteration summary

| # | Codex | Rubric | Accepted | Rejected | Auto-decided |
|---|---|---|---|---|---|
| 1 | 7 | 4 | 11 | 0 | 0 |
| 2 | 5 | 0 | 5  | 0 | 0 |
| 3 | 2 | 0 | 2  | 0 | 0 |
| 4 | 1 | 0 | 1  | 0 | 0 |
| 5 | 0 | 0 | 0  | 0 | 0 |
| **Total** | **15** | **4** | **19** | **0** | **0** |

Convergence: monotonically decreasing (11 → 5 → 2 → 1 → 0). Each iteration's edits surfaced small downstream-section reconciliation gaps in the next; iter 5 confirmed full convergence.

---

## Mechanical changes applied (grouped by section)

- **§1 Goals/framing.** Added `support.reject_draft` to skill list. Reworded testing-posture wording so it aligns with §20 (no "no vitest" — instead "no non-pure Vitest/E2E/API-contract/frontend tests"; explicit reference to §20's five-boundary inventory).
- **§3 Phase plan.** C9 chunk row references "manual smoke test against real Teamwork sandbox" instead of generic "tests for duplicate-event collapse". C12 chunk row now lists `support.reject_draft`.
- **§5 Data model intro.** `last_sync_at` typo corrected to `last_synced_at`. New paragraph clarifies the `external_id` pattern applies only to provider-mirrored tables; `canonical_ticket_drafts` is exempt (local-only user intent).
- **§5.3 `agent_config` shape.** Added `version: 1` field that §11.5 had been referencing.
- **§8 State machine.** Spelled out the supersede transition rule + guard predicate. Forbidden-transitions list now blocks transitions OUT of `superseded` and INTO `superseded` from non-pre-dispatch states.
- **§8.5 Manual-review surface.** "Mark sent" rewritten as terminal-only (no row insert). Added "Late linking" paragraph for back-link bookkeeping post-upsert. Late-link predicate covers both `outbound` and `internal_note` directions with visibility-match disambiguation. Added "no auto-switch back to failed" clarification.
- **§9 Permission keys.** `support.draft.approve` now gates the Edit action and the `mark_sent`/`retry_reconciliation` manual-resolve sub-actions. `support.draft.reject` gates the `mark_failed` sub-action.
- **§10 UI access control.** Manual-resolve sub-action permission map listed alongside Approve/Reject/Edit/Override.
- **§11.4 Source-of-truth precedence.** `source_draft_id` writers enumerated explicitly: dispatch service (sync-confirm), reconciliation worker (post-`needs_reconciliation`), and back-link routine (post-upsert). Raw ingestion still never sets the column on its own.
- **§12 RLS row.** `canonical_tickets` route guard simplified to `authenticate` + org-scoped reads (no `support.tickets.read` permission key). `canonical_ticket_drafts` row spells out per-route key set + sub-action enforcement on `/manual-resolve`.
- **§14.4 Terminal events.** Added `support.draft.superseded` row. Cross-reference clarifies dispatch-lifecycle events are distinct from §15 operational codes; both pinned in `SUPPORT_LOG_CODES`. Post-terminal prohibition now includes `superseded`.
- **§15 SUPPORT_LOG_CODES.** Const extended with five `DRAFT_*` keys alongside the ten operational codes.
- **§17.1 Acceptance bar.** Item #2 reworded as manual smoke + static gates. Item #7 reworded to "ten operational + five draft-lifecycle terminals = fifteen".
- **§17.2 Capability matrix.** Fallback exercise rule clarified (pure-fixture coverage where decision-bounded, manual smoke otherwise).
- **§18 Routes.** `/edit` and `/manual-resolve` route rows now annotate the per-route guard.

---

## Rejected findings

None. Every Codex finding was accepted directly or with a minimal scope adjustment.

## Directional / ambiguous findings

None. Every finding across all five iterations was mechanical. Zero AUTO-DECIDED items routed to `tasks/todo.md`.

---

## Mechanically tight, but verify directionally

This spec is mechanically tight against the rubric and Codex's review. Internal contradictions, file-inventory drift, state-machine closure gaps, missing contracts, and load-bearing claims without enforcement are all resolved. However:

- **Framing not re-verified.** Pre-production, no live agency clients, static-gates-primary, commit-and-revert. Re-read §1 framing assumptions, §13 execution model, §20 testing posture before calling implementation-ready.
- **Five OQs are operator-owned, intentionally NOT raised as findings.** They must close before `Status: accepted`. OQ-1 (Foundry parity) blocks Phase 2 plan generation; OQ-2/3/4 block chunks C6/C7; OQ-5 is recorded at C9.
- **Brief is LOCKED v5.3.** Spec inherits 12 invariants, §6.1 status enum, 14 decision defaults. Changing any requires a brief amendment.
- **Mockups are the design source of truth.** Five hi-fi screens at `prototypes/support-desk-canonical/`. UI findings contradicting them would be directional and were not raised.
- **Sprint sequencing is human-owned.** Spec ships in one body of work per brief recommendation; §3 chunk plan is the order for Phase 2.

**Recommended next step for the operator:**

1. Read §1 / §13 / §20 once more to confirm framing matches current intent.
2. Close OQ-1 (Foundry schema parity verification).
3. Move spec from `Status: draft` to `Status: reviewing` after reading this report; to `Status: accepted` once OQ-1 is closed.
4. Then start Phase 2 (`feature-coordinator: implement support-desk-canonical`).

The spec is mechanically ready for build. The operator owns directional confirmation and OQ-1 closure.

---

## Provenance

| Iteration | Codex output | Iteration log | Spec commit after |
|---|---|---|---|
| 1 | `_codex_iter1_support-desk-canonical_2026-05-09T07-33-16Z.txt` | `spec-review-log-support-desk-canonical-1-...md` | `b1745ff8` |
| 2 | `_codex_iter2_support-desk-canonical_2026-05-09T07-43-07Z.txt` | `spec-review-log-support-desk-canonical-2-...md` | `7147fec7` |
| 3 | `_codex_iter3_support-desk-canonical_2026-05-09T07-53-38Z.txt` | `spec-review-log-support-desk-canonical-3-...md` | `a1ec6502` |
| 4 | `_codex_iter4_support-desk-canonical_2026-05-09T07-59-23Z.txt` | `spec-review-log-support-desk-canonical-4-...md` | `e8cac575` |
| 5 | `_codex_iter5_support-desk-canonical_2026-05-09T08-04-07Z.txt` | `spec-review-log-support-desk-canonical-5-...md` | (no new edits) |
