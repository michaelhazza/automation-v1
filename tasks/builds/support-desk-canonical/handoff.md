# Handoff — support-desk-canonical

**Phase complete:** SPEC (Phase 1 of the three-phase pipeline)
**Phase status:** PHASE_1_COMPLETE
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md`
**Spec status:** `reviewing` — locked pending OQ-1 + OQ-2 (see "Hard gate" below)
**Branch:** `claude/support-ticket-structure-xMcy8`
**Build slug:** `support-desk-canonical`
**Source brief:** `tasks/builds/support-desk-canonical/brief.md` (LOCKED v5.3, commit `0e04cc0d`)
**UI-touching:** yes
**Mockup paths:** `prototypes/support-desk-canonical/` — 5 hi-fi screens (`integration-setup.html`, `tickets-list.html`, `ticket-detail.html`, `draft-review.html`, `inbox-config.html`) + `index.html` + `_shared.css`. Frozen at commit `0a768abd` as design source of truth.
**PR:** [#277](https://github.com/michaelhazza/automation-v1/pull/277) — spec-only PR.
**Latest commit at handoff:** `8aca6eb9`

---

## Contents

1. Hard gate before Phase 2 plan generation
2. Reviews run
3. Decisions made in Phase 1
4. Phase plan inheritance
5. Spec-reviewer + ChatGPT spec-review logs
6. Open questions for Phase 2
7. Repository state at handoff
8. How Phase 2 starts

---

## 1. Hard gate before Phase 2 plan generation

**Phase 2 (`feature-coordinator`) MUST NOT begin plan generation until both of the following close:**

- **OQ-1 — Foundry ticket-schema parity verification.** Operator runs side-by-side comparison of `CanonicalTicketData` (spec §6 + §11.3) against Foundry's current Teamwork ticket schema. Every divergence enumerated as one of: "match — identical", "divergence — Foundry has X, runtime intentionally omits / renames because Y", or "divergence — runtime has X, Foundry intentionally omits because Y". Resolution amends spec §11.3 with the divergence list inlined.
- **OQ-2 — Teamwork status vocabulary inventory.** Operator (or implementer at Phase 2 entry) audits Teamwork Desk's API + a real Teamwork account's reported values, locks the full provider→canonical status mapping table inline in spec §11.2 (replacing the partial example). Brief §10 #12 explicitly says "the spec cannot be approved until the inventory is complete."

Once both close, the spec moves to `Status: accepted` and Phase 2 begins. OQ-3 (Teamwork native idempotency) and OQ-4 (Teamwork attachment auth) are **NOT** Phase 1 → Phase 2 gates — they close inside Phase 2 chunk C7 per spec §22.

OQ-5 was closed during chatgpt-spec-review Round 1 (deletion/redaction tombstone semantics now in v1 scope per spec §5.1 + §5.2 + §15).

## 2. Reviews run

| Step | Agent | Result |
|---|---|---|
| spec-reviewer (Codex) | Auto-applied | 5 iterations / 5 cap. Verdict: READY_FOR_BUILD. 19 mechanical fixes auto-applied across iterations 1-4; iteration 5 zero findings. Final report: `tasks/review-logs/spec-review-final-support-desk-canonical-2026-05-09T07-33-16Z.md`. Per-iteration logs: `tasks/review-logs/_codex_iter1..5_*.txt`. |
| chatgpt-spec-review | 3 rounds | Verdict: APPROVED — operator finalised after Round 2. R1: 8 findings closed (4 high-severity blockers fixed: source_draft_id FK migration order, polymorphic-FK split, manually_marked_sent transitional state, deletion/redaction tombstone semantics; 1 user-facing rename: "Mark provider send as verified"; 3 medium-severity tightenings). R2: 6 findings closed (1 high-severity blocker: deletion-by-poll precondition tightened; 5 polish tightenings). R3: 0 findings — finalisation. Log: `tasks/review-logs/chatgpt-spec-review-support-desk-canonical-2026-05-09T08-14-57Z.md`. |

## 3. Decisions made in Phase 1

These are the directional choices the operator (or the spec-coordinator) locked during Phase 1. Phase 2 inherits them; deviation requires a spec amendment.

- **Brief commit policy.** Brief v5.3 lock was committed as a discrete commit (`0e04cc0d`) before spec authoring. Operator-confirmed at session start.
- **Mockup loop skipped.** Five hi-fi screens (commit `0a768abd`) are the design source of truth. Operator confirmed mockups frozen; chatgpt-spec-review Rounds 1-3 raised no UI-design objections.
- **Five canonical entities approved.** `canonical_tickets`, `canonical_ticket_messages`, `canonical_inboxes`, `canonical_support_agents`, `canonical_ticket_drafts` — per brief §11.
- **Twelve design invariants approved** (brief §5). All implemented in spec §5–§15.
- **`canonical_conversations` boundary** (brief §10 #7). Tickets do NOT flow through `canonical_conversations` in v1. ADR `0009-support-desk-canonical-not-conversations.md` to be authored in Phase 2 chunk C15.
- **Inbox as policy unit** (brief §10 #8). `canonical_inboxes.agent_config` JSONB; schema-versioned; Zod-validated.
- **Six-state canonical ticket status enum** (brief §6.1). `open | pending_internal | waiting_on_customer | resolved | closed | unknown_provider_status`. Closed enum.
- **Ten-state canonical draft status enum** (chatgpt-spec-review R1). `draft | awaiting_review | dispatching | needs_reconciliation | manually_marked_sent | sent | rejected | failed | expired | superseded`. `manually_marked_sent` is non-terminal — resolves to terminal `sent` when ingestion later lands the provider message and the back-link routine succeeds.
- **Polymorphic-FK split (chatgpt-spec-review R1).** `canonical_ticket_messages` has `author_contact_id` + `author_support_agent_id` (split nullable FKs) + CHECK constraint enforcing exactly-one-non-null per `author_type`. Pattern recorded in KNOWLEDGE.md `[2026-05-09]`.
- **Deferred-FK migration pattern (chatgpt-spec-review R1).** `source_draft_id` column lands in 0310 without FK; FK + partial index added in 0311 via ALTER TABLE. Pattern recorded in KNOWLEDGE.md `[2026-05-09]`.
- **Tombstone semantics in v1 scope (chatgpt-spec-review R1).** Teamwork's `mapTeamworkEventType` already normalises `ticket.deleted`. v1 ships `provider_deleted` + `redacted` columns + content-nulling rule + audience-tier read filtering + 3 new log codes. OQ-5 closed.
- **Deletion-by-poll precondition (chatgpt-spec-review R2).** Polling may set `provider_deleted=true` ONLY during a full-reconciliation pass with all preconditions held (no poll-page-failed, no rate-limit-truncation, unwindowed endpoint). Incremental polls forbidden from tombstoning. Pattern recorded in KNOWLEDGE.md `[2026-05-09]`.
- **UI labels finalised (chatgpt-spec-review R1).** Manual-resolution surface uses "Mark provider send as verified" / "Mark as failed in provider" / "Retry reconciliation" — communicates operator confirms provider state.
- **Same-run propose-reply uniqueness (chatgpt-spec-review R1+R2).** Partial UNIQUE on `(organisation_id, ticket_id, created_by_agent_run_id, proposed_visibility) WHERE status IN ('draft','awaiting_review')`. Same-run agent retries supersede deterministically at insert time (UPDATE-then-INSERT order pinned). Cross-run double-proposals remain operator-visible.
- **Acceptance bar verification methods named** (chatgpt-spec-review R1 F8). §17.1 maps each criterion to: pure emit-call-site test / manual sandbox / fixture injection. Stays inside `static_gates_primary` + `runtime_tests: pure_function_only` framing.
- **OQ-2 strengthened to acceptance gate (chatgpt-spec-review R1).** Status vocabulary inventory must close before spec moves to `accepted`, not before C6.
- **Read-pathway permissions (chatgpt-spec-review R2).** No `support.tickets.read` permission key; read access is implicit in org membership + sub-account scoping. Mutating operations gated by `support.draft.approve` / `support.draft.reject` / `support.draft.override_collision` / `support.inbox.configure`.

## 4. Phase plan inheritance

The 15-chunk single-PR phase plan in spec §3 is the authoritative chunk ordering. `feature-coordinator` should generate the Phase 2 plan against this; per the spec §16 dependency graph, no chunk reorders are valid (every dependency is forward-only).

Chunk summary (full detail in spec §3 + §16):

- **C1** — `canonical_inboxes` + `canonical_support_agents` schema + RLS (migrations 0307, 0308).
- **C2** — `canonical_tickets` schema + RLS + tombstone columns (migration 0309).
- **C3** — `canonical_ticket_messages` schema + RLS + redaction columns + split author columns + `source_draft_id` *without* FK (migration 0310).
- **C4** — `canonical_ticket_drafts` schema + RLS + `manually_marked_sent` state + soft-uniqueness partial UNIQUE + ALTER TABLE adding deferred FK from C3's `source_draft_id` to C4's drafts (migration 0311).
- **C5** — Adapter contract extensions (TypeScript-only; no schema).
- **C6** — Teamwork ingestion implementation + status-mapping fail-closed + webhook event extension.
- **C7** — Teamwork `addInternalNote` + `resolveAttachment` + idempotency-key plumbing. Closes OQ-3 + OQ-4. Conditional `action_attempts` migration 0312 if OQ-3 lands no-native-idempotency.
- **C8** — Connector polling integration (extension only; no new infra).
- **C9** — Webhook ingestion convergent dual-path. OQ-5 already closed.
- **C10** — `supportTicketService` + `supportInboxService`.
- **C11** — `supportDraftDispatchService` (three-phase dispatch + boot recovery + reconciliation worker).
- **C12** — Skill registrations (10 skills under `server/skills/support/`).
- **C13** — UI surfaces (5 pages reusing `consolidation-foundation` primitives).
- **C14** — Operational state surfaces.
- **C15** — Documentation, ADR, architecture.md doc-sync.

## 5. Spec-reviewer + ChatGPT spec-review logs

**Spec-reviewer iterations used:** 5 / 5 (cap reached). All 5 iterations were mechanical-fix passes; zero directional findings; zero deferrals to `tasks/todo.md`. Verdict: READY_FOR_BUILD. Cap reach is not a blocking signal — every iteration closed monotonically (11 → 5 → 2 → 1 → 0 fixes). spec-reviewer cannot be re-invoked on this spec lifetime.

**ChatGPT spec-review log:** `tasks/review-logs/chatgpt-spec-review-support-desk-canonical-2026-05-09T08-14-57Z.md` — 3 rounds, Verdict: APPROVED. Final Summary block at end of log includes doc-sync sweep verdicts. **0 deferrals** — every finding resolved in-round.

## 6. Open questions for Phase 2

| OQ | Status | Closer | Required before |
|---|---|---|---|
| OQ-1 — Foundry ticket-schema parity verification | open (Phase 1 → Phase 2 gate) | operator-owned side-by-side comparison | Phase 2 plan generation begins |
| OQ-2 — Teamwork status vocabulary inventory | open (Phase 1 → Phase 2 gate) | operator/implementer audits Teamwork API; full mapping table inlined into spec §11.2 | Phase 2 plan generation begins (spec moves `reviewing → accepted`) |
| OQ-3 — Teamwork native action-idempotency mechanism | open (Phase 2-internal gate) | C7 audits Teamwork API surface; spec amendment for §6 + §17 capability matrix `?` row + §18 conditional migration list | C7 closes |
| OQ-4 — Teamwork attachment auth + URL lifecycle | open (Phase 2-internal gate) | C7 audits auth model; spec amendment for §6 `resolveAttachment` return type | C7 closes |
| ~~OQ-5~~ | **CLOSED** in chatgpt-spec-review R1 | n/a | tombstone semantics now in v1 scope (spec §5.1 / §5.2 / §15) |

## 7. Repository state at handoff

- **Latest commit:** `8aca6eb9` (chatgpt-spec-review finalisation).
- **Files added in Phase 1:**
  - `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md` (1900+ lines, 22 sections)
  - `tasks/builds/support-desk-canonical/progress.md`
  - `tasks/builds/support-desk-canonical/handoff.md` (this file)
  - `tasks/review-logs/chatgpt-spec-review-support-desk-canonical-2026-05-09T08-14-57Z.md`
  - `tasks/review-logs/spec-review-final-support-desk-canonical-2026-05-09T07-33-16Z.md` (+ 5 Codex iteration logs)
- **Files modified in Phase 1:**
  - `tasks/builds/support-desk-canonical/brief.md` (v5.2 → v5.3 lock at `0e04cc0d`)
  - `tasks/current-focus.md` (NONE → PLANNING; will transition to BUILDING in Phase 1 Step 10)
  - `KNOWLEDGE.md` (+3 patterns at finalisation)
  - `docs/spec-context.md` (`last_reviewed_at` 2026-05-05 → 2026-05-09)
- **No code files modified.** Phase 1 is spec-only.

## 8. How Phase 2 starts

In a new Claude Code session — fresh prompt cache, clean context — type:

```
launch feature coordinator
```

`feature-coordinator` will read this handoff, restore Phase 1 context, and proceed with its playbook. Per the hard gate above, it MUST verify OQ-1 + OQ-2 closure before invoking `architect` for plan generation. If either is open, `feature-coordinator` pauses and prompts the operator to close them first (typically by amending the spec inline with the OQ resolutions, then re-running).

Phase 2 plan generation, build chunks, branch-level review pass, and Phase 3 handoff all flow from `feature-coordinator` per its playbook. Total estimated chunk count: 15. Total estimated migrations: 5–6 (5 always + 1 conditional). Estimated PR shape: single-PR canonical-layer + Teamwork-validating-implementation per brief §11 recommendation.

---

## Phase 2 (BUILD) — complete

**Plan path:** `tasks/builds/support-desk-canonical/plan.md`
**Chunks built:** 15 (C1–C15)
**Branch HEAD at handoff:** `<TBD on commit>`
**G1 attempts (per chunk):** 1 each (architect + builder pre-checks held; no plan gaps surfaced)
**G2 attempts:** 1 (lint 0 errors / typecheck clean on first attempt)

**spec-conformance verdict:** CONFORMANT_AFTER_FIXES (round 1 NON_CONFORMANT 7 dir gaps → builder remediated all 7 in `74fb0306`; round 2 NON_CONFORMANT 1 low-sev gap REQ #72 → operator inline fix in `62f9a28e`)
- Round 1 log: `tasks/review-logs/spec-conformance-log-support-desk-canonical-2026-05-09T20-34-30Z.md`
- Round 2 log: `tasks/review-logs/spec-conformance-log-support-desk-canonical-2026-05-09T21-08-30Z.md`

**adversarial-reviewer verdict:** HOLES_FOUND (2 confirmed-holes / 2 likely-holes / 3 worth-confirming) — non-blocking advisory; 6 items routed to `tasks/todo.md` SDC-ADV-1..6
- Log: `tasks/review-logs/adversarial-review-log-support-desk-canonical-2026-05-09T21-28-46Z.md`
- 1 confirmed-hole partially contradicted by spec design decision (chatgpt-spec-review R2): read-pathway permissions = org membership + sub-account scoping, but sub-account scoping NOT enforced in implementation (route handlers pass `subaccountId: null` hardcoded). Operator decision required: enforce subaccount scoping OR add read permission keys.

**pr-reviewer verdict:** APPROVED (round 4 final, after 2 fix-loop rounds)
- Round 1 (CHANGES_REQUESTED, 5 blocking + 5 strong + 3 non-blocking): `tasks/review-logs/pr-review-log-support-desk-canonical-2026-05-09T21-41-38Z.md`
- Round 2 (APPROVED post fix-loop r1): `tasks/review-logs/pr-review-log-support-desk-canonical-2026-05-09T22-02-25Z.md`
- Round 3 (CHANGES_REQUESTED post dual-reviewer, 2 NEW P1s): `tasks/review-logs/pr-review-log-support-desk-canonical-2026-05-09T22-38-27Z.md`
- Round 4 (APPROVED final): `tasks/review-logs/pr-review-log-support-desk-canonical-2026-05-09T22-50-50Z.md`

**Fix-loop iterations:** 2 (within 3-round cap)
- Round 1 (`f64cd397`) — 5 blockers + S1 + S3 + S4 fixed
- Round 2 (`ec581e11`) — 2 P1 blockers from post-dual-reviewer round (B1 symmetric webhook author FK, B2 boot recovery RLS bypass)

**dual-reviewer verdict:** APPROVED with 6 [ACCEPT] decisions over 3 iterations (cap reached; natural convergence — each iteration's findings were direct cascading consequences of prior fix)
- Iter 1: 2 P1 (sentMessageId UUID FK violation, agent/bot author FK in polling) + 2 P2 (drafts hidden from review queue, retry_reconciliation stuck)
- Iter 2: 1 P2 cascading (matcher tightening after dispatch flow change)
- Iter 3: 1 P2 cascading (webhook back-link extension to needs_reconciliation)
- Commits: `c9bdec5c` + `6cc2542e`
- Log: `tasks/review-logs/dual-review-log-support-desk-canonical-2026-05-09T22-30-00Z.md`

**Doc-sync gate:**
- architecture.md updated: yes (§ Canonical Support Desk + key files per domain in C15 `4165aa35`; dual-reviewer S4 corrected stale Teamwork file refs in `c9bdec5c`)
- capabilities.md updated: yes (Customer Support Automation > Support Desk Skills subsection, 10 skills, in C15)
- integration-reference.md updated: yes (Teamwork Desk entry added — slug `teamwork`, 4 read + 6 write capabilities, 9 webhook events, 10 skills_enabled, last_verified 2026-05-09)
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: no — checked for new build-discipline / RLS / convention rules; this build follows existing FORCE-RLS, withAdminConnection, withOrgTx, action_attempts ledger patterns; no new locked rule introduced
- frontend-design-principles.md updated: no — checked for new UI patterns / hard rules; 5 new pages reuse `consolidation-foundation` primitives without introducing new design rules
- KNOWLEDGE.md updated: yes (5 entries — 3 from Phase 1 spec-review + 2 new from Phase 2 review-loop: symmetric ingest paths must implement same FK/CHECK contracts; cross-tenant boot scans need withAdminConnectionGuarded + SET LOCAL ROLE admin_role)
- spec-context.md updated: n/a (feature pipeline)
- docs/decisions/ updated: yes (ADR-0009 added in C15)
- docs/context-packs/ updated: n/a (no anchor renames)
- references/test-gate-policy.md updated: n/a
- references/spec-review-directional-signals.md updated: n/a
- .claude/FRAMEWORK_VERSION + .claude/CHANGELOG.md updated: n/a (repo-specific build)

**Open issues for finalisation (deferred to operator triage in `tasks/todo.md`):**

*Operator decisions:*
- SDC-OVERRIDE-1 (OQ-1) — Foundry parity verification pending; spec drift risk acknowledged
- SDC-ADV-1 — Read-pathway sub-account scoping not enforced (spec contradiction; operator decides)
- SDC-PR-7 — Permission scope drift (architecture.md says Subaccount, code uses ORG_PERMISSIONS)

*Strong post-merge work:*
- SDC-PR-1 — `decideOutcome` matcher should exclude already-back-linked messages
- SDC-PR-2 — Post-dispatch timestamp filter needs tolerance window
- SDC-PR-3 — Move `support.find_customer_history` from skillExecutor to service layer
- SDC-PR-4 — Add boot-recovery + worker orchestration tests
- SDC-PR-5 — Add tests for B1 (webhook author resolution) + B2 (boot recovery RLS) fixes
- SDC-ADV-2 — Verify Teamwork addReply provider-side idempotency
- SDC-ADV-3 — Webhook cross-tenant attribution + persistent dedup store
- SDC-ADV-4 — Thread organisationId predicate through approveDraft UPDATEs
- SDC-ADV-5 — Replace drizzleSql.raw in boot-recovery with hardcoded SQL literal

*Non-blocking polish:*
- SDC-PR-6, SDC-PR-8 through SDC-PR-14 — type-safety drift, log levels, doc tidies, comment additions

**Key Phase 2 metrics:**
- 89+ files changed across the cumulative branch diff
- 6 new migrations (0307–0312)
- 5 canonical entities + 1 ledger + 4 ORG permission keys
- 10 support skills wired
- 5 UI pages
- 1 ADR (0009)
- 4 reviewers run (spec-conformance, adversarial-reviewer, pr-reviewer, dual-reviewer)
- 4 pr-reviewer rounds + 2 fix-loop rounds + 3 Codex iterations
- 16 commits on the branch (C1-C15 chunks + spec-conformance fixes + pr-review fix-loop rounds + dual-reviewer fixes + doc-sync logs)

## How Phase 3 starts

In a new Claude Code session — fresh prompt cache, clean context — type:

```
launch finalisation
```

`finalisation-coordinator` will read this Phase 2 handoff, restore context, and proceed with its playbook (S2 sync, G4 regression guard, chatgpt-pr-review manual rounds, doc-sync sweep, KNOWLEDGE.md pattern extraction, MERGE_READY transition, ready-to-merge label).

Phase 2 status: **PHASE_2_COMPLETE**.
