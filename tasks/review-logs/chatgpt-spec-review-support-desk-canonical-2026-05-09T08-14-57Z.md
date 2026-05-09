# ChatGPT Spec Review Session — support-desk-canonical — 2026-05-09T08-14-57Z

## Session Info
- Spec: docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md
- Branch: claude/support-ticket-structure-xMcy8
- PR: #277 — https://github.com/michaelhazza/2026-05-09-support-desk-canonical-spec
- Mode: manual
- Started: 2026-05-09T08:14:57Z

---

## Round 1 — 2026-05-09T08:14:57Z

### ChatGPT Feedback (raw)

> I'll treat this as a spec-review pass against the locked v5.3 brief, not a rewrite. I'm looking for contradictions, missing invariants, build blockers, and places where the spec accidentally weakens the brief.
>
> I've found two real issues so far: one around provider deletion/redaction being both mentioned as existing webhook coverage and deferred, and one around manual "Mark sent" conflicting with the terminal event contract. Continuing through the spec for any more blockers.
>
> Spec is strong overall, but I would not move to plan/build yet. I found 4 blockers and a few tightenings. The main issue is not direction, it is mechanical consistency: migration ordering, schema feasibility, terminal-event semantics, and deletion/redaction handling.
>
> **Blockers:**
> 1. canonical_ticket_messages.source_draft_id creates a migration-order contradiction (C3 cannot create FK to C4 table).
> 2. canonical_ticket_messages.author_id cannot be a real FK to two different tables.
> 3. Manual "Mark sent" conflicts with the terminal event contract (§14.4 support.draft.sent requires message_id but Mark sent has none).
> 4. Provider deletion/redaction is still under-specified and partly contradictory (Teamwork ticket.deleted already in adapter — no longer theoretical).
>
> **Tightenings:**
> 5. The OQ rules weaken the brief's "before spec sign-off" requirement (OQ-2 status inventory should close before spec acceptance, not before C6).
> 6. support.propose_reply non-idempotency should be bounded better with a soft uniqueness guard.
> 7. Mark sent should probably be renamed (operator UI label).
> 8. "All ten operational codes fire" may be too strong for v1 acceptance — define verification method per code.
>
> Verdict: Do not proceed to plan yet. Fix the 4 blockers first, then this is ready.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---|---|---|---|---|
| F1 source_draft_id FK migration order (C3 references C4 table) | technical-escalated | apply (ChatGPT preferred fix) | user-approved apply (as recommended) | high | Bug, build blocker. C3 creates `source_draft_id` as plain nullable UUID without FK; C4 adds FK + partial index via ALTER TABLE. |
| F2 author_id polymorphic FK (impossible in Postgres) | technical-escalated | apply (split nullable columns) | user-approved apply (as recommended) | high | Bug, schema feasibility. Replace with `author_contact_id` + `author_support_agent_id` + CHECK enforcing exactly-one-non-null per `author_type`. |
| F3 Manual "Mark sent" conflicts with `support.draft.sent` terminal event | technical-escalated | apply (distinct manually_marked_sent state) | user-approved apply (as recommended) | high | Architecture, semantic clarity. New non-terminal state `manually_marked_sent`; resolves to terminal `sent` when back-link routine succeeds. `sent` always has `sent_message_id IS NOT NULL`; `support.draft.sent` event always has `message_id`. Distinct event `support.draft.manually_marked_sent` for operator/audit. |
| F4 Provider deletion/redaction tombstone semantics under-specified | technical-escalated | apply | user-approved apply (as recommended) | high | Architecture, brief §12 mandate. Teamwork's `mapTeamworkEventType` already normalises `ticket.deleted`. Tombstone columns added to `canonical_tickets` + `canonical_ticket_messages`; redaction-overwrite rule; audience-tier read filtering; 3 new log codes. OQ-5 closed. |
| F5 OQ-2 close timing weakens brief | technical | apply | auto (apply) | medium | Process tightening. Brief §10 #12 says "spec cannot be approved until inventory is complete" — OQ-2 now requires closure before spec acceptance, not C6. |
| F6 support.propose_reply review-queue noise from agent retries | technical | apply | auto (apply) | medium | Internal posture. Partial UNIQUE index on `(organisation_id, ticket_id, created_by_agent_run_id, proposed_visibility) WHERE status IN ('draft','awaiting_review')` converts same-run retries to deterministic supersession at insert. Cross-run double-proposals remain operator-visible. |
| F7 "Mark sent" UI label is semantically misleading | user-facing | apply | user-approved apply (as recommended) | low | Visible operator copy. Rename to "Mark provider send as verified". Pairs with F3 state-machine fix; communicates operator confirms provider state, not synthesises canonical. |
| F8 Acceptance bar lacks named verification method per code | technical | apply | auto (apply) | medium | Testing posture clarification. Each acceptance criterion in §17.1 now names: pure-function emit-call-site test / manual sandbox action / fixture injection per code. Stays inside `static_gates_primary` + `runtime_tests: pure_function_only` framing. |

### Integrity check (per playbook step 4a)

Ran one pass over the spec for forward references, contradictions, and missing inputs/outputs introduced by this round's edits. Findings:

- **F-IC-1 — stale `author_id` reference at §5.1 collision-avoidance primitives.** The line described `last_human_activity_at` as updating "when a `canonical_ticket_messages` row with `author_type='agent'` AND `author_id` references…" — but F2 split `author_id` into `author_contact_id` + `author_support_agent_id`. **Triage:** technical (forward reference to renamed column). **Decision:** auto (apply). **Fix:** updated reference to `author_support_agent_id` (the human agents are referenced by that column per the F2 CHECK constraint).

No other integrity issues found. The 8 round-1 edits + 1 integrity-check edit are internally consistent.

### Applied (auto-applied technical + user-approved + integrity)

- [auto] F5 OQ-2 strengthen — close before spec acceptance.
- [auto] F6 propose_reply soft-uniqueness partial UNIQUE index.
- [auto] F8 acceptance-bar verification method per code (pure / manual / fixture-inject mapping table added to §17.1).
- [user] F1 source_draft_id FK migration ordering — column created in 0310 without FK; FK + partial index added in 0311 via ALTER TABLE; §3 phase plan, §5.2, §16 dep graph, §18 file inventory updated.
- [user] F2 split author_id into author_contact_id + author_support_agent_id + CHECK constraint — §5.2 rewritten, §5.1 collision-avoidance reference updated.
- [user] F3 manually_marked_sent non-terminal state — §5.5 enum, §8 diagram, §8.5 manual surface (combined with F7 rename), §14.4 terminal events table, §14.7 closure invariants, §15 SUPPORT_LOG_CODES.
- [user] F4 tombstone semantics — §5.1 deletion columns, §5.2 redaction columns + content-nulling rule, §5.2.B audience-tier table, §15 three new log codes, §17.1 acceptance bar items, §19 deferred-items moved out, §22 OQ-5 closed.
- [user] F7 "Mark provider send as verified" UI label — §8.5, §10 surfacing rules, §9 permission-key wiring (manual-resolve sub-actions).
- [integrity] F-IC-1 stale `author_id` reference at §5.1 — fixed to `author_support_agent_id`.

### Top themes

- **Migration sequencing.** Two-table FK coupling (drafts ↔ messages via source_draft_id) requires deferred FK addition in the second migration. Pattern: declare nullable column in producer migration, ALTER TABLE in consumer migration.
- **Schema feasibility checks before lock.** Polymorphic FKs are a recurring spec mistake — Postgres has no native support. Always split into typed nullable columns with a CHECK constraint tied to the discriminator.
- **State-machine vs event contract coupling.** When a state machine has multiple paths to "the same" terminal state, every path must respect the event payload contract. If they can't, the state machine needs a transitional state. `manually_marked_sent` is the transitional state for operator-confirmed but provider-message-not-yet-observed sends.
- **Brief-locked invariants must be in scope, not deferred.** §12's "must define tombstone semantics if provider exposes deletion" already triggers because the existing adapter normalises `ticket.deleted`. Spec drift detected: deferring something the brief mandates as in-scope.

---

## Round 2 — pending operator paste

(Operator: copy the updated spec into ChatGPT-web, paste the response back to begin Round 2; or say "done" to finalise.)
