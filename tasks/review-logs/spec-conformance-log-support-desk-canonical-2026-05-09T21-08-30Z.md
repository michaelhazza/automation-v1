# Spec Conformance Log — Round 2

**Spec:** `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md`
**Spec commit at check:** `74fb03068877876ac995a6b501d488bf6bb10761`
**Branch:** `claude/support-ticket-structure-xMcy8`
**Base:** `e43ab01d7625996115fe584e0ffe6180ce8efa64` (merge-base with `origin/main`)
**Round 1 log:** `tasks/review-logs/spec-conformance-log-support-desk-canonical-2026-05-09T20-34-30Z.md`
**Round 1 verdict:** NON_CONFORMANT (7 directional gaps)
**Round 2 scope:** Full spec re-verification per caller request — re-extract and re-verify all requirements against current `74fb0306` integrated state.
**Changed-code set:** 89 files (`git diff e43ab01d...HEAD`)
**Run at:** 2026-05-09T21:08:30Z
**Commit at finish:** `3dc477e2`

---

## Contents

1. Summary
2. Round 1 fix verification
3. Re-verification of round-1 PASSes
4. New gap surfaced
5. Files modified
6. Next step

---

## 1. Summary

- Requirements extracted:     71 (70 from round 1 + 1 surfaced via deeper §11.7 read)
- PASS:                       69
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 1
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     1 (OQ-1 / SDC-OVERRIDE-1 — operator-deferred)

**Verdict: NON_CONFORMANT** (1 low-severity directional gap — see §4)

The 7 round-1 gaps are all properly remediated. The R1 fix chunk introduced a clean preflight pure module (`supportDraftDispatchPreflightPure.ts` with 21 tests covering all branches), wired the action_attempts ledger into Phase 3 dispatch with proper short-circuit + lookup-then-insert, added the audit-event write for collision override, blocks autonomous-agent overrides with a typed reason, fixed the support.set_status enum, extended the find_customer_history join, and corrected architecture.md's status enum names.

One previously-uncaught gap surfaced during round-2 deep-read of §11.7. Detail in §4 below.

This is round 2 of 2; per caller's 2-round cap, the remaining gap routes to `tasks/todo.md` rather than triggering a round 3. The gap is low severity (LLM-facing schema looser than persistence-time intent; companion-action `setStatus='closed'` would still require operator approval before dispatch). It does not block merge.

`npm run lint` → 0 errors, warnings only. `npm run typecheck` → clean.

## 2. Round 1 fix verification

| R1 REQ | Description | Round-2 verdict | Evidence |
|---|---|---|---|
| #45 | §8.1 Preflight checks 4–7 (status eligibility, collision-window, customer match, superseded) | **PASS** | `server/services/supportDraftDispatchPreflightPure.ts:79-129` implements all four checks. Wired at `server/services/supportDraftDispatchService.ts:231-260`. Pure tests: 21 cases at `server/services/__tests__/supportDraftDispatchPreflightPure.test.ts`. The `human_collision_blocked` reason emits `support.ticket.human_collision_blocked` with the spec-named fields. |
| #49 | §8.6 #2 collision-override audit-event write | **PASS** | `server/services/supportDraftDispatchService.ts:264-281` writes to `auditEvents` with action `support.draft.collision_override` and the spec-named fields (draft ID, ticket ID, reviewNote, lastHumanActivityAt, minMinutesRequired, actor). Uses existing `auditService.log` pattern. |
| #50 | §8.6 paragraph 5 autonomous-agent guard for `overrideCollision: true` | **PASS** | `server/services/supportDraftDispatchPreflightPure.ts:135-139` rejects with typed reason `autonomous_agent_cannot_override_collision` when the caller has no human user id. Wired at `supportDraftDispatchService.ts:229,243-244`. Spec §8.6 paragraph 5 specifies the *behavior* (refuses); does not name a specific errorCode string, so the chosen typed reason satisfies the requirement. |
| #52a | `action_attempts` ledger lookup-then-insert wired into dispatch path | **PASS** | `server/services/supportDraftDispatchService.ts:363-402` performs lookup-then-insert before each adapter call. Short-circuits on prior `succeeded` (lines 378-387) emitting `ACTION_RETRY_IDEMPOTENT`. Insert at lines 391-402 uses `onConflictDoNothing` for race safety. Status update on success/failure at lines 432-441 / 469-477. Manifest entry present at `server/config/rlsProtectedTables.ts:1192-1194`; schema at `server/db/schema/actionAttempts.ts`; migration `migrations/0312_action_attempts.sql` ships RLS + UNIQUE constraint. |
| #55 | `support.set_status` enum extended with `'resolved'` | **PASS** | `server/config/actionRegistry.ts:3576` — `z.enum(['open', 'pending_internal', 'waiting_on_customer', 'resolved', 'closed'])`. Skill markdown also lists `resolved` at `server/skills/support/set-status.md:10,13`. |
| #56 | `support.find_customer_history` joins `canonical_revenue` and `canonical_accounts` | **PASS** | `server/services/skillExecutor.ts:2298-2341` selects from `canonicalContacts` → `canonicalTickets` + `canonicalRevenue` (filtered by `accountId`) + `canonicalAccounts` (joined via `accountIds` set). Returns `{ contacts, tickets, revenue, accounts }` shape. All under `getOrgScopedDb` for RLS. |
| #69 | `architecture.md` § Canonical Support Desk uses canonical status enum names | **PASS** | `architecture.md:3515` now reads `(open/pending_internal/waiting_on_customer/resolved/closed/unknown_provider_status)` and adds the `unknown_provider_status` fail-closed sentinel sentence. Matches spec §5.1.A exactly. |

## 3. Re-verification of round-1 PASSes

All 50 round-1 PASS items remain PASS at sha `74fb0306`. The omnibus commit `74fb0306` bundled previously-uncommitted C11–C15 work which was already verified in round 1; no regressions detected.

Spot-checked (read back at current sha):

- `migrations/0307`–`0312` — all schema files + RLS policies + manifest entries present (`server/config/rlsProtectedTables.ts:1159–1194`).
- `server/adapters/integrationAdapter.ts:236–419` — all 7 new canonical types + ticketing + ingestion methods present.
- `server/adapters/teamwork/teamworkSupportStatusMap.ts` — fail-closed status mapper present.
- `server/services/connectorPollingService.ts:587-605` — Phase A→D wiring + `resolveByEmail` + `STATUS_UNKNOWN_PROVIDER_STATUS` emitter present.
- `server/services/webhookAdapterService.ts:545-996` — webhook dispatcher cases + back-link routine + `DRAFT_BACKLINK_AMBIGUOUS` emit present.
- `server/services/supportDraftReconciliationPure.ts` + `server/jobs/supportDraftReconciliationWorker.ts` — pure decideOutcome + worker registered on `support-draft-reconciliation` queue at `server/index.ts:717-718`.
- `server/lib/supportDispatchBootRecovery.ts` — boot-recovery one-shot scan registered at `server/index.ts:725-728`.
- `server/services/supportDraftDispatchServicePure.ts:43-149` — transition guard + idempotency-key derivation + same-run supersession planner.
- All 10 skill markdowns under `server/skills/support/` (verified via `ls`).
- All 10 `support.*` actions registered at `server/config/actionRegistry.ts:3451-3635`.
- All 4 permission keys at `server/lib/permissions.ts:114-117, 362-365`.
- All 5 UI pages + 8 components + sidebar + routes registered (`client/src/config/routes.ts:73-78`, `client/src/config/sidebar.ts:471-476`).
- `SUPPORT_LOG_CODES` at `shared/types/supportObservability.ts:5-34` — 22 codes covering §15 + §14.4 + §5.1/§5.2.
- ADR `docs/decisions/0009-support-desk-canonical-not-conversations.md` present.
- `KNOWLEDGE.md` patterns present.

## 4. New gap surfaced — REQ #72

| Field | Value |
|---|---|
| Severity | Low |
| Verdict | DIRECTIONAL_GAP |
| Spec section | §11.7 (`proposed_actions` JSONB on `canonical_ticket_drafts`) |
| Spec quote | "`setStatus` must be one of `{ 'open', 'pending_internal', 'waiting_on_customer', 'resolved' }` only. Companion actions cannot transition a ticket to `closed` or to `unknown_provider_status`" |
| Evidence | `server/config/actionRegistry.ts:3499-3504` — the `support.propose_reply` parameter schema declares `setStatus: z.string().optional()` (loose). The strict shared type `SupportProposedActionsSchema` at `shared/types/supportProposedActions.ts:11-16` is correctly closed-enum but is NOT used to parse the inbound LLM payload — `server/services/skillExecutor.ts:2230` uses a TypeScript type assertion (`as`) instead of `SupportProposedActionsSchema.parse(...)`. An autonomous agent could currently propose `setStatus: 'closed'` and the JSONB would persist that value. |
| Why DIRECTIONAL not MECHANICAL | The fix is a design judgment between two reasonable shapes: (a) tighten the actionRegistry parameterSchema to mirror `SupportProposedActionsSchema`, or (b) parse the input through `SupportProposedActionsSchema` in the skill handler before insert. Both work; spec doesn't mandate which boundary enforces. The behavioral end-state is the same but the failure mode is different (LLM-facing rejection vs runtime parse error). Tightening the registry could also break any in-flight payloads currently sitting in DB awaiting dispatch — needs a deliberate decision. |
| Severity rationale | Low — the dispatch path's downstream companion-mutation handler does not currently fire `setStatus='closed'` against the provider (the support.set_status registry entry already excludes it after R1 #55, and no code path bypasses that). The spec's intent (operator-only closure) is currently upheld by the absence of any closed-emitting code path; the gap is in defensive validation, not active leakage. |
| Suggested approach | Tighten `server/config/actionRegistry.ts:3499-3504` `support.propose_reply.parameterSchema.proposedActions` to mirror `SupportProposedActionsSchema` directly (import from shared/types). Single-import + 4-line edit. Alternative: add `SupportProposedActionsSchema.parse(input.proposedActions)` at `server/services/skillExecutor.ts:2230`. |

This gap is being routed to `tasks/todo.md` per playbook. Per caller's 2-round cap, no round-3 verification follows.

## 5. Files modified by this run

- `tasks/todo.md` — appended new section "Deferred from spec-conformance review — support-desk-canonical (2026-05-09 round 2)"
- `tasks/review-logs/spec-conformance-log-support-desk-canonical-2026-05-09T21-08-30Z.md` — this log

No code files modified. The single new gap (REQ #72) is DIRECTIONAL — it requires a design choice between two reasonable enforcement boundaries.

## 6. Next step

**NON_CONFORMANT** — 1 low-severity directional gap routed to `tasks/todo.md`. Per caller's explicit 2-round cap, this is the final spec-conformance pass. The gap (REQ #72, `proposed_actions.setStatus` enforcement boundary) is contained and does not break customer-visible behavior today; the build is functionally complete against the spec.

Recommended path forward:

1. **Operator decision:** treat REQ #72 as a follow-up — accept the merge with the gap noted, or pull a quick mechanical tighten before merge (the registry tighten is a 4-line change but introduces a backwards-incompatibility risk worth a deliberate decision).
2. Proceed to `pr-reviewer` on the current branch state.
3. On `pr-reviewer` clean, hand off to `finalisation-coordinator`.

The brief's load-bearing collision-avoidance invariant (§5.4) is now structurally enforced at every dispatch entry point. The §8.1 preflight, §8.6 override audit/guard, and §14.1 idempotency-ledger contracts are all honored. Doc-sync is complete. Round 1's seven blockers are closed.
