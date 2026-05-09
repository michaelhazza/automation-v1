# ChatGPT Spec Review Session — support-desk-canonical — 2026-05-09T08-14-57Z

## Session Info
- Spec: docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md
- Branch: claude/support-ticket-structure-xMcy8
- PR: #277 — https://github.com/michaelhazza/automation-v1/pull/277
- Mode: manual
- Started: 2026-05-09T08:14:57Z
- Finalised: 2026-05-09T09:05:00Z
- **Verdict:** APPROVED — operator finalised after Round 2. Spec stays at `Status: reviewing` per ChatGPT's recommendation: cannot move to `accepted` until OQ-1 (Foundry parity) + OQ-2 (Teamwork status inventory) close. Both are operator-owned and required before Phase 2 plan generation begins.

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

## Round 2 — 2026-05-09T08-50-00Z

### ChatGPT Feedback (raw)

> Round 2 is much cleaner. I'm doing a regression pass now: checking whether the fixes introduced any new contradictions or implementation traps, rather than re-litigating accepted design choices.
>
> Round 2 is close, but I would do one more small patch before finalising. The Round 1 blockers are materially fixed: deferred FK pattern is now explicit, author columns are split, manually_marked_sent resolves the sent ⇒ message_id invariant, and deletion/redaction is now v1 scope.
>
> **Findings:**
> F1 — Poll-based deletion proof is unsafe as written. Tighten to strict full-reconciliation precondition (high severity).
> F2 — `support.propose_reply` retry classification still uses stale "unsafe" wording; fix §14.2 row.
> F3 — Same-run supersession transaction order needs to be explicit (UPDATE then INSERT, otherwise partial UNIQUE will fire).
> P1 — File inventory should list tombstone/redaction pure helpers or fold them into existing helpers.
> P2 — `support.tickets.read` is described as "not a new key" but listed under Permission keys; move to Access Controls.
> P3 — Capability matrix `?` rows acceptable except OQ-2-gated; clarify so future reviewer doesn't block on every `?`.
>
> Verdict: Apply F1-F3, then finalise. No need for a major Round 3.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---|---|---|---|---|
| F1 deletion-by-poll precondition unsafe (incremental polls infer absence as deletion) | technical-escalated | apply (full-reconciliation precondition) | user-approved apply (as recommended) | high | Data correctness. False tombstones would hide live tickets from agent queue. Tighten §5.1 to require explicit full-reconciliation pass + no poll-page-failed + no rate-limit-truncation + provider endpoint with absence=deletion semantics. Incremental polls explicitly forbidden from setting `provider_deleted`. |
| F2 §14.2 stale wording for `support.propose_reply` ("unsafe") | technical | apply | auto (apply) | medium | Internal contradiction with §14.1 + §5.5 (now state-based, not unsafe). Update row to "guarded / state-based" with same-run supersede-then-insert semantics. |
| F3 Same-run supersession transaction order needs explicit pin | technical | apply | auto (apply) | medium | Implementation correctness. Within-tx order is load-bearing under partial UNIQUE: must UPDATE existing matches to `superseded` first, then INSERT new draft. Rollback preserves prior draft on insert failure. Inserting before superseding is forbidden. |
| P1 §18 test inventory missing tombstone/redaction coverage | technical | apply | auto (apply) | low | File-inventory drift. Fold deletion + redaction read-filter cases + deletion-by-poll precondition tests into `supportTicketServicePure.test.ts`; same for back-link match logic into `supportDraftReconciliation.test.ts`. |
| P2 `support.tickets.read` listed under Permission keys but isn't one | technical | apply | auto (apply) | low | Naming clarity. Rename §18 subsection to "Access controls"; explicitly state "no support.tickets.read permission key — read-pathway authorisation is implicit in org membership + sub-account scoping". |
| P3 Capability matrix `?` rows should not block spec acceptance except for OQ-2 | technical | apply | auto (apply) | low | Reviewer guidance. §17.2 now states that `?` rows are acceptable at acceptance time, with OQ-3 (idempotency) + OQ-4 (attachment auth) gated to Phase 2 chunk C7. Only OQ-2 (status inventory) blocks acceptance per §22. |

### Integrity check (per playbook step 4a)

Ran one pass over the spec for forward references, contradictions, and missing inputs/outputs introduced by this round's edits.

- §5.1 deletion-by-poll precondition references `support.provider.poll_page_failed` and `support.provider.rate_limited` — both already present in §15. ✓
- §14.2 row update aligns with §14.1 propose_reply posture. ✓
- §5.5 same-run supersession order paragraph aligns with §14.1 and §3 phase plan C4 ("soft-uniqueness guard partial UNIQUE"). ✓
- §18 access-controls rename consistent with §12 ("Read access does not require a permission key") added by spec-reviewer iteration. ✓
- §18 test inventory expansion lists `deletion-by-poll precondition tests` matching §5.1 precondition + §17.1 acceptance bar tombstone test. ✓
- §17.2 `?`-row clarification aligns with §22 OQ enumeration. ✓

No new integrity issues introduced. Round 2 edits are internally consistent.

### Applied (auto-applied technical + user-approved + integrity)

- [user] F1 deletion-by-poll precondition tightened — incremental polls forbidden from setting `provider_deleted`; full-reconciliation pass required with explicit conditions enumerated.
- [auto] F2 §14.2 propose_reply row corrected to "guarded / state-based".
- [auto] F3 §5.5 same-run supersession transaction order pinned (UPDATE-then-INSERT).
- [auto] P1 §18 test inventory expanded with deletion + redaction + back-link cases folded into existing pure test files.
- [auto] P2 §18 "Permission keys" subsection renamed "Access controls"; `support.tickets.read` removed from key list with explicit explanation.
- [auto] P3 §17.2 capability-matrix `?`-row clarification added.

### Top themes

- **Implementation-trap detection.** Round 2 was a regression-pass, not a fresh-eyes review. The findings were all about whether Round 1's fixes introduced new contradictions or builder hazards. None broke design — all were tightenings.
- **Constraint-driven implementation order matters.** Partial UNIQUE indexes are load-bearing during multi-row updates; the spec should pin the within-transaction order so a builder doesn't trip the constraint mid-flight.
- **Polling semantics ≠ provider semantics.** Inferring deletion from absence is a recurring mistake when the polling cursor / pagination / rate-limiting can hide live entities. Tombstoning requires either a webhook-confirmed deletion event or a strict full-reconciliation precondition.

---

## Round 3 — 2026-05-09T09-00-00Z — finalisation pass

### ChatGPT Feedback (raw)

> No further blockers. I'd finalise and move to handoff, with one caveat: the spec is still correctly marked reviewing until OQ-1 and OQ-2 are closed, because both are explicitly required before Phase 2 plan generation.
>
> Round 2 fixes landed cleanly: deletion-by-poll is now safe; support.propose_reply retry handling is now internally consistent; file inventory reflects new pure-test coverage; access control wording is cleaner; capability-matrix `?` rows are correctly framed.
>
> The only thing I would not forget in handoff is to make the acceptance condition crisp: proceed to handoff, but do not mark the spec accepted or start Phase 2 plan generation until OQ-1 Foundry parity and OQ-2 Teamwork status inventory are closed.
>
> That is not another spec finding. It is already captured in §22. My recommendation: done.

### Operator decision

> "Lock the spec after this and move forward."

Round 3 closes with no spec edits — ChatGPT raised zero new findings. The session moves to finalisation per the operator's "done" signal.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---|---|---|---|---|
| (none — regression-pass clean) | n/a | n/a | n/a | n/a | Round 3 verdict was APPROVED with no remediable findings. ChatGPT's only "caveat" — that the spec stays at `Status: reviewing` until OQ-1 + OQ-2 close — is already captured in §22 and the spec frontmatter. The operator-owned closure is part of Phase 1 → Phase 2 handoff, not a spec edit. |

---

## Final Summary

- **Rounds:** 3 (R1: 8 findings closed, R2: 6 findings closed, R3: 0 findings, finalisation)
- **Auto-accepted (technical):** 8 applied | 0 rejected | 0 deferred
- **User-decided (technical-escalated + user-facing):** 5 applied | 0 rejected | 0 deferred
- **Integrity-check fixes:** 1 applied (R1 stale `author_id` reference at §5.1)
- **Index write failures:** 0 (clean)
- **Deferred to `tasks/todo.md` § Spec Review deferred items / support-desk-canonical:** none — all findings closed in-round
- **Implementation readiness checklist:**
  - All inputs defined: yes (every contract in §11 names producer + consumer + example)
  - All outputs defined: yes (every state machine has explicit terminal events; observability codes mapped to UI surfaces)
  - Failure modes covered: yes (§14 idempotency / retry / concurrency / terminal events; deletion-by-poll precondition)
  - Ordering guarantees explicit: yes (§5.2.A thread ordering rule; §8 dispatch state machine; §5.5 supersession transaction order; §3 chunk ordering)
  - No unresolved forward references: yes (§16 dependency graph forward-only; integrity check passes)
  - **OQ-1 + OQ-2 are the explicit acceptance gate** — spec stays at `Status: reviewing` until both close. Documented in §22 + spec frontmatter + handoff (per Phase 1 Step 9).
- **PR:** #277 — https://github.com/michaelhazza/automation-v1/pull/277

### Doc Sync Sweep

Scope: this is a SPEC-review session. The change-set is a new spec doc + spec rounds. The spec proposes future code changes (Phase 2 chunks C1–C15); reference docs that describe IMPLEMENTED state are updated when those chunks land, not at spec authoring. Investigation procedure run per `docs/doc-sync.md`:

- **architecture.md updated:** n/a — spec proposes future architecture changes (Phase 2 C15). No code changes in this session; reference doc describes implemented state. Verdict deferred to Phase 2 finalisation.
- **capabilities.md updated:** n/a — Support Desk capability lands when Phase 2 C15 ships. No add/rename in this session.
- **integration-reference.md updated:** n/a — `teamworkAdapter` extensions land in Phase 2 chunks C5–C7. No integration changes in this session.
- **CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated:** no — checked grep terms `support-desk-canonical`, `canonical_tickets`, `support.draft.approve`, `support.propose_reply`, polymorphic-FK, deferred-FK; zero stale references. Build discipline / agent fleet / RLS rules unchanged.
- **CONTRIBUTING.md updated:** n/a — no lint policy or comment-format change.
- **frontend-design-principles.md updated:** no — checked grep terms `support`, `tickets list`, `draft review`, `inbox config`; zero stale references. Mockups (frozen at `0a768abd`) applied existing principles; no new pattern introduced.
- **KNOWLEDGE.md updated:** yes (3 entries added) — `[2026-05-09] Pattern — deferred-FK migration when two new tables reference each other (cross-cycle)` + `[2026-05-09] Pattern — polymorphic FK splitting in Postgres (no native support)` + `[2026-05-09] Pattern — polling absence ≠ deletion; tombstoning requires either webhook or strict full-reconciliation`. All three are reusable for future spec authoring; the "polling absence" pattern in particular is high-stakes (false tombstones hide live data from agents).
- **spec-context.md updated:** yes — bumped `last_reviewed_at` from 2026-05-05 to 2026-05-09. Framing applies as-is (pre-production, static_gates_primary, runtime_tests: pure_function_only, commit_and_revert); no `accepted_primitives` or `convention_rejections` change. The spec proposes nothing in `none_for_now` or `defer_until_*` categories. Bump is the freshness confirmation.
- **docs/decisions/ updated:** n/a — ADR `0009-support-desk-canonical-not-conversations.md` is itemised in §18 file inventory and is created in Phase 2 C15 alongside the architecture.md update. Not a Phase 1 artefact.
- **docs/context-packs/ updated:** n/a — no architecture.md anchor changes.
- **references/test-gate-policy.md updated:** n/a — no test-gate posture change.
- **references/spec-review-directional-signals.md updated:** no — checked grep terms `polymorphic FK`, `deferred FK`, `tombstone`, `full reconciliation`, `manually_marked_sent`; zero stale references. The patterns from this session are routed to KNOWLEDGE.md per the doc's primary purpose (corrections + reusable patterns), not to the directional-signals classifier (which is for `spec-reviewer` Codex-loop signals).
- **`.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` updated:** n/a — no framework-level change.

### Consistency Warnings

None across rounds. All findings classified consistently (same finding-type triaged the same way each round). No mid-session reversals.

### Recommendation

**Spec is implementation-ready except for OQ-1 + OQ-2 closure.** Phase 1 handoff captures the gate; Phase 2 plan generation must NOT begin until both close. The operator owns OQ-1 (Foundry schema parity verification — side-by-side comparison against Foundry's loader) and OQ-2 (Teamwork status vocabulary inventory — full enumeration locked into §11.2 of the spec).

OQ-3 (Teamwork native action-idempotency) and OQ-4 (Teamwork attachment auth model) close inside Phase 2 chunk C7 per spec §22 — they are not Phase 1 → Phase 2 gates.
