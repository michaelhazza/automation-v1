# Spec Review Iteration 1 — support-desk-canonical

**Spec:** `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md`
**Spec commit at start:** `5a9e297d`
**Iteration:** 1 of MAX_ITERATIONS (5)

## Codex findings (7 distinct)

### F1 — `last_sync_at` / `last_synced_at` column drift
- Section: §5 intro line 201
- Type: schema/index drift
- Severity: important
- Codex's fix: pick one spelling everywhere; prefer `last_synced_at` (brief wording).
- Classification: **mechanical**. Reasoning: typo in §5 intro; concrete tables (§5.1, §5.3, §5.4) and §7 ingestion narrative all use `last_synced_at`. Same column name, single typo to correct.
- Disposition: **auto-apply** — change line 201 `last_sync_at` to `last_synced_at`.

### F2 — Draft table inherits `external_id` but does not define one
- Section: §5 intro line 201, §5.5
- Type: contradiction
- Severity: important
- Codex's fix: amend §5 intro to say "all provider-mirrored tables" and explicitly exempt `canonical_ticket_drafts`.
- Classification: **mechanical**. Reasoning: drafts are user-intent state, not provider-mirrored, and §5.5 (line 458) deliberately omits `external_id`. The §5 intro's blanket pattern is the bug.
- Disposition: **auto-apply** — clarify §5 intro to scope the pattern to provider-mirrored tables, exempt drafts.

### F3 — Non-pure duplicate-event tests contradict testing posture
- Section: §3 C9, §17.1 acceptance bar, §17.2 capability matrix, §20
- Type: contradiction
- Severity: important
- Codex's fix: reword acceptance items as manual smoke + pure helper fixtures only; if a pure helper exists, name it.
- Classification: **mechanical**. Reasoning: §20 line 1765 already says "Not test-suite-automated in v1" and §17.1 line 1559 says "operator-driven manual smoke test"; line 1551 phrasing "duplicate-event test" is ambiguous and reads like a vitest unless rewritten. Same applies to C9 row "tests for duplicate-event collapse" (line 132) and §17.2 line 1563 "must have a test or fixture exercising it".
- Disposition: **auto-apply** — restate acceptance items as manual smoke against real Teamwork sandbox + the existing pure-function fixture set already declared in §20.

### F4 — Manual "Mark sent" lacks provider-message identity contract (CRITICAL)
- Section: §8.5 line 925, §5.2 line 250-251, §11.4
- Type: missing-contract
- Severity: critical
- Codex's fix: require Mark sent to collect/resolve the provider message ID before insert, OR change action to not insert.
- Classification: **mechanical**. Reasoning: §5.2 line 250 says `external_id` is "provider's message ID, NOT NULL". §8.5 line 925 says Mark sent "inserts the canonical message manually with the operator's `users.id` as the source" — but the user has no provider message ID to give. This is a load-bearing claim ("Transitions draft to sent, inserts the canonical message manually") with no mechanism for satisfying the schema NOT-NULL constraint. Fix is surgical: clarify Mark sent does NOT insert into `canonical_ticket_messages`; it only transitions the draft, and a subsequent webhook/poll lands the message.
- Disposition: **auto-apply** — rewrite the "Mark sent" bullet to NOT insert a canonical message (the provider's webhook will land it; if it doesn't, the operator can use Retry reconciliation later).

### F5 — Ticket read permission is both new and not new
- Section: §9 (line 980+), §10 (line 1042), §12 (line 1229), §18 (line 1675)
- Type: ambiguity
- Severity: minor
- Codex's fix: pick one — either define `support.tickets.read` as a real key, or remove from prose.
- Classification: **mechanical**. Reasoning: §10 line 1042 says reads "do not require a permission key"; §18 line 1675 says key is implicit; §12 line 1229 names `requirePermission('support.tickets.read')` (or implicit). The convention in this codebase for canonical reads is org-scoped via `authenticate` only (no per-table read key). Fix: drop the `support.tickets.read` reference from §12, keep "authenticate + org-scoped reads" only.
- Disposition: **auto-apply** — line 1229 fix.

### F6 — Draft edit route has no permission contract
- Section: §10 (line 1043), §18 (line 1670), §9 permission keys (line 980+)
- Type: missing-contract
- Severity: important
- Codex's fix: add `support.draft.edit` permission OR state that approve covers edit.
- Classification: **mechanical**. Reasoning: edit is a write path on draft body; the spec defines approve/reject/override_collision but not edit. Conventional choice in this codebase: when an action is logically an in-progress mutation toward approve, it shares the approve permission. Fix: pin `support.draft.approve` as the guard for the edit route, document this in §9.
- Disposition: **auto-apply** — add the explicit guard rule for `/edit` in §9 + §18.

### F7 — `support.reject_draft` not in §1 goals skill list
- Section: §1 (line 54), §9 (line 962), §18 (line 1652)
- Type: drift
- Severity: minor
- Codex's fix: add `support.reject_draft` to §1 list.
- Classification: **mechanical**. Reasoning: the §1 goal list omits `reject_draft`, but it's a peer of `approve_draft` everywhere else.
- Disposition: **auto-apply** — add to §1 line 54.

## Rubric findings (4 distinct, drawn from spec-authoring-checklist passes)

### R1 — `version: 1` field in §11.5 example but not in §5.3 shape
- Section: §5.3 (lines 376-401), §11.5 (line 1144)
- Type: contract drift
- Reasoning: §11.5 line 1140 says `version: 1` field anchors the shape; example at line 1144 includes it. But §5.3 TypeScript shape (lines 376-401) does not declare a `version` field.
- Classification: **mechanical**. Disposition: **auto-apply** — add `version: 1` to §5.3 shape.

### R3 — `superseded` state machine closure gaps
- Section: §5.5 line 471 (closed enum), §8 state diagram lines 783-828, §8 forbidden transitions line 830-835, §14.4 line 1405 post-terminal prohibition
- Type: state-machine-closure / invariant-gap
- Reasoning: `superseded` is in the closed enum and is described in prose (line 827), but: (a) the state diagram does not draw a transition INTO `superseded`; (b) the forbidden-transitions list at line 834 names `sent | failed | rejected | expired` as terminal but omits `superseded`; (c) §14.4 post-terminal prohibition at line 1405 omits `superseded`.
- Classification: **mechanical**. Disposition: **auto-apply** — add `superseded` to terminal list in §8 forbidden transitions, add to §14.4 post-terminal list, and add a one-line "transition into superseded" rule to the §8 state diagram caption.

### R4a + R4b — `support.draft.*` event codes not pinned + `support.draft.superseded` missing
- Section: §14.4 lines 1393-1405, §15 SUPPORT_LOG_CODES (lines 1461-1473), §18 line 1686
- Type: contract drift / state-machine-closure
- Reasoning:
  - R4a: §14.4 references events `support.draft.sent | failed | rejected | expired` but these strings are NOT in SUPPORT_LOG_CODES const (§15). The §15 const only contains §15 observability codes. So §14.4 introduces a separate event-code namespace without pinning where the strings live.
  - R4b: `support.draft.superseded` event is missing from the §14.4 terminal-events table (it's described as a state in §5.5 / §8 but never paired with a terminal event).
- Classification: **mechanical**. Disposition: **auto-apply** — extend SUPPORT_LOG_CODES to include the `DRAFT_SENT | DRAFT_FAILED | DRAFT_REJECTED | DRAFT_EXPIRED | DRAFT_SUPERSEDED` keys, and add `support.draft.superseded` to §14.4 with `status: 'superseded'`.

## Ambiguous / directional (none surfaced)

No findings rose to directional or AUTO-DECIDED level this iteration. All Codex + rubric findings are mechanical document-cleanup.

## Step 6 results — applied fixes

| # | Finding | Fix landed |
|---|---|---|
| F1 | `last_sync_at` typo in §5 intro | Changed line 201 to `last_synced_at`; line 95 retained `last_sync_at` because it correctly describes the existing `canonicalAccounts` table whose actual column is `lastSyncAt`. |
| F2 | Draft `external_id` inheritance ambiguity | Added new paragraph at §5 intro splitting "provider-mirrored tables carry `external_id`" from "drafts are local-only, no `external_id`". |
| F3 | Non-pure tests vs framing | Reworded §17.1 acceptance #2, §17.2 fallback rule, and C9 chunk row to call out manual smoke + pure fixtures only; explicitly cite §20 testing posture. |
| F4 | Mark sent provider-message identity | Rewrote §8.5 Mark-sent bullet: now transitions draft only, does NOT insert into `canonical_ticket_messages`; added a "Why fire-and-forget" paragraph explaining the contract. |
| F5 | Ticket read permission contradiction | §12 RLS row for `canonical_tickets` updated: route guard is `authenticate` + org-scoped reads, no `support.tickets.read` permission key. |
| F6 | Draft edit route permission gap | §9 permission keys: `support.draft.approve` now explicitly gates the edit action; §18 routes annotated with the guard. |
| F7 | `support.reject_draft` not in §1 goals | Added to the §1 skill list. |
| R1 | `version: 1` field missing from §5.3 shape | Added `version: 1` field with comment in §5.3 TypeScript shape. |
| R3 | `superseded` state machine closure gaps | §8 state diagram now spells out the supersede transition rule + guard predicate; forbidden-transitions list adds `superseded → *` and includes `superseded` among terminals; §14.4 post-terminal prohibition includes `superseded`. |
| R4a | `support.draft.*` event codes not pinned | §15 SUPPORT_LOG_CODES extended with `DRAFT_SENT/FAILED/REJECTED/EXPIRED/SUPERSEDED` keys; §14.4 explicitly cross-references the const. |
| R4b | `support.draft.superseded` missing from §14.4 terminal events | Added a new row to §14.4 terminal events table for the supersede path. |

## Stopping heuristic counters (iteration 1)

- mechanical_accepted: 11
- mechanical_rejected: 0
- directional_or_ambiguous: 0
- reclassified_to_directional: 0

## Iteration 1 Summary

- Mechanical findings accepted:  11
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0
- Spec commit at start:          5a9e297d
- Spec line count: 1870 → 1889 (+19 lines)

